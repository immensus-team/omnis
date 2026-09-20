import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

/** omnis migration advisory lock (A3 §8). */
const LOCK = 8_931_447;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export async function migrate(pool: Pool, dir: string): Promise<{ applied: string[] }> {
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS _omnis_migrations (
      name text PRIMARY KEY,
      sha text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    await c.query("SELECT pg_advisory_lock($1)", [LOCK]);
    try {
      const doneRes = await c.query<{ name: string; sha: string }>(
        "SELECT name, sha FROM _omnis_migrations",
      );
      const done = new Map(doneRes.rows.map((r) => [r.name, r.sha]));
      const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

      for (const f of files) {
        const sql = await readFile(join(dir, f), "utf8");
        const sha = createHash("sha256").update(sql).digest("hex");
        const prev = done.get(f);
        if (prev === sha) continue;
        if (prev !== undefined) {
          throw new MigrationError(`migration ${f} changed after apply (${prev} -> ${sha})`);
        }
        const inTx = !f.endsWith(".noxact.sql");
        if (inTx) await c.query("BEGIN");
        try {
          await c.query(sql);
          await c.query("INSERT INTO _omnis_migrations (name, sha) VALUES ($1, $2)", [f, sha]);
          if (inTx) await c.query("COMMIT");
          applied.push(f);
        } catch (e) {
          if (inTx) await c.query("ROLLBACK");
          throw e;
        }
      }
    } finally {
      await c.query("SELECT pg_advisory_unlock($1)", [LOCK]);
    }
  } finally {
    c.release();
  }
  return { applied };
}
