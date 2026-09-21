// The decision tier's contract. A "decision" is a typed question about one piece of state,
// answered without text generation — see docs/decisions/2026-09-21-jev-decision-tier.md.
//
// This module deliberately imports nothing from a provider SDK: the question shape below is
// structurally the AI SDK's `Experimental_EvaluationQuestion`, and providers/jev.ts is what
// translates it. Same adapter-isolation rule as src/t1/provider.ts (A7 §7).

/** A4's decisions that a typed-answer model can take over. Closed set — a new kind needs a memo entry. */
export type DecisionKind =
  | "classify"
  | "auto_archive"
  | "draft_worthiness"
  | "delegation"
  | "followup"
  | "sensitivity";

/** Descriptions may be omitted; `null` means "no description", matching the AI SDK's question shape. */
export type DecisionQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "boolean"; instructions: string; criteria?: { true?: string; false?: string } };

export interface DecisionRequest {
  kind: DecisionKind;
  /** The one shared state this call evaluates. Untrusted inbound text goes here, never instructions. */
  state: string;
  questions: Record<string, DecisionQuestion>;
}

/** Normalised across the three answer types so call sites never branch on the raw provider shape. */
export interface DecisionAnswer {
  type: "choice" | "score" | "boolean";
  /** type='choice' */
  choice?: string;
  /** type='boolean' — estimated P(true), not confidence in the answer. */
  probability?: number;
  /** type='score' */
  score?: number;
  probabilities?: Record<string, number>;
}

export interface DecisionResponse {
  answers: Record<string, DecisionAnswer>;
  /**
   * TypeSafe's per-question confidence (`providerMetadata.typesafe.confidence`). Diagnostic only:
   * the AI SDK docs say it is neither the selected option's probability nor a portable measure,
   * so no call site may gate a safety decision on it.
   */
  confidence: Record<string, number>;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface Decider {
  /** agent_runs.provider / agent_runs.model for runs this decider took. */
  readonly run: { provider: string; model: string };
  /** False when there is no credential. The router then keeps the existing LLM path. */
  available(): Promise<boolean>;
  decide(request: DecisionRequest): Promise<DecisionResponse>;
}

export class DeciderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeciderUnavailableError";
  }
}

/** Reads a JSON string out of an answer's distribution, if the provider returned one. */
export function probabilityOf(response: DecisionResponse, questionId: string): number | null {
  const a = response.answers[questionId];
  if (a === undefined) return null;
  if (a.type === "boolean") return a.probability ?? null;
  if (a.choice !== undefined) return a.probabilities?.[a.choice] ?? null;
  return null;
}

/**
 * Reads a choice answer, rejecting anything outside `allowed`. A model that answers with an
 * unknown option must not reach a call site as a cast — it returns null and the LLM path runs.
 */
export function choiceOf(
  response: DecisionResponse,
  questionId: string,
  allowed: readonly string[],
): string | null {
  const a = response.answers[questionId];
  if (a === undefined || a.type !== "choice" || a.choice === undefined) return null;
  return allowed.includes(a.choice) ? a.choice : null;
}
