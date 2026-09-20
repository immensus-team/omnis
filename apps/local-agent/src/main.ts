import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { loadConfig } from "./config.js";
import { hostProfile } from "./host-config.js";
import { HubClient, type SocketLike } from "./hub-client.js";
import { createHubSink } from "./hub-sink.js";
import { readKeychainSecret } from "./keychain.js";
import { createLogger } from "./logger.js";
import { Outbox } from "./outbox.js";
import { type EventSink, createDispatcher } from "./rpc-dispatch.js";
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

  const client: HubClient = new HubClient({
    url: config.hub_url,
    token,
    host: config.host,
    logger,
    connect: (url, headers) => new WebSocket(url, { headers }) as unknown as SocketLike,
    dispatch: createDispatcher({
      registry,
      adapters: new Map(),
      allowedRoots: new Map(),
      runtimeIds: new Map(),
      logger,
      host: config.host,
      turnCap: new TurnCap({ max: hostProfile(config.host).maxActiveTurns }),
      // 런타임 이벤트 → 허브 알림 → items(A2 §4.1). client는 이 클로저가 불릴 때 이미 있다.
      sinkFor: (session, turnId): EventSink =>
        createHubSink({ client, session, turnId, logger, outbox, registry }),
    }),
    onOpen: async () => {
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
