import { configureAgents, startLoops, summarizeThread } from "@omnis/agents";
import { createPool } from "@omnis/db";
import {
  type Logger,
  assertZeroPublication,
  createKernel,
  createLogger,
  registerCostDailyJob,
  registerHealthcheckJob,
} from "@omnis/kernel";
import { createBridgeHub } from "./bridge.js";
import { type HubConfig, readConfig } from "./config.js";
import { createHubServer } from "./http.js";
import { registerSummaryJob } from "./summarize-job.js";

export interface RunningHub {
  config: HubConfig;
  port: number;
  close(): Promise<void>;
}

export async function startHub(env: NodeJS.ProcessEnv = process.env): Promise<RunningHub> {
  const config = readConfig(env);
  const logger = createLogger("@omnis/hub");
  const pool = createPool(env);
  const kernel = createKernel({ pool, logger });
  // Zero 스키마와 publication이 어긋난 채로 떠 있으면 데스크톱이 빈 인박스를 본다. 부팅에서 깨뜨린다.
  await assertZeroPublication(pool);

  registerHealthcheckJob(kernel.scheduler, { pool, events: kernel.events });
  registerCostDailyJob(kernel.scheduler, { pool, audit: kernel.audit, logger });
  await kernel.scheduler.start();

  // B3: kinso 인박스 행의 AI 한 줄 요약 — @omnis/agents는 모듈 싱글톤 pool을 쓴다(pool.ts).
  configureAgents({ pool });
  const stopSummaryJob = registerSummaryJob({
    events: kernel.events,
    logger,
    summarizeThread,
  });
  // 등록된 루프를 커널 이벤트/스케줄러에 건다(A4 §1.2).
  const stopLoops = startLoops({ kernel, logger });

  const bridge = createBridgeHub({ kernel, pool, logger, token: config.bridgeToken });
  if (config.bridgeToken === "") {
    logger.warn("OMNIS_BRIDGE_TOKEN is empty — WS /bridge refuses every upgrade with 503");
  }
  const startedAt = Date.now();
  const server = createHubServer({
    kernel,
    pool,
    config,
    logger,
    startedAt,
    onUpgrade: (req, socket, head) => bridge.handleUpgrade(req, socket, head),
  });
  // hub.started 감사 기록은 listen() 전에 끝낸다: listen 이후에 await가 남아 있으면
  // /health가 이미 응답하는데도 installSignalHandlers가 아직 안 걸린 창이 생겨
  // 그 사이 도착한 SIGTERM이 핸들러 없이 기본 처리(강제 종료, exit code null)된다.
  await kernel.audit.record({ actor: "system", action: "hub.started", target_table: "jobs" });
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  logger.info("hub listening", { host: config.host, port: config.port, version: config.version });

  let closing: Promise<void> | null = null;
  return {
    config,
    port: config.port,
    close() {
      if (closing !== null) return closing;
      closing = (async () => {
        // 1) 새 연결을 받지 않는다. keep-alive는 즉시 끊는다.
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
          setTimeout(() => server.closeAllConnections(), 2000).unref();
        });
        await bridge.close();
        stopSummaryJob();
        stopLoops();
        // 2) 스케줄러를 멈추고 진행 중 틱이 claimed_at을 풀고 끝나기를 기다린다(Task 14의 stop()).
        // 3) LISTEN 커넥션을 버린다.
        await kernel.close();
        await kernel.audit.record({ actor: "system", action: "hub.stopped", target_table: "jobs" });
        await pool.end();
        logger.info("hub stopped");
      })();
      return closing;
    },
  };
}

/** SIGTERM/SIGINT → close(). 10초 안에 안 끝나면 강제 종료한다(LaunchDaemon이 재시작한다). */
export function installSignalHandlers(
  hub: RunningHub,
  logger: Logger,
  forceExitMs = 10_000,
): () => void {
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown requested", { signal });
    const force = setTimeout(() => {
      logger.error("shutdown timed out — forcing exit", { forceExitMs });
      process.exit(1);
    }, forceExitMs);
    force.unref();
    hub
      .close()
      .then(() => {
        clearTimeout(force);
        process.exit(0);
      })
      .catch((e: unknown) => {
        logger.error("shutdown failed", { err: e instanceof Error ? e.message : String(e) });
        process.exit(1);
      });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  return () => {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  };
}

// 직접 실행될 때만 부팅한다(테스트는 startHub를 import한다).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const hub = await startHub();
  installSignalHandlers(hub, createLogger("@omnis/hub"));
}
