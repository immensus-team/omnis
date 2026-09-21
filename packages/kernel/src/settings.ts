// Delta §5 (B-D2, US-B33): the only read/write path for the settings kv table.
import { query } from "@omnis/db";
import type { Pool } from "pg";

export type SettingKey =
  | "cost.cap_usd"
  | "cost.reserve_ratio"
  // Internal key — used by CostState transition detection, never exposed in the
  // Settings screen (delta §5).
  | "cost.last_state"
  | "notify.quiet_hours"
  | "notify.vip_override"
  | "archive.t1_confidence_min"
  | "archive.enabled"
  | "ingest.local_roots.mini"
  | "ingest.local_roots.macbook"
  | "ingest.drive_folders"
  | "ingest.github_repos"
  | "autonomy.rules"
  | "kakao.send_enabled_at"
  // Phase C (US-C00). `delegation.allow_rules` stays empty until Logan adds a rule in Settings →
  // Autonomy, so delegation keeps waiting for a human decision. `delegation.hermes_enabled` gates
  // the Hermes runtime (US-C07 rejects a hermes target while it is false) and `import.terminal_sessions`
  // gates the read-only terminal import job.
  | "delegation.allow_rules"
  | "delegation.hermes_enabled"
  | "import.terminal_sessions"
  // The instant the KakaoTalk reader last saw the room list stable — the 14-day send gate compares
  // against it, and null means "never observed yet".
  | "kakao.read_stable_since"
  // US-D10: the detail pane's layout. `ui.detail_width` is null while the pane has never been
  // dragged — null means "the shell's own default", not a number the client has to invent.
  | "ui.detail_width"
  | "ui.detail_collapsed"
  // The decision tier's provider switch — "llm" (default) or "jev".
  // See docs/decisions/2026-09-21-jev-decision-tier.md.
  | "agents.decision_provider";

export const SETTING_DEFAULTS: Readonly<Record<SettingKey, unknown>> = {
  "cost.cap_usd": 60,
  "cost.reserve_ratio": 0.1,
  "cost.last_state": null,
  "notify.quiet_hours": { start: "23:00", end: "07:00", vipOverride: true },
  "notify.vip_override": true,
  "archive.t1_confidence_min": 0.85,
  "archive.enabled": true,
  "ingest.local_roots.mini": [],
  "ingest.local_roots.macbook": [],
  "ingest.drive_folders": [],
  "ingest.github_repos": [],
  "autonomy.rules": [],
  "kakao.send_enabled_at": null,
  "delegation.allow_rules": [],
  "delegation.hermes_enabled": false,
  "import.terminal_sessions": false,
  "kakao.read_stable_since": null,
  // US-D10. Null, not 420: the width the layout ships with is a grid track at >=1280 and a sheet
  // below it, and baking a pixel value in here would make the two disagree on a fresh install.
  "ui.detail_width": null,
  "ui.detail_collapsed": false,
  "agents.decision_provider": "llm",
};

export async function getSetting<T>(pool: Pool, key: SettingKey, fallback: T): Promise<T> {
  const rows = await query<{ value: T }>(pool, "SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? fallback;
}

/** Reads every key at once — missing rows fall back to SETTING_DEFAULTS (hub `GET /settings`). */
export async function getAllSettings(pool: Pool): Promise<Record<SettingKey, unknown>> {
  const rows = await query<{ key: SettingKey; value: unknown }>(
    pool,
    "SELECT key, value FROM settings",
  );
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const entries = (Object.keys(SETTING_DEFAULTS) as SettingKey[]).map(
    (key) => [key, stored.get(key) ?? SETTING_DEFAULTS[key]] as const,
  );
  return Object.fromEntries(entries) as Record<SettingKey, unknown>;
}

/** Contract §5 mandates audit_log — settings.ts is a low-level, pool-only module, so it inserts
 * directly rather than through Kernel.audit (which would create a circular dependency), the same
 * pattern as identity.ts. */
export async function setSetting(
  pool: Pool,
  key: SettingKey,
  value: unknown,
  actor: string,
): Promise<void> {
  await query(
    pool,
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  await query(
    pool,
    `INSERT INTO audit_log (actor, action, target_table, after)
     VALUES ($1, 'settings.set', 'settings', jsonb_build_object('key', $2::text, 'value', $3::jsonb))`,
    [actor, key, JSON.stringify(value)],
  );
}
