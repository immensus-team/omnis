import { createInterface } from "node:readline";

type Handler = (params: unknown) => void;

/** A2-D6: 상주 app-server 자식 1개를 stdio로 붙든다. 줄바꿈 구분 JSON-RPC 2.0. */
export class AppServerClient {
  #nextId = 1;
  readonly #pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  readonly #handlers = new Map<string, Handler[]>();

  constructor(
    private readonly io: { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream },
  ) {
    createInterface({ input: io.stdout }).on("line", (line) => {
      this.#onLine(line);
    });
  }

  on(method: string, fn: Handler): void {
    const list = this.#handlers.get(method) ?? [];
    list.push(fn);
    this.#handlers.set(method, list);
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.io.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  close(): void {
    for (const p of this.#pending.values()) p.reject(new Error("app-server closed"));
    this.#pending.clear();
  }

  #onLine(line: string): void {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return; // 미지 형식도 파서를 죽이지 않는다
    }
    if (typeof msg.id === "number" && msg.method === undefined) {
      const p = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (p === undefined) return;
      if (msg.error !== undefined) p.reject(msg.error);
      else p.resolve(msg.result);
      return;
    }
    if (typeof msg.method === "string") {
      for (const fn of this.#handlers.get(msg.method) ?? []) fn(msg.params);
    }
  }
}
