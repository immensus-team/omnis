// A4 §12.1: T2 = Claude Sonnet 5 하나뿐이다. 게이트웨이는 OpenRouter(토큰 마크업 없음).
// Anthropic 직접 경로는 Message Batches(§6.5)에서만 쓴다 — 그건 SDK 없이 fetch로 친다.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const T2_BASE_URL = "https://openrouter.ai/api/v1";
/** OpenRouter 라우팅 슬러그. */
export const T2_MODEL_ID = "anthropic/claude-sonnet-5";
/** A3 §4 agent_runs.model에 기록하는 값(A4 §12.1 표기 그대로). */
export const T2_RUN_MODEL = "claude-sonnet-5";

/** 키는 Keychain `omnis.openrouter.api_key`(A6-D9)에서 launchd가 env로 주입한다. 값은 로그에 넣지 않는다. */
export function t2Model(): LanguageModel {
  const apiKey = process.env.OMNIS_OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OMNIS_OPENROUTER_API_KEY is not set (Keychain item omnis.openrouter.api_key)");
  }
  return createOpenAICompatible({ name: "openrouter", baseURL: T2_BASE_URL, apiKey })(T2_MODEL_ID);
}
