// US-D01: 모델 선택기 저장소. 허브에 설정 HTTP 라우트가 없다(packages/kernel/src/settings.ts의
// KV는 어디에서도 노출되지 않는다) — 스토리의 폴백 규칙대로 localStorage 한 곳에만 둔다.
// 일반 저장소 추상화는 만들지 않는다(YAGNI): 키 하나, 값 하나.
export const ASK_MODEL_STORAGE_KEY = "omnis.ask-model";

export const ASK_MODELS = [
  { id: "auto", label: "Auto" },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
] as const;

export type AskModelId = (typeof ASK_MODELS)[number]["id"];

export const DEFAULT_ASK_MODEL: AskModelId = "auto";

/** 저장된 값이 없거나 알 수 없는 문자열이면 Auto. localStorage 접근 자체가 던지는 환경
 *  (사파리 프라이빗 등)도 Auto로 떨어진다 — 패널이 이 값으로 렌더되므로 던지면 셸이 죽는다. */
export function readAskModel(): AskModelId {
  try {
    const raw = localStorage.getItem(ASK_MODEL_STORAGE_KEY);
    const found = ASK_MODELS.find((m) => m.id === raw);
    return found ? found.id : DEFAULT_ASK_MODEL;
  } catch {
    return DEFAULT_ASK_MODEL;
  }
}

export function writeAskModel(id: AskModelId): void {
  try {
    localStorage.setItem(ASK_MODEL_STORAGE_KEY, id);
  } catch {
    /* 저장 실패는 무시한다 — 이번 세션의 선택은 화면에 그대로 살아 있고, 다음 실행에 Auto로 돌아간다. */
  }
}

export function askModelLabel(id: AskModelId): string {
  return ASK_MODELS.find((m) => m.id === id)?.label ?? ASK_MODELS[0].label;
}
