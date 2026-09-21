// The flag that decides whether omnis asks Jev or keeps asking the LLM.
//
// Default is "llm", and the flag is checked BEFORE anything Jev-shaped is constructed, so an
// unset (or "llm") setting means zero Jev calls and zero Jev construction. Every failure mode —
// no credential, timeout, transport error, an answer outside the allowed options — also returns
// null, so a call site's existing path is what runs. Fail-open by design; see the memo.
import type { Pool } from "pg";
import { getAgentsPool } from "../pool.js";
import { JevDecider } from "../providers/jev.js";
import type { Decider, DecisionRequest, DecisionResponse } from "./types.js";

/** Read straight from the settings kv table: @omnis/agents cannot depend on @omnis/kernel. */
export const DECISION_PROVIDER_KEY = "agents.decision_provider";
export type DecisionProvider = "llm" | "jev";
export const DEFAULT_DECISION_PROVIDER: DecisionProvider = "llm";

/** Anything that is not exactly "jev" is the default. A typo in the settings row cannot switch providers. */
export function parseDecisionProvider(value: unknown): DecisionProvider {
  return value === "jev" ? "jev" : "llm";
}

export async function activeDecisionProvider(
  pool: Pool | undefined = undefined,
): Promise<DecisionProvider> {
  const { rows } = await (pool ?? getAgentsPool()).query<{ value: unknown }>(
    "SELECT value FROM settings WHERE key = $1",
    [DECISION_PROVIDER_KEY],
  );
  return parseDecisionProvider(rows[0]?.value);
}

export interface DecisionOptions {
  pool?: Pool;
  /** Test seam. Still gated by the flag — injecting a decider does not bypass the setting. */
  jev?: Decider | null;
}

/**
 * A call site whose state costs a query passes a thunk, so that read happens only when the flag is
 * on; a thunk resolving to null means "the state is gone, abstain".
 */
export type DecisionRequestSource =
  | DecisionRequest
  | null
  | (() => Promise<DecisionRequest | null>);

/**
 * The one entry point every call site uses. Returns null when omnis should keep doing what it
 * does today: flag off, no credential, or Jev failed.
 */
export async function decideOrNull(
  request: DecisionRequestSource,
  opts: DecisionOptions = {},
): Promise<DecisionResponse | null> {
  if ((await activeDecisionProvider(opts.pool)) !== "jev") return null;

  const decider = opts.jev === undefined ? new JevDecider() : opts.jev;
  if (decider === null) return null;

  // A thunk's kind is unknown until it resolves, so the log names it generically.
  const kind = typeof request === "function" ? "request" : (request?.kind ?? "request");
  try {
    const req = typeof request === "function" ? await request() : request;
    if (req === null) return null;
    if (!(await decider.available())) return null;
    return await decider.decide(req);
  } catch (e) {
    // A degraded path is worth a line in the log and nothing more — the caller still concludes.
    console.warn(
      `[decision] ${kind}: Jev failed, falling back to the LLM path — ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }
}
