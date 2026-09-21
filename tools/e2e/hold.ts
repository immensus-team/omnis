// Boots the seeded, densified stack (same fixture as shots.ts) and holds it up until SIGINT/SIGTERM,
// so a person or a Playwright script can use the real app. Used by the loop's user tests.
// Run: OMNIS_E2E_DB=<per-branch db> pnpm tsx tools/e2e/hold.ts [--web]   (desktop 5173; --web adds the PWA on 5174)
import { Pool } from "../../packages/db/src/index.js";
import { seed, varyInboxCopy } from "./seed.js";
import { densify } from "./shots.js";
import {
  HUB_PORT,
  VITE_PORT,
  ZERO_PORT,
  assertPortsFree,
  deployZeroPermissions,
  loadOrCreateEnv,
  resetDatabase,
  startDesktop,
  startHub,
  startWeb,
  startZeroCache,
  stopAll,
  waitForHttp,
} from "./stack.js";

const env = loadOrCreateEnv();
assertPortsFree();
await resetDatabase(env);
deployZeroPermissions(env);
startZeroCache(env);
await waitForHttp(`http://127.0.0.1:${ZERO_PORT}/`, 90_000);
startHub(env);
await waitForHttp(`http://127.0.0.1:${HUB_PORT}/health`, 60_000);
startDesktop();
await waitForHttp(`http://127.0.0.1:${VITE_PORT}/`, 90_000);
if (process.argv.includes("--web")) {
  startWeb(VITE_PORT + 1);
  await waitForHttp(`http://127.0.0.1:${VITE_PORT + 1}/`, 90_000);
}
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
const seeded = await seed(pool, env);
await varyInboxCopy(pool);
await densify(pool);
console.log("READY", JSON.stringify({ ...seeded, closeBridge: undefined }));

const shutdown = async (): Promise<void> => {
  seeded.closeBridge?.();
  await pool.end();
  await stopAll();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
