// 이 테스트는 살아 있는 zero-cache를 탄다 — 서비스가 없으면 통과할 방법이 없으므로 서비스 주소가
// 주어졌을 때만 돈다. CI(그리고 zero-cache를 안 띄운 로컬)에서는 skip이다: 삭제·비활성화가 아니라
// "의존 서비스가 있을 때만 수집"이다.
//
// 재현(ops/zero-cache.env.example의 "테스트용 1회성 기동"이 정본):
//   1) createdb + pnpm db:migrate  2) pnpm zero:deploy-permissions  3) zero-cache 기동
//   4) OMNIS_ZERO_URL=http://127.0.0.1:4848 ZERO_AUTH_SECRET=... pnpm test:integration
//   5) 끝나면 replication slot을 손으로 지운다(같은 파일의 pg_drop_replication_slot 줄).
import { createHmac } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createPool, one, query } from "@omnis/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initZero, loadZeroToken } from "../../src/zero-client";

const zeroCacheUrl = process.env.OMNIS_ZERO_URL;
const authSecret = process.env.ZERO_AUTH_SECRET ?? "";

const b64url = (v: object): string => Buffer.from(JSON.stringify(v)).toString("base64url");

/** apps/hub/src/http.ts의 signZeroToken과 같은 형식. 허브를 통째로 띄우지 않고 sub만 바꿔 본다. */
function signToken(sub: string): string {
  const body = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
  return `${body}.${createHmac("sha256", authSecret).update(body).digest("base64url")}`;
}

/** initZero가 허브에서 토큰을 받아오는 경로를 그대로 타기 위한 최소 허브 스텁. */
function startTokenStub(sub: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      if (req.url !== "/api/zero-token") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: signToken(sub) }));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const pool = createPool();

beforeAll(async () => {
  if (zeroCacheUrl === undefined) return;
  expect(authSecret, "ZERO_AUTH_SECRET must match the running zero-cache").not.toBe("");
  const account = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T_A21B','a21b')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display RETURNING id`,
  );
  for (const [i, external] of ["C_A21B_1", "C_A21B_2"].entries()) {
    const thread = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind, title) VALUES ($1,$2,'group',$3)
         ON CONFLICT (account_id, external_id) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
      [account.id, external, `A21B thread ${i + 1}`],
    );
    // 스레드 1에 2건, 스레드 2에 1건 = 3 items.
    for (let n = 0; n < (i === 0 ? 2 : 1); n++) {
      await query(
        pool,
        `INSERT INTO items (thread_id, account_id, external_id, kind, body, sent_at)
         VALUES ($1,$2,$3,'message',$4, now())
           ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL
             DO UPDATE SET body = EXCLUDED.body`,
        [thread.id, account.id, `ts_a21b_${i}_${n}`, `A21B body ${i}-${n}`],
      );
    }
  }
});

afterAll(async () => {
  await pool.end();
});

/** 복제는 비동기다 — 기대 개수가 찰 때까지 짧게 폴링한다. */
async function until<T>(read: () => Promise<T[]>, want: number, ms = 10_000): Promise<T[]> {
  const deadline = Date.now() + ms;
  let rows = await read();
  while (rows.length < want && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    rows = await read();
  }
  return rows;
}

describe.skipIf(!zeroCacheUrl)("US-A21b Zero permissions round trip", () => {
  it("syncs the seeded threads and items with a hub-issued token", async () => {
    const stub = await startTokenStub("logan");
    // 부팅 경로 그대로: 허브에서 토큰을 받아 두면(loadZeroToken) 생성자에 실린다.
    await loadZeroToken(stub.url);
    const zero = initZero({ server: zeroCacheUrl });
    try {
      const threads = await until(() => zero.query.threads.run({ type: "complete" }), 2);
      expect(threads.length).toBeGreaterThanOrEqual(2);
      const items = await until(() => zero.query.items.run({ type: "complete" }), 3);
      expect(items.length).toBeGreaterThanOrEqual(3);
    } finally {
      await zero.close();
      await stub.close();
    }
  }, 40_000);

  it("sees nothing when the token's sub is not the configured user", async () => {
    const zero = initZero({
      server: zeroCacheUrl,
      userID: "intruder",
      auth: signToken("intruder"),
    });
    try {
      expect(await zero.query.threads.run({ type: "complete" })).toEqual([]);
      expect(await zero.query.items.run({ type: "complete" })).toEqual([]);
    } finally {
      await zero.close();
    }
  }, 40_000);
});
