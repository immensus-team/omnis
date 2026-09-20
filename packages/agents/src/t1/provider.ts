// A4 §12.1: T1 = DeepSeek V4.1 Flash via OpenRouter (no token markup).
// provider SDK imports never leave this directory (the adapter-isolation rule under A7 §7 common prohibitions).
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const T1_BASE_URL = "https://openrouter.ai/api/v1";
/** OpenRouter routing slug. Different from the value written to agent_runs.model. */
export const T1_MODEL_ID = "deepseek/deepseek-v4.1-flash";
/** The value recorded in the A3 §4 agent_runs.model column (A4 §12.1 notation, verbatim). */
export const T1_RUN_MODEL = "deepseek-v4.1-flash";

/** The key is injected as env by launchd from Keychain `omnis.openrouter.api_key` (A6-D9). Never put the value in a log. */
export function t1Model(): LanguageModel {
  const apiKey = process.env.OMNIS_OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OMNIS_OPENROUTER_API_KEY is not set (Keychain item omnis.openrouter.api_key)");
  }
  return createOpenAICompatible({ name: "openrouter", baseURL: T1_BASE_URL, apiKey })(T1_MODEL_ID);
}
