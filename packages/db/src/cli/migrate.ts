import { MIGRATIONS_DIR, createPool } from "../index.js";
import { migrate } from "../migrate.js";

const pool = createPool();
try {
  const { applied } = await migrate(pool, MIGRATIONS_DIR);
  console.log(
    applied.length === 0 ? "up to date" : `applied ${applied.length}: ${applied.join(", ")}`,
  );
} finally {
  await pool.end();
}
