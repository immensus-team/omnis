import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

export { Pool, type PoolClient } from "pg";

/** packages/db/migrations 절대경로. src 실행(vitest)과 dist 실행(hub) 양쪽에서 같은 곳을 가리킨다. */
export const MIGRATIONS_DIR: string = fileURLToPath(new URL("../migrations", import.meta.url));

/** A3 §6.2. 페이로드는 id만, 8,000B 한도. */
export const NOTIFY_CHANNELS: readonly string[] = [
  "omnis_item",
  "omnis_thread",
  "omnis_approval",
  "omnis_task",
  "omnis_session",
  "omnis_job",
  "omnis_control",
] as const;

export function createPool(env: NodeJS.ProcessEnv = process.env): Pool {
  const connectionString = env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is required (계약 §9)");
  }
  return new Pool({ connectionString, max: 10, application_name: "omnis-hub" });
}

export async function query<T>(
  c: Pool | PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await c.query(sql, params as unknown[]);
  return result.rows as T[];
}

export async function one<T>(
  c: Pool | PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const rows = await query<T>(c, sql, params);
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`expected exactly 1 row, got ${rows.length}`);
  }
  return row;
}

export async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
