import { BRIDGE_ERRORS, BridgeError } from "@omnis/protocol";

/** A2 §7.2: 4 active "turns" per host. Not a process count. Excess is queued (up to 8); beyond that, -32004. */
export class TurnCap {
  readonly #max: number;
  readonly #queueMax: number;
  readonly #active = new Set<string>();
  #queue: string[] = [];

  constructor(opts: { max?: number; queueMax?: number } = {}) {
    this.#max = opts.max ?? 4;
    this.#queueMax = opts.queueMax ?? 8;
  }

  acquire(turnId: string): "run" | "queued" {
    if (this.#active.size < this.#max) {
      this.#active.add(turnId);
      return "run";
    }
    if (this.#queue.length >= this.#queueMax) {
      throw new BridgeError(
        BRIDGE_ERRORS.TURN_ALREADY_ACTIVE,
        `turn queue full (${this.#queueMax}) on this host`,
      );
    }
    this.#queue.push(turnId);
    return "queued";
  }

  /** Called on success, failure and cancellation alike. Returns the id of the next queued turn. */
  release(turnId: string): string | undefined {
    if (!this.#active.delete(turnId)) {
      this.#queue = this.#queue.filter((t) => t !== turnId);
      return undefined;
    }
    const next = this.#queue.shift();
    if (next !== undefined) this.#active.add(next);
    return next;
  }

  active(): number {
    return this.#active.size;
  }

  queued(): number {
    return this.#queue.length;
  }
}
