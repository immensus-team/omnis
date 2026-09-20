// A4 §12.1: T1 = DeepSeek V4.1 Flash via OpenRouter(토큰 마크업 없음).
// provider SDK import는 이 디렉터리 밖으로 나가지 않는다(A7 §7 공통 금지의 어댑터 격리 규칙).
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const T1_BASE_URL = "https://openrouter.ai/api/v1";
/** OpenRouter 라우팅 슬러그. agent_runs.model에 넣는 값과 다르다. */
export const T1_MODEL_ID = "deepseek/deepseek-v4.1-flash";
/** A3 §4 agent_runs.model 컬럼에 기록하는 값(A4 §12.1 표기 그대로). */
export const T1_RUN_MODEL = "deepseek-v4.1-flash";

/** 키는 Keychain `omnis.openrouter.api_key`(A6-D9)에서 launchd가 env로 주입한다. 값은 절대 로그에 넣지 않는다. */
export function t1Model() {
  const apiKey = process.env.OMNIS_OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OMNIS_OPENROUTER_API_KEY is not set (Keychain item omnis.openrouter.api_key)");
  }
  return createOpenAICompatible({ name: "openrouter", baseURL: T1_BASE_URL, apiKey })(T1_MODEL_ID);
}
