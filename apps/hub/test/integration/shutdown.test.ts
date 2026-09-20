import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, one } from "@omnis/db";
import { afterAll, describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
// deviation: 계획 원문은 `spawn("pnpm", ["exec", "tsx", MAIN])`다. 이 환경의 pnpm 9.12.3은
// SIGTERM을 자식(tsx)에 전달한 뒤 자기 자신도 default disposition으로 죽어(재신호) 부모
// 프로세스의 exit는 항상 {code:null, signal:'SIGTERM'}로 관측된다 — 그 아래 실제 node
// 프로세스가 0으로 정상 종료해도 pnpm 래퍼의 exit event에는 반영되지 않는다(격리 재현 완료).
// tsx 바이너리를 pnpm 없이 직접 spawn하면 그 프로세스 자체가 우리 SIGTERM 핸들러를 갖고
// exit(0)/exit(1)을 직접 반환하므로 acceptance criteria(정상 종료 코드로 관측)를 그대로 지킨다.
const TSX_BIN = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));
const PORT = "8799";

function startProcess(): ReturnType<typeof spawn> {
  return spawn(TSX_BIN, [MAIN], {
    env: { ...process.env, OMNIS_HUB_PORT: PORT },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(ms = 15_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - started > ms) throw new Error("hub never became healthy");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const pool = createPool();
afterAll(async () => {
  await pool.end();
});

describe("graceful shutdown", () => {
  it("serves /health, then exits 0 on SIGTERM within 10s", async () => {
    const child = startProcess();
    const exited = new Promise<number | null>((resolve) =>
      child.on("exit", (code) => resolve(code)),
    );
    await waitForHealth();

    const body = (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const t0 = Date.now();
    child.kill("SIGTERM");
    const code = await exited;
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(10_000);

    await expect(fetch(`http://127.0.0.1:${PORT}/health`)).rejects.toThrow();
  });

  it("leaves no claimed job behind and audits the stop", async () => {
    const stuck = await one<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM jobs WHERE claimed_at IS NOT NULL",
    );
    expect(stuck.n).toBe("0");

    const audited = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_log WHERE action = 'hub.stopped'`,
    );
    expect(Number(audited.n)).toBeGreaterThanOrEqual(1);
  });

  it("exits 0 on SIGINT too", async () => {
    const child = startProcess();
    const exited = new Promise<number | null>((resolve) =>
      child.on("exit", (code) => resolve(code)),
    );
    await waitForHealth();
    child.kill("SIGINT");
    expect(await exited).toBe(0);
  });
});
