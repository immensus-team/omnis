// A4 §5.2: 결정 규칙이 먼저, LLM은 나중. 여기에 모델 호출은 없다(~1ms).
import type { HostId, RuntimeKind } from "@omnis/protocol";
import { getAgentsPool } from "../pool.js";

export const DELEGATION_DAILY_CAP = 5 as const;
export const DELEGATION_THREAD_CAP_24H = 2 as const;
export const MACBOOK_OFFLINE_MS = 120_000;

export interface DelegationHints {
  needs_paths: string[];
  needs_channel_session: boolean;
  needs_always_on: boolean;
  est_minutes: number | null;
  repo: string | null;
}

/** Phase B에서 hermes는 위임 대상이 아니다(B-D7, 마스터 §19 Q7). */
export type DelegationRuntime = Exclude<RuntimeKind, "hermes">;

export interface Routing {
  host: HostId;
  runtime?: DelegationRuntime;
  rule_id: string;
}

export interface HostHealth {
  mini: { lastHeartbeatMs: number };
  macbook: { lastHeartbeatMs: number };
}

const ABS_PATH = /(\/Users\/[\w./-]+|\/Volumes\/[\w./-]+|\/opt\/[\w./-]+)/g;
const GUI_CHANNEL = /카카오톡|kakao|linkedin|링크드인/i;
const ALWAYS_ON = /매일|매주|주기적|정기적으로|cron|스케줄/i;
const MINUTES = /(\d{1,3})\s*분/;
const HOURS = /(\d{1,2})\s*시간/;

export function extractHints(text: string): DelegationHints {
  const paths = [...new Set(text.match(ABS_PATH) ?? [])];
  const m = MINUTES.exec(text);
  const h = HOURS.exec(text);
  const est = m !== null ? Number(m[1]) : h !== null ? Number(h[1]) * 60 : null;
  return {
    needs_paths: paths,
    needs_channel_session: GUI_CHANNEL.test(text),
    needs_always_on: ALWAYS_ON.test(text),
    est_minutes: est,
    repo: paths[0] ?? null,
  };
}

export function routeByRule(h: DelegationHints, hosts: HostHealth): Routing | null {
  if (h.needs_paths.some((p) => p.startsWith("/Users/") && !p.startsWith("/Users/Shared"))) {
    return { host: "macbook", rule_id: "dr_local_files" };
  }
  if (h.needs_channel_session) return { host: "mini", rule_id: "dr_gui_session" };
  if ((h.est_minutes ?? 0) > 10) return { host: "mini", rule_id: "dr_long_batch" };
  if (h.needs_always_on) return { host: "mini", rule_id: "dr_always_on" };
  if (hosts.macbook.lastHeartbeatMs > MACBOOK_OFFLINE_MS) {
    return { host: "mini", rule_id: "dr_macbook_offline" };
  }
  return null; // 규칙이 못 가름 → L4(LLM, T2)
}

/** A4 §5.2 런타임 표. hermes는 Phase C로 미룬다(B-D7). */
export function pickRuntime(i: {
  filesTouched: number;
  specClear: boolean;
  liveCodexSession: boolean;
  isCode: boolean;
}): DelegationRuntime {
  if (!i.isCode) return "omnis";
  if (i.liveCodexSession) return "codex";
  if (i.filesTouched >= 3 || !i.specClear) return "claude_code";
  return "claude_ds";
}

export async function hostHealth(now: Date = new Date()): Promise<HostHealth> {
  const { rows } = await getAgentsPool().query<{ host: HostId; last_seen_at: Date | null }>(
    "SELECT host, max(last_seen_at) AS last_seen_at FROM agent_runtimes GROUP BY host",
  );
  const ms = (host: HostId): number => {
    const seen = rows.find((r) => r.host === host)?.last_seen_at ?? null;
    return seen === null ? Number.POSITIVE_INFINITY : now.getTime() - seen.getTime();
  };
  return { mini: { lastHeartbeatMs: ms("mini") }, macbook: { lastHeartbeatMs: ms("macbook") } };
}
