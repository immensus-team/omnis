// A4 §1.1·§1.2. 커널은 루프를 알지 못하고 이 계약만 안다.
import type { z } from "zod";
import type { AssembledContext } from "../context/assemble.js";
import type { ToolName } from "../tools/names.js";

/** A4 §1.1. agent_runs.loop의 부분집합이다 — Phase A가 더한 'summarize'는 루프가 아니라 B3 요약 헬퍼다. */
export type LoopId =
  | "classify"
  | "draft"
  | "task"
  | "delegate"
  | "digest"
  | "followup"
  | "note_route"
  | "auto_archive"
  | "ingest";

export type LoopKind = "reactive" | "deliberate";

export interface LoopTrigger {
  kind: "event" | "schedule" | "manual";
  /** kind='event': 커널 이벤트 kind. 예: 'item.labeled' */
  on?: string;
  /** kind='event': 허브에서 평가되는 술어. 모델이 평가하지 않는다. */
  where?: string;
  /** kind='schedule': TZ=Asia/Seoul 5-field cron */
  cron?: string;
  debounceMs?: number;
}

export interface LoopBudget {
  inputTokens: number;
  outputTokens: number;
  wallClockMs: number;
  maxSteps: number;
}

/** 루프가 "무엇에 대해 도는가"를 담는 봉투다(델타 §4가 이 계획 Task 1을 오너로 지정). */
export interface TriggerContext {
  trigger_kind: "event" | "cron" | "manual";
  /** cron 잡 이름만. item 트리거는 trigger_ref가 아니라 item_id를 쓴다(A4 §1.7). */
  trigger_ref?: string;
  item_id?: string;
  thread_id?: string;
  task_id?: string;
  note_id?: string;
  person_id?: string;
  now: Date;
  payload: Record<string, unknown>;
}

export interface LoopResult<T> {
  loop: LoopId;
  run_id: string;
  output: T;
  confidence: number;
  rationale: string;
  escalate: boolean;
  injection_flags: string[];
  unresolved: string[];
}

export interface LoopSpec<TOut> {
  id: LoopId;
  kind: LoopKind;
  trigger: LoopTrigger;
  /** 비가역 tool은 여기 들어갈 수 없다 — registerLoop이 PhantomToolError로 막는다(A4-D3). */
  palette: ReadonlyArray<ToolName>;
  budget: LoopBudget;
  tier: "T0" | "T1" | "T2";
  outputSchema: z.ZodType<TOut>;
  /** 모델 없이 결론이 나는 T0 경로. null을 돌려주면 모델 경로로 내려간다.
   *  A4 §9.2의 자동 보관 ①③④가 이 자리에 들어간다. */
  decide?(ctx: TriggerContext): Promise<Omit<LoopResult<TOut>, "run_id"> | null>;
  assemble(ctx: TriggerContext): Promise<AssembledContext>;
  /** 제안만 쓴다. egress 모듈은 여기서도 import 금지(A4 §1.1). */
  apply(result: LoopResult<TOut>, ctx: TriggerContext): Promise<void>;
}

export class LoopBudgetError extends Error {
  constructor(
    readonly loop: LoopId,
    readonly field: keyof LoopBudget,
    readonly actual: number,
    readonly limit: number,
  ) {
    super(`loop ${loop} exceeded budget.${field}: ${actual} > ${limit}`);
    this.name = "LoopBudgetError";
  }
}

export class PhantomToolError extends Error {
  constructor(readonly toolName: string) {
    super(`phantom tool "${toolName}" is not in the registry (A4 §1.5)`);
    this.name = "PhantomToolError";
  }
}
