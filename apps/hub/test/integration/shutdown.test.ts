import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, one } from "@omnis/db";
import { afterAll, describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
// deviation: the plan text says `spawn("pnpm", ["exec", "tsx", MAIN])`. pnpm 9.12.3 in this
// environment forwards SIGTERM to the child (tsx) and then dies on the default disposition itself
// (re-raising), so the parent process's exit is always observed as
// {code:null, signal:'SIGTERM'} — even when the actual node process underneath exits cleanly with
// 0, that never reaches the pnpm wrapper's exit event (reproduced in isolation).
// Spawning the tsx binary directly, without pnpm, means that process holds our SIGTERM handler and
// returns exit(0)/exit(1) itself, which keeps the acceptance criteria (observed as a normal exit
// code) intact.
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
