// ponytail: falls back to $PGUSER (or "postgres", matching the CI `postgres:17` service
// container) instead of hardcoding this machine's OS role, so DATABASE_URL is the only
// thing a different developer or CI needs to override.
const DEFAULT_URL = `postgres://${process.env.PGUSER ?? "postgres"}@127.0.0.1:5432/omnis_test`;

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? DEFAULT_URL;
  if (!/omnis_test/.test(url)) {
    throw new Error(`refusing to wipe a database that is not omnis_test: ${url}`);
  }
  process.env.DATABASE_URL = url;

  // ponytail: root has no `pg` devDependency (pnpm strict isolation), so a static
  // `import { Client } from "pg"` at this file's top level fails to resolve when vitest
  // loads this as globalSetup from the repo root. `@omnis/db` (packages/db) already
  // depends on `pg` and re-exports `Pool`, so hoist the dynamic import and reuse that
  // instead of adding a root-level `pg` dependency for one admin connection.
  const { Pool, createPool, migrate, MIGRATIONS_DIR } = await import("./packages/db/src/index.js");

  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query("DROP SCHEMA IF EXISTS public CASCADE");
  await admin.query("CREATE SCHEMA public");
  await admin.end();

  const pool = createPool();
  try {
    await migrate(pool, MIGRATIONS_DIR);
  } finally {
    await pool.end();
  }
}
