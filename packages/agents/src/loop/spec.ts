// A4 §1.1·§1.2. The kernel knows nothing about loops; it knows only this contract.
import type { z } from "zod";
import type { AssembledContext } from "../context/assemble.js";
import type { ToolName } from "../tools/names.js";

/** A4 §1.1. A subset of agent_runs.loop — the 'summarize' Phase A added is not a loop but the B3 summary helper. */
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
  /** kind='event': kernel event kind. e.g. 'item.labeled' */
  on?: string;
  /** kind='event': predicate evaluated in the hub. Not evaluated by a model. */
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

/**
 * Returned by `decide()` to end the run with no model call AND no `apply()` — the veto the
 * decision tier needs (a Jev "do not draft this" must not reach propose_draft). Distinct from
 * returning null, which means "carry on to the model path".
 */
export interface LoopSkip {
  skip: string;
}

/** Envelope holding what a loop runs against (delta §4 names this plan's Task 1 as the owner). */
export interface TriggerContext {
  trigger_kind: "event" | "cron" | "manual";
  /** Cron job name only. Item triggers use item_id, not trigger_ref (A4 §1.7). */
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
  /** Irreversible tools cannot go in here — registerLoop blocks them with PhantomToolError (A4-D3). */
  palette: ReadonlyArray<ToolName>;
  budget: LoopBudget;
  tier: "T0" | "T1" | "T2";
  /** The input type is left open as unknown — fields carrying `.default([])` (house rule:
   *  classify-t1.ts, propose.ts) have a parse input that differs from the output, so they do not
   *  fit `z.ZodType<TOut>`. We only parse, so pinning just the output type is enough. */
  outputSchema: z.ZodType<TOut, z.ZodTypeDef, unknown>;
  /** T0 path that reaches a conclusion with no model generation. Returning null falls through to
   *  the model path; returning a LoopSkip ends the run without applying anything.
   *  Auto-archive ①③④ from A4 §9.2 and the decision tier's vetoes go in this slot. */
  decide?(ctx: TriggerContext): Promise<Omit<LoopResult<TOut>, "run_id"> | LoopSkip | null>;
  assemble(ctx: TriggerContext): Promise<AssembledContext>;
  /** Writes proposals only. Egress modules must not be imported here either (A4 §1.1). */
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
