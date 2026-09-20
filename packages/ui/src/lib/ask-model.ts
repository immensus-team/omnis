// US-D01: the model picker's store. The hub has no settings HTTP route (the KV in
// packages/kernel/src/settings.ts is not exposed anywhere) — per the story's fallback rule it
// lives in localStorage and nowhere else. No general storage abstraction is built for it (YAGNI):
// one key, one value.
export const ASK_MODEL_STORAGE_KEY = "omnis.ask-model";

export const ASK_MODELS = [
  { id: "auto", label: "Auto" },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
] as const;

export type AskModelId = (typeof ASK_MODELS)[number]["id"];

export const DEFAULT_ASK_MODEL: AskModelId = "auto";

/** Auto when nothing is stored or the stored string is unknown. An environment where touching
 *  localStorage itself throws (Safari private mode and friends) falls back to Auto too — the panel
 *  renders from this value, so throwing here would take the shell down with it. */
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
    /* A failed write is ignored — this session's choice is still live on screen, and the next run
       comes back to Auto. */
  }
}

export function askModelLabel(id: AskModelId): string {
  return ASK_MODELS.find((m) => m.id === id)?.label ?? ASK_MODELS[0].label;
}
