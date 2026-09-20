import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BridgeMethod } from "@omnis/protocol";

export interface OutboxEntry { method: BridgeMethod; params: Record<string, unknown>; at?: string }

/** A2 §2.2: durable만 쌓는다. ephemeral 델타는 버린다. approval.requested는 절대 안 버린다. */
export class Outbox {
  readonly #path: string;
  readonly #maxBytes: number;
  #buf: OutboxEntry[] = [];

  constructor(opts: { path: string; maxBytes?: number }) {
    this.#path = opts.path;
    this.#maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
    mkdirSync(dirname(this.#path), { recursive: true });
    if (existsSync(this.#path)) {
      this.#buf = readFileSync(this.#path, "utf8").split("\n").filter((l) => l.length > 0)
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

  entries(): readonly OutboxEntry[] { return this.#buf; }
  length(): number { return this.#buf.length; }
  sizeBytes(): number { return Buffer.byteLength(this.#serialise(), "utf8"); }

  /** 순서대로 보내고 성공한 것만 지운다. 던지면 남은 것은 파일에 그대로 남는다. */
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

  #serialise(): string { return this.#buf.map((e) => JSON.stringify(e)).join("\n"); }
  #flushToDisk(): void { writeFileSync(this.#path, this.#serialise(), "utf8"); }
}
