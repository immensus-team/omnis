import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { loadConfig } from "./config.js";
import { HubClient, type SocketLike } from "./hub-client.js";
import { readKeychainSecret } from "./keychain.js";
import { createLogger } from "./logger.js";
import { Outbox } from "./outbox.js";
import { createDispatcher } from "./rpc-dispatch.js";
import { SessionRegistry } from "./session-registry.js";

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

  const client = new HubClient({
    url: config.hub_url,
    token,
    logger,
    connect: (url, headers) => new WebSocket(url, { headers }) as unknown as SocketLike,
    dispatch: createDispatcher({
      registry,
      adapters: new Map(),
      allowedRoots: new Map(),
      runtimeIds: new Map(),
      logger,
      host: config.host,
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
