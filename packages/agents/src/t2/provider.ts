// A4 §12.1: T2 = Claude Sonnet 5, and nothing else. The gateway is OpenRouter (no token markup).
// The direct Anthropic path is used only for Message Batches (§6.5) — that one goes over raw fetch, no SDK.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const T2_BASE_URL = "https://openrouter.ai/api/v1";
/** OpenRouter routing slug. */
export const T2_MODEL_ID = "anthropic/claude-sonnet-5";
/** The value recorded in the A3 §4 agent_runs.model column (A4 §12.1 notation, verbatim). */
export const T2_RUN_MODEL = "claude-sonnet-5";

/** The key is injected as env by launchd from Keychain `omnis.openrouter.api_key` (A6-D9). Never put the value in a log. */
export function t2Model(): LanguageModel {
  const apiKey = process.env.OMNIS_OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OMNIS_OPENROUTER_API_KEY is not set (Keychain item omnis.openrouter.api_key)");
  }
  return createOpenAICompatible({ name: "openrouter", baseURL: T2_BASE_URL, apiKey })(T2_MODEL_ID);
}
