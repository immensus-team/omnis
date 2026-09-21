import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostId, RuntimeKind } from "@omnis/protocol";
import WebSocket from "ws";
import { loadConfig } from "./config.js";
import { hostProfile } from "./host-config.js";
import { HubClient, type SocketLike } from "./hub-client.js";
import { createHubSink } from "./hub-sink.js";
import { readKeychainSecret } from "./keychain.js";
import { type Logger, createLogger } from "./logger.js";
import { Outbox } from "./outbox.js";
import { type EventSink, createDispatcher } from "./rpc-dispatch.js";
import { type BuiltRuntime, buildRuntimes, registerRuntimes } from "./runtimes.js";
import { SessionRegistry } from "./session-registry.js";
import { TurnCap } from "./turn-cap.js";

export interface HubOpenDeps {
  client: Pick<HubClient, "request" | "notify">;
  host: HostId;
  built: BuiltRuntime[];
  runtimeIds: Map<RuntimeKind, string>;
  outbox: Outbox;
  logger: Logger;
}

/**
 * Runs on every successful connect, and is the only thing standing between a flaky hub and a crash loop:
 * HubClient fires onOpen fire-and-forget (hub-client.ts), so anything thrown here becomes an unhandled
 * rejection that kills the process. Both steps are therefore best-effort and neither may skip the other —
 * registration is retried on the next connect, and a drain that fails keeps its entries on disk.
 */
export async function handleHubOpen(deps: HubOpenDeps): Promise<void> {
  try {
    for (const [kind, id] of await registerRuntimes(deps.client, deps.host, deps.built)) {
      deps.runtimeIds.set(kind, id);
    }
  } catch (e) {
    deps.logger.error("runtime registration failed; retrying on next connect", {
      err: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    await deps.outbox.drain(async (entry) => {
      deps.client.notify(entry.method, entry.params);
    });
  } catch (e) {
    deps.logger.error("outbox drain failed; entries kept for the next connect", {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const logger = createLogger("@omnis/local-agent");
  const tomlPath = join(homedir(), ".omnis", "local-agent.toml");
  let tomlText: string | undefined;
  try {
    tomlText = readFileSync(tomlPath, "utf8");
  } catch {
    tomlText = undefined;
  }

  const { config, provenance } = loadConfig({
    argv,
    env,
    ...(tomlText === undefined ? {} : { tomlText }),
  });
  for (const [key, source] of Object.entries(provenance)) {
    logger.info("config resolved", {
      key,
      value: config[key as "host" | "hub_url" | "token_keychain_item"],
      source,
    });
  }

  const registry = new SessionRegistry();
  const outbox = new Outbox({ path: join(homedir(), ".omnis", "outbox.ndjson") });
  const token = await readKeychainSecret(config.token_keychain_item);

  // A2-D15: the runtime set is whatever TOML declared — probing happens once at boot, before the socket opens,
  // and the maps below are the live ones the dispatcher reads.
  const built = await buildRuntimes(config.runtimes, { readSecret: readKeychainSecret, logger });
  const adapters = new Map(built.map((b) => [b.kind, b.adapter] as const));
  const allowedRoots = new Map(built.map((b) => [b.kind, b.allowedRoots] as const));
  const runtimeIds = new Map<RuntimeKind, string>();

  const client: HubClient = new HubClient({
    url: config.hub_url,
    token,
    host: config.host,
    logger,
    connect: (url, headers) => new WebSocket(url, { headers }) as unknown as SocketLike,
    dispatch: createDispatcher({
      registry,
      adapters,
      allowedRoots,
      runtimeIds,
      logger,
      host: config.host,
      turnCap: new TurnCap({ max: hostProfile(config.host).maxActiveTurns }),
      // runtime event → hub notification → items (A2 §4.1). The client already exists by the time this closure fires.
      sinkFor: (session, turnId): EventSink =>
        createHubSink({ client, session, turnId, logger, outbox, registry }),
    }),
    // Every reconnect re-registers; the hub upsert tolerates it and hands back the row id each time.
    onOpen: () => handleHubOpen({ client, host: config.host, built, runtimeIds, outbox, logger }),
  });
  await client.start();
}

if (process.argv[1]?.endsWith("main.js") === true) {
  void main(process.argv.slice(2), process.env);
}
