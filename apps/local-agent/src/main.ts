import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeKind } from "@omnis/protocol";
import WebSocket from "ws";
import { loadConfig } from "./config.js";
import { hostProfile } from "./host-config.js";
import { HubClient, type SocketLike } from "./hub-client.js";
import { createHubSink } from "./hub-sink.js";
import { readKeychainSecret } from "./keychain.js";
import { createLogger } from "./logger.js";
import { Outbox } from "./outbox.js";
import { type EventSink, createDispatcher } from "./rpc-dispatch.js";
import { buildRuntimes, registerRuntimes } from "./runtimes.js";
import { SessionRegistry } from "./session-registry.js";
import { TurnCap } from "./turn-cap.js";

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
    onOpen: async () => {
      // Every reconnect re-registers; the hub upsert tolerates it and hands back the row id each time.
      for (const [k, v] of await registerRuntimes(client, config.host, built)) runtimeIds.set(k, v);
      await outbox.drain(async (e) => {
        client.notify(e.method, e.params);
      });
    },
  });
  await client.start();
}

if (process.argv[1]?.endsWith("main.js") === true) {
  void main(process.argv.slice(2), process.env);
}
