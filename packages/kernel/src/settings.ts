// 델타 §5 (B-D2, US-B33): settings kv 테이블의 유일한 읽기·쓰기 경로.
import { query } from "@omnis/db";
import type { Pool } from "pg";

export type SettingKey =
  | "cost.cap_usd"
  | "cost.reserve_ratio"
  // 내부 키 — CostState 전이 감지가 쓰고 Settings 화면에는 노출하지 않는다(델타 §5).
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
  | "kakao.send_enabled_at";

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
};

export async function getSetting<T>(pool: Pool, key: SettingKey, fallback: T): Promise<T> {
  const rows = await query<{ value: T }>(pool, "SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? fallback;
}

/** 전체 키를 한 번에 읽는다 — 없는 행은 SETTING_DEFAULTS로 채운다(허브 `GET /settings`). */
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

/** audit_log는 계약 §5가 필수로 못박는다 — settings.ts는 pool만 받는 낮은 레벨 모듈이라
 * Kernel.audit(순환 의존 유발)을 거치지 않고 직접 insert한다(identity.ts와 같은 패턴). */
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
