// A4 §6.1: drive_poll(10분)에 로컬·Drive가 동승하고 github_poll(15분)은 따로 돈다.
import { t1Model } from "@omnis/agents";
import { type Logger, type Scheduler, getSetting } from "@omnis/kernel";
import {
  createCalendarProvider,
  createGithubProvider,
  createLocalMacbookProvider,
  createLocalMiniProvider,
  createT1Extractor,
  reembedNulls,
  registerIngestProvider,
  runIngest,
  setExtractor,
  watchLocalRoots,
} from "@omnis/memory";
import type { Pool } from "pg";
import type { BridgeHub } from "./bridge.js";

export async function registerIngestJobs(deps: {
  pool: Pool;
  logger: Logger;
  scheduler: Scheduler;
  bridge: BridgeHub;
}): Promise<() => void> {
  const { pool, logger, scheduler, bridge } = deps;

  // OMNIS_OPENROUTER_API_KEY가 없으면 T1 추출은 꺼지고 T0 임베딩만 돈다 — 그래도 검색은 산다.
  try {
    setExtractor(createT1Extractor(t1Model()));
  } catch (e) {
    logger.warn("T1 extractor disabled", { err: e instanceof Error ? e.message : String(e) });
  }

  const miniRoots = await getSetting<string[]>(pool, "ingest.local_roots.mini", []);
  const macbookRoots = await getSetting<string[]>(pool, "ingest.local_roots.macbook", []);
  const repos = await getSetting<string[]>(pool, "ingest.github_repos", []);

  registerIngestProvider(createLocalMiniProvider({ roots: miniRoots }));
  registerIngestProvider(
    createLocalMacbookProvider({
      roots: macbookRoots,
      call: (method, params) => bridge.call("macbook", method, params),
    }),
  );
  registerIngestProvider(createCalendarProvider());
  registerIngestProvider(
    createGithubProvider({
      fetch: (url, init) => fetch(url, init),
      token: async () => process.env.OMNIS_GITHUB_TOKEN ?? "",
      repos,
    }),
  );
  // Drive provider는 OAuth 토큰 공급자(US-B34, Keychain omnis.gmail.<email> + refresh)가
  // 아직 없다 — 그때 createDriveProvider를 여기에 한 줄 더한다(계획 "열린 항목" #2).

  scheduler.register("drive_poll", "*/10 * * * *", async () => {
    await runIngest({ pool, logger, kind: "file" });
    await runIngest({ pool, logger, kind: "calendar" });
    await runIngest({ pool, logger, kind: "drive" });
    // A4 §10.5가 약속한 "다음 주기에 줍는다"를 실제로 부르는 유일한 자리. Ollama가 죽어 있던
    // 동안 embedding=NULL로 들어간 행은 여기서만 살아난다. 임베딩 모델·프리픽스가 바뀌어
    // 기존 벡터를 버려야 할 때도 이 틱이 되메운다(ops/mini/RUNBOOK.md "임베딩 재생성").
    const filled = await reembedNulls(pool);
    if (filled > 0) logger.info("reembedded memories", { filled });
  });
  scheduler.register("github_poll", "*/15 * * * *", async () => {
    await runIngest({ pool, logger, kind: "github" });
  });

  // A4 §10.6: 주간 제외 규칙 점검. **--gate-only가 필수다** — 채점 모드는 DATABASE_URL이
  // 가리키는 DB에 골든 세트 50건을 시드하는데, 허브의 DATABASE_URL은 실 DB(omnis)라서
  // 가짜 기억이 영구히 검색에 섞인다. recall 채점은 CI/개발 DB의 몫이다.
  // 실패해도 허브를 죽이지 않는다 — 결과는 로그와 다음 브리핑이 알린다.
  scheduler.register("eval_weekly", "0 22 * * 0", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    try {
      const { stdout } = await run("pnpm", ["eval:memory", "--gate-only"], { cwd: process.cwd() });
      logger.info("memory deny-pattern gate", { report: stdout.trim().slice(0, 2000) });
    } catch (e) {
      logger.error("memory deny-pattern gate failed", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // A4 §10.1: 미니는 FSEvents 실시간 + 부팅 시 1회 재스캔. 통지는 다음 틱을 당기지 않고
  // 로그만 남긴다 — 10분 틱이면 충분하고, 저장 폭풍마다 임베딩을 돌릴 이유가 없다.
  // ponytail: 즉시성이 필요해지면 여기서 디바운스된 runIngest를 부른다.
  return watchLocalRoots({
    roots: miniRoots,
    logger,
    onChange: (path) => logger.debug("local file changed", { path }),
  });
}
