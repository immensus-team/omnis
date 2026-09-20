// Phase A 종단 스모크의 프로세스/DB 스택. 워크스페이스 밖(tools/)에 두고 루트
// `pnpm e2e:phase-a`(= tsx tools/e2e/run.ts)로만 부른다 — 프로덕션 코드가 아니다.
//
// 여기서 띄우는 것: omnis_e2e DB(마이그레이션 + Zero permissions) → zero-cache(4848)
// → 허브(8787) → Vite 데스크톱 dev 서버(5173). 로컬 에이전트 브리지는 seed.ts가
// 같은 프로세스 안에서 WS /bridge에 붙는다.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MIGRATIONS_DIR, Pool, migrate, query } from "../../packages/db/src/index.js";

export const E2E_DIR = fileURLToPath(new URL(".", import.meta.url));
export const REPO_ROOT = join(E2E_DIR, "..", "..");
export const EVIDENCE_DIR = join(E2E_DIR, "evidence");
const LOG_DIR = join(E2E_DIR, ".logs");
const TMP_DIR = join(E2E_DIR, ".tmp");
const ENV_FILE = join(E2E_DIR, ".env");

export const DB_NAME = "omnis_e2e";
export const HUB_PORT = 8787;
export const ZERO_PORT = 4848;
export const VITE_PORT = 5173;
/** 계약 §8: 이 스모크의 브리지는 macbook 호스트로 붙는다. */
export const BRIDGE_HOST = "macbook";

export type E2EEnv = Record<string, string>;

const PG_SUPERUSER = process.env.PGUSER ?? userInfo().username;

/** tools/e2e/.env를 없으면 만든다. 비밀 4종은 이 스모크 전용 1회성 난수다(절대 출력하지 않는다). */
export function loadOrCreateEnv(): E2EEnv {
  if (!existsSync(ENV_FILE)) {
    const secret = (): string => randomBytes(24).toString("base64url");
    writeFileSync(
      ENV_FILE,
      [
        "# 생성됨: tools/e2e/stack.ts. 1회성 로컬 스모크 전용 — 커밋되지 않는다(.gitignore의 .env).",
        `DATABASE_URL=postgres://${PG_SUPERUSER}@127.0.0.1:5432/${DB_NAME}`,
        "OMNIS_USER_ID=logan",
        `OMNIS_HUB_PORT=${HUB_PORT}`,
        `ZERO_PORT=${ZERO_PORT}`,
        `ZERO_AUTH_SECRET=${secret()}`,
        `ZERO_ADMIN_PASSWORD=${secret()}`,
        `OMNIS_BRIDGE_TOKEN=${secret()}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
  }
  const env: E2EEnv = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

function psql(db: string, sql: string): string {
  const r = spawnSync("psql", ["-X", "-q", "-A", "-t", "-U", PG_SUPERUSER, "-d", db, "-c", sql], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`psql ${db} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** zero-cache가 남긴 슬롯이 살아 있으면 DROP DATABASE가 막힌다. 죽이고 지운다. */
export function dropReplicationSlots(): void {
  psql(
    "postgres",
    `SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots
       WHERE database = '${DB_NAME}' AND active_pid IS NOT NULL`,
  );
  psql(
    "postgres",
    `SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
       WHERE database = '${DB_NAME}'`,
  );
}

export function dropDatabase(): void {
  dropReplicationSlots();
  spawnSync("dropdb", ["-U", PG_SUPERUSER, "--if-exists", "--force", DB_NAME], {
    encoding: "utf8",
  });
}

/** 멱등: 있으면 지우고 다시 만든다. 두 번 연속 실행해도 같은 결과여야 한다(run.ts의 idempotence 체크). */
export async function resetDatabase(env: E2EEnv): Promise<void> {
  dropDatabase();
  const created = spawnSync("createdb", ["-U", PG_SUPERUSER, DB_NAME], { encoding: "utf8" });
  if (created.status !== 0) throw new Error(`createdb failed: ${created.stderr}`);
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    await migrate(pool, MIGRATIONS_DIR);
    // zero-cache는 REPLICATION 권한이 필요하다. 이 스모크는 superuser 하나로 돈다(ops/zero-cache.env.example의 1회성 기동 절차).
    await query(pool, "SELECT 1");
  } finally {
    await pool.end();
  }
}

export function deployZeroPermissions(env: E2EEnv): void {
  const r = spawnSync("pnpm", ["zero:deploy-permissions"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ZERO_UPSTREAM_DB: env.DATABASE_URL ?? "",
      OMNIS_USER_ID: env.OMNIS_USER_ID ?? "logan",
    },
  });
  if (r.status !== 0) {
    throw new Error(`zero:deploy-permissions failed:\n${r.stdout}\n${r.stderr}`);
  }
}

const running: { name: string; child: ChildProcess }[] = [];

function start(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  mkdirSync(LOG_DIR, { recursive: true });
  const fd = openSync(join(LOG_DIR, `${name}.log`), "w");
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, stdio: ["ignore", fd, fd] });
  running.push({ name, child });
  return child;
}

export function logPath(name: string): string {
  return join(LOG_DIR, `${name}.log`);
}

export async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr}`);
}

export function startZeroCache(env: E2EEnv): void {
  mkdirSync(TMP_DIR, { recursive: true });
  const replica = join(TMP_DIR, "zero-replica.db");
  rmSync(replica, { force: true });
  start("zero-cache", join(REPO_ROOT, "apps/desktop/node_modules/.bin/zero-cache"), [], {
    ...process.env,
    ZERO_UPSTREAM_DB: env.DATABASE_URL ?? "",
    ZERO_CVR_DB: env.DATABASE_URL ?? "",
    ZERO_CHANGE_DB: env.DATABASE_URL ?? "",
    ZERO_REPLICA_FILE: replica,
    ZERO_APP_PUBLICATIONS: "zero_omnis",
    ZERO_PORT: String(ZERO_PORT),
    ZERO_ADMIN_PASSWORD: env.ZERO_ADMIN_PASSWORD ?? "",
    ZERO_AUTH_SECRET: env.ZERO_AUTH_SECRET ?? "",
  });
}

export function startHub(env: E2EEnv): void {
  start(
    "hub",
    join(REPO_ROOT, "node_modules/.bin/tsx"),
    [join(REPO_ROOT, "apps/hub/src/main.ts")],
    {
      ...process.env,
      DATABASE_URL: env.DATABASE_URL ?? "",
      OMNIS_HUB_PORT: String(HUB_PORT),
      OMNIS_USER_ID: env.OMNIS_USER_ID ?? "logan",
      ZERO_AUTH_SECRET: env.ZERO_AUTH_SECRET ?? "",
      OMNIS_BRIDGE_TOKEN: env.OMNIS_BRIDGE_TOKEN ?? "",
    },
  );
}

export function startDesktop(): void {
  start("desktop", "pnpm", ["--filter", "@omnis/desktop", "dev"], {
    ...process.env,
    // 빈 문자열 = 상대 경로 → vite dev 프록시가 허브로 넘긴다(apps/desktop/vite.config.ts).
    OMNIS_HUB_HTTP_URL: "",
  });
}

/** 앞선 실행이나 다른 워크트리가 포트를 쥐고 있으면 조용히 "이미 떠 있다"고 착각한다. */
export function assertPortsFree(): void {
  for (const port of [HUB_PORT, ZERO_PORT, VITE_PORT]) {
    const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    const pids = r.stdout.trim();
    if (pids !== "") {
      throw new Error(
        `port ${port} is already taken by pid(s) ${pids.split("\n").join(",")} — stop it before running the smoke`,
      );
    }
  }
}

export async function stopAll(): Promise<void> {
  for (const { child } of running) child.kill("SIGTERM");
  const deadline = Date.now() + 10_000;
  while (running.some((r) => r.child.exitCode === null && r.child.signalCode === null)) {
    if (Date.now() > deadline) {
      for (const { child } of running) child.kill("SIGKILL");
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  running.length = 0;
}
