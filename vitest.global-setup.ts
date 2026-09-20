import { Client } from "pg";

const DEFAULT_URL = "postgres://logankim@127.0.0.1:5432/omnis_test";

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? DEFAULT_URL;
  if (!/omnis_test/.test(url)) {
    throw new Error(`refusing to wipe a database that is not omnis_test: ${url}`);
  }
  process.env.DATABASE_URL = url;

  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE");
  await c.query("CREATE SCHEMA public");
  await c.end();

  const { createPool, migrate, MIGRATIONS_DIR } = await import("./packages/db/src/index.js");
  const pool = createPool();
  try {
    await migrate(pool, MIGRATIONS_DIR);
  } finally {
    await pool.end();
  }
}
