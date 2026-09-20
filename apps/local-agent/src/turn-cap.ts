import { BRIDGE_ERRORS, BridgeError } from "@omnis/protocol";

/** A2 §7.2: 호스트당 활성 "턴" 4개. 프로세스 수가 아니다. 초과는 큐잉(최대 8), 넘치면 -32004. */
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

  /** 성공·실패·취소 모두에서 호출된다. 다음 대기 턴 id를 돌려준다. */
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
