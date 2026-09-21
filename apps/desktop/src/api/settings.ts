// US-B33's reads and writes. Every one of them is hub HTTP (contract §5): Zero is read-only, and
// the settings table is replicated for `row.select` only — the write path is `PUT /settings/:key`.
//
// OMNIS_HUB_HTTP_URL is on the interface contract §9 env list; when it is unset at build time the
// local default is used (the same line notes.ts and digest.ts carry).
//
// US-D10 added the `ui.detail_*` keys: the first settings the desktop app owns rather than displays.
// They are real SettingKeys (packages/kernel/src/settings.ts) and not localStorage entries — the
// pane's width belongs to the person, and localStorage is scoped to one browser profile on one
// machine, while a layout preference has to survive a reload.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** The strict helper: rejects on a non-2xx, for the calls whose caller has a failure state to draw
 *  (`fetchCost`/`fetchKillSwitch` drive the Settings screen's `data-state="error"`). */
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HUB_HTTP_URL}${path}`, init);
  if (!res.ok) throw new Error(`${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Delta §7's `GET /settings`: every SettingKey, stored row or SETTING_DEFAULTS. One call rather
 *  than a Zero query per key — the screen edits a dozen of them at once.
 *
 *  **Empty on any failure** rather than throwing. The shell also calls this once on mount to restore
 *  the pane's layout, at the same moment it opens the Zero socket — so a hub that is not answering
 *  yet is the ordinary boot race, not an error. Drawing the default pane is the right answer to it;
 *  a rejection would take the whole shell down over a preference. */
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

/** `PUT /settings/:key`. `value` is the whole new value, not a patch — the hub upserts it into
 *  `settings.value` and audits the change (delta §5).
 *
 *  Unlike the read, a failed write rejects: the caller has to know, because the surface it just
 *  changed is claiming something the hub did not accept. */
export async function putSetting(key: string, value: unknown): Promise<void> {
  await json(`/settings/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

/** Delta §7's `GET /cost` — A4 §12.4's live policy. `currentPolicy` does not report the cap, so the
 *  hub reads it off `settings` and puts it on the same response. */
export interface CostReport {
  state: string;
  mtdUsd: number;
  capUsd: number;
  reserveUsd: number;
}

export function fetchCost(): Promise<CostReport> {
  return json<CostReport>("/cost");
}

/** `GET /kill-switch` — the newest `audit_log` row is the whole state (contract §5). */
export interface KillSwitchStatus {
  on: boolean;
  since: string | null;
  reason: string | null;
}

export function fetchKillSwitch(): Promise<KillSwitchStatus> {
  return json<KillSwitchStatus>("/kill-switch");
}

/** `POST /kill-switch`. The hub requires a non-empty reason, so the screen has to say why. */
export async function setKillSwitch(on: boolean, reason: string): Promise<void> {
  await json("/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ on, reason }),
  });
}
