import { createHash } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { EMBED_DIMS } from "../../src/embed.js";

/** 해시 bag-of-words 임베딩. 낱말을 공유하면 가까워지고, 전혀 안 겹치면 직교에 가깝다. */
export function fakeVector(text: string): number[] {
  const v = new Array<number>(EMBED_DIMS).fill(0);
  for (const tok of text
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/u)
    .filter((t) => t !== "")) {
    const h = createHash("sha256").update(tok).digest();
    const slot = (((h[0] ?? 0) << 8) | (h[1] ?? 0)) % EMBED_DIMS;
    v[slot] = (v[slot] ?? 0) + 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

export interface FakeOllama {
  host: string;
  calls: number;
  close(): Promise<void>;
}

/** 실패 모드: fail='all'이면 500, fail='none'이면 정상. */
export async function startFakeOllama(fail: "none" | "all" = "none"): Promise<FakeOllama> {
  const state = { calls: 0 };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += String(c);
    });
    req.on("end", () => {
      state.calls += 1;
      if (fail === "all") {
        res.writeHead(500).end("ollama down");
        return;
      }
      const input = (JSON.parse(body) as { input: string[] }).input;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ embeddings: input.map(fakeVector) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    host: `127.0.0.1:${port}`,
    get calls() {
      return state.calls;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
