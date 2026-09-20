import { randomUUID } from "node:crypto";
import { type BridgeMethod, toJsonRpcError, withMeta } from "@omnis/protocol";
import type { Logger } from "./logger.js";

export interface SocketLike {
  send(data: string): void;
  close(): void;
  on(event: "open" | "message" | "close" | "error", fn: (...args: never[]) => void): SocketLike;
}

export interface HubClientDeps {
  url: string;
  token: string;
  logger: Logger;
  connect: (url: string, headers: Record<string, string>) => SocketLike;
  dispatch: (method: string, params: unknown) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  onOpen?: () => Promise<void>;
  onClose?: () => void;
}

/** A2 §2.2 5항: 1s → 2s → 4s → … → 30s 상한, ±20% jitter. */
export function backoffDelayMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  return Math.round(base * (0.8 + 0.4 * rand()));
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class HubClient {
  #sock: SocketLike | null = null;
  #open = false;
  #stopped = false;
  #attempt = 0;
  readonly #pending = new Map<string, Pending>();

  constructor(private readonly deps: HubClientDeps) {}

  async start(): Promise<void> {
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#open = false;
    this.#sock?.close();
    this.#sock = null;
  }

  #connect(): void {
    const sock = this.deps.connect(this.deps.url, { Authorization: `Bearer ${this.deps.token}` });
    this.#sock = sock;
    sock.on(
      "open",
      (() => {
        this.#open = true;
        this.#attempt = 0;
        this.deps.logger.info("bridge connected", { url: this.deps.url });
        void this.deps.onOpen?.();
      }) as never,
    );
    sock.on("message", ((raw: unknown) => {
      void this.#onMessage(String(raw));
    }) as never);
    sock.on(
      "close",
      (() => {
        this.#open = false;
        this.deps.onClose?.();
        if (this.#stopped) return;
        const delay = backoffDelayMs(this.#attempt++);
        this.deps.logger.warn("bridge disconnected, retrying", { delay_ms: delay, attempt: this.#attempt });
        void (this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(delay).then(() => {
          if (!this.#stopped) this.#connect();
        });
      }) as never,
    );
    sock.on("error", ((e: unknown) => {
      this.deps.logger.error("bridge socket error", { reason: String(e) });
    }) as never);
  }

  get connected(): boolean {
    return this.#open;
  }

  notify(method: BridgeMethod, params: Record<string, unknown>): void {
    this.#send({ jsonrpc: "2.0", method, params: withMeta(params) });
  }

  request(method: BridgeMethod, params: Record<string, unknown>): Promise<unknown> {
    const id = `b-${randomUUID().slice(0, 8)}`;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#send({ jsonrpc: "2.0", id, method, params: withMeta(params) });
    });
  }

  #send(msg: Record<string, unknown>): void {
    if (this.#sock === null || !this.#open) throw new Error("hub socket is not open");
    this.#sock.send(JSON.stringify(msg));
  }

  async #onMessage(raw: string): Promise<void> {
    let msg: { id?: string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };
    try {
      msg = JSON.parse(raw);
    } catch {
      this.deps.logger.error("bridge received non-JSON frame");
      return;
    }

    if (msg.method === undefined && msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (p === undefined) return;
      if (msg.error !== undefined) p.reject(msg.error);
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === undefined) return;

    if (msg.id === undefined) {
      await this.deps.dispatch(msg.method, msg.params).catch(() => undefined);
      return;
    }
    try {
      const result = await this.deps.dispatch(msg.method, msg.params);
      this.#send({ jsonrpc: "2.0", id: msg.id, result });
    } catch (e) {
      this.#send({ jsonrpc: "2.0", id: msg.id, error: toJsonRpcError(e) });
    }
  }
}
