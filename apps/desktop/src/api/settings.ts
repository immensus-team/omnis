// US-D10: the settings KV, read and written over the hub's HTTP surface. Writes go through the hub
// (contract §5) — Zero carries reads only, and a layout preference that has to survive a reload is
// a write.
//
// The `ui.detail_*` keys are the first settings the desktop app owns rather than displays. They are
// real SettingKeys (packages/kernel/src/settings.ts) and not localStorage entries: the pane's width
// belongs to the person, and localStorage is scoped to one browser profile on one machine.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** Every setting the hub knows, keyed as the KV spells it.
 *
 *  **Empty on any failure** rather than throwing. This is called once on mount to restore the
 *  pane's layout, and a hub that is not up yet is the ordinary case at boot — the shell then draws
 *  the default width and the default (expanded) state, which is exactly what it draws on a fresh
 *  install. A rejected promise here would take the whole shell down over a preference. */
export async function fetchSettings(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${HUB_HTTP_URL}/settings`);
    if (!res.ok) return {};
    const body = (await res.json()) as { settings?: Record<string, unknown> };
    return body.settings ?? {};
  } catch {
    return {};
  }
}

/** Writes one setting. Rejects on a non-2xx response — the caller decides what a failed write
 *  means, and for a layout preference it means the session keeps the width it already has. */
export async function putSetting(key: string, value: unknown): Promise<void> {
  const res = await fetch(`${HUB_HTTP_URL}/settings/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`setting ${key} failed: HTTP ${res.status}`);
}
