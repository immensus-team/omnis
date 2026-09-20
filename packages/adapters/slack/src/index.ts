import {
  type Adapter,
  AdapterError,
  type AdapterEvent,
  type Attachment,
  type AuthRef,
  type Capabilities,
  type Health,
  type NormalizedItem,
} from "@omnis/protocol";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { readKeychainSecret } from "./keychain.js";

export const CHANNEL = "slack" as const;

const CAPABILITIES: Capabilities = {
  read: true,
  write: true,
  realtime: true,
  history: true,
  media: true,
  markRead: true,
  typing: false,
  archive: false,
  delete: false,
};

class AsyncQueue<T> {
  private buffered: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.buffered.push(value);
  }
  private async next(): Promise<IteratorResult<T>> {
    const value = this.buffered.shift();
    if (value !== undefined) return { value, done: false };
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}

export interface SlackAdapterDeps {
  socketClient?: SocketModeClient;
  webClient?: WebClient;
  now?: () => Date;
}

export function createSlackAdapter(deps: SlackAdapterDeps = {}): Adapter {
  const now = deps.now ?? (() => new Date());
  let socket: SocketModeClient | undefined;
  let web: WebClient | undefined;
  const queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
  let lastEventAt: string | null = null;
  let status: Health["status"] = "down";
  let lastError: Health["lastError"];

  return {
    id: "slack",
    channel: CHANNEL,
    capabilities: () => CAPABILITIES,

    async connect(auth: AuthRef): Promise<void> {
      const xoxbToken = await readKeychainSecret(
        auth.keychainService,
        auth.keychainAccount,
        CHANNEL,
      );
      web = deps.webClient ?? new WebClient(xoxbToken);
      const appToken = await readKeychainSecret(
        `${auth.keychainService}.app`,
        auth.keychainAccount,
        CHANNEL,
      );
      socket = deps.socketClient ?? new SocketModeClient({ appToken });

      socket.on("disconnect", () => {
        status = "degraded";
        queue.push({
          kind: "disconnected",
          reason: "socket_mode_disconnect",
          at: now().toISOString(),
        });
      });

      try {
        await socket.start();
      } catch (cause) {
        status = "down";
        lastError = {
          kind: "retryable_network",
          message: "socket mode start failed",
          at: now().toISOString(),
        };
        throw new AdapterError(
          "retryable_network",
          CHANNEL,
          "socket mode start failed",
          undefined,
          cause,
        );
      }
      status = "healthy";
      lastEventAt = now().toISOString();
      queue.push({ kind: "connected", at: lastEventAt });
    },

    async disconnect(): Promise<void> {
      await socket?.disconnect();
      status = "down";
    },

    async *backfill(): AsyncIterable<NormalizedItem> {
      throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 5");
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      return queue;
    },

    async send(): Promise<never> {
      throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 6");
    },

    async health(): Promise<Health> {
      return {
        channel: CHANNEL,
        accountExternalId: "",
        status,
        lastEventAt,
        ...(lastError ? { lastError } : {}),
      };
    },
  };
}
