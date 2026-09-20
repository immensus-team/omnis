import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BridgeMethod } from "@omnis/protocol";

export interface OutboxEntry {
  method: BridgeMethod;
  params: Record<string, unknown>;
  at?: string;
}

/** A2 §2.2: only durable events are queued. Ephemeral deltas are dropped. approval.requested is never dropped. */
export class Outbox {
  readonly #path: string;
  readonly #maxBytes: number;
  #buf: OutboxEntry[] = [];

  constructor(opts: { path: string; maxBytes?: number }) {
    this.#path = opts.path;
    this.#maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
    mkdirSync(dirname(this.#path), { recursive: true });
    if (existsSync(this.#path)) {
      this.#buf = readFileSync(this.#path, "utf8")
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as OutboxEntry);
    }
  }

  append(entry: OutboxEntry): void {
    this.#buf.push(entry.at === undefined ? { ...entry, at: new Date().toISOString() } : entry);
    while (this.sizeBytes() > this.#maxBytes) {
      const victim = this.#buf.findIndex((e) => e.method !== "approval.requested");
      if (victim < 0) break;
      this.#buf.splice(victim, 1);
    }
    this.#flushToDisk();
  }

  entries(): readonly OutboxEntry[] {
    return this.#buf;
  }
  length(): number {
    return this.#buf.length;
  }
  sizeBytes(): number {
    return Buffer.byteLength(this.#serialise(), "utf8");
  }

  /** Sends in order and removes only what succeeded. If it throws, the rest stays in the file as is. */
  async drain(send: (e: OutboxEntry) => Promise<void>): Promise<void> {
    while (this.#buf.length > 0) {
      const head = this.#buf[0] as OutboxEntry;
      try {
        await send(head);
      } catch (e) {
        this.#flushToDisk();
        throw e;
      }
      this.#buf.shift();
      this.#flushToDisk();
    }
  }

  #serialise(): string {
    return this.#buf.map((e) => JSON.stringify(e)).join("\n");
  }
  #flushToDisk(): void {
    writeFileSync(this.#path, this.#serialise(), "utf8");
  }
}
