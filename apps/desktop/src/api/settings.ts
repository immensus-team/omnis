// US-B33's reads and writes. Every one of them is hub HTTP (contract §5): Zero is read-only, and
// the settings table is replicated for `row.select` only — the write path is `PUT /settings/:key`.
//
// OMNIS_HUB_HTTP_URL is on the interface contract §9 env list; when it is unset at build time the
// local default is used (the same line notes.ts and digest.ts carry).
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HUB_HTTP_URL}${path}`, init);
  if (!res.ok) throw new Error(`${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Delta §7's `GET /settings`: every SettingKey, stored row or SETTING_DEFAULTS. One call rather
 *  than a Zero query per key — the screen edits a dozen of them at once. */
export async function fetchSettings(): Promise<Record<string, unknown>> {
  const body = await json<{ settings: Record<string, unknown> }>("/settings");
  return body.settings;
}

/** `PUT /settings/:key`. `value` is the whole new value, not a patch — the hub upserts it into
 *  `settings.value` and audits the change (delta §5). */
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
