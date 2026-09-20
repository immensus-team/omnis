import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Pool as PgPool, PoolClient } from "pg";

// pg is CJS and lib/index.js does `module.exports = new PG(Client)`, so Node ESM's static named
// export analysis fails. `import { Pool } from "pg"` passes typecheck but dies at runtime with
// "does not provide an export named 'Pool'" (vitest hides this via Vite interop), so we take a
// default import and re-export the value and the type separately.
export const Pool: typeof pg.Pool = pg.Pool;
export type Pool = PgPool;
export type { PoolClient };
export { MigrationError, migrate } from "./migrate.js";

/** Absolute path to packages/db/migrations, the same for src (vitest) and dist (hub) runs. */
export const MIGRATIONS_DIR: string = fileURLToPath(new URL("../migrations", import.meta.url));

/** A3 §6.2. Payload is the id only, 8,000B limit. */
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
    throw new Error("DATABASE_URL is required (contract §9)");
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
