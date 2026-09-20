import { createPool, one, query } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCalendarProvider } from "../../src/ingest/calendar.js";
import { setExtractor } from "../../src/ingest/extract.js";
import {
  type IngestDoc,
  type IngestProvider,
  registerIngestProvider,
  resetIngestProviders,
  runIngest,
} from "../../src/ingest/run.js";
import { getSource } from "../../src/ingest/source.js";
import { type FakeOllama, startFakeOllama } from "../helpers/fake-ollama.js";

let pool: Pool;
let ollama: FakeOllama;
const originalHost = process.env.OLLAMA_HOST;

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

beforeAll(async () => {
  pool = createPool();
  ollama = await startFakeOllama();
  process.env.OLLAMA_HOST = ollama.host;
});
afterAll(async () => {
  await ollama.close();
  // biome lint/performance/noDelete를 피하면서 실제로 키를 지운다(store.test.ts와 같은 방식).
  if (originalHost === undefined) Reflect.deleteProperty(process.env, "OLLAMA_HOST");
  else process.env.OLLAMA_HOST = originalHost;
  await pool.end();
});
beforeEach(() => {
  resetIngestProviders();
  setExtractor(null);
});
// 통합 프로젝트는 한 DB를 공유한다. 싹 지우면 다른 파일의 행까지 날아가고(schema-0005가 실제로
// 그렇게 깨졌다), 반대로 읽기를 안 좁히면 앞 파일이 남긴 행(schema-0005는 memories/entities/
// relations를 정리 없이 남긴다)이 섞여 들어온다 — 쓰기도 읽기도 이 파일이 만든 행으로만 좁힌다.
const MINE = "WHERE source_kind IN ('file', 'calendar')";
const MINE_ENTITIES = "WHERE name IN ('omnis', '온워드랩')";
const MINE_RELATIONS = "WHERE type = 'owned_by'";

afterEach(async () => {
  await query(pool, `DELETE FROM relations ${MINE_RELATIONS}`);
  await query(pool, `DELETE FROM entities ${MINE_ENTITIES}`);
  await query(pool, `DELETE FROM memories ${MINE}`);
  await query(pool, "DELETE FROM ingest_sources WHERE source_ref IN ('/roots', 'calendar_events')");
  await query(pool, "DELETE FROM calendar_events WHERE external_id = 'evt-1'");
  await query(pool, "DELETE FROM items WHERE kind = 'event' AND subject = '킥오프'");
  await query(pool, "DELETE FROM items WHERE kind = 'system' AND subject LIKE 'ingestion 실패:%'");
});

function provider(docs: IngestDoc[], ref = "/roots"): IngestProvider {
  return {
    kind: "file",
    ref,
    async *list() {
      for (const d of docs) yield d;
    },
  };
}

const VALID_FROM = "2026-09-01T00:00:00.000Z";

describe("runIngest — 기본 경로", () => {
  it("chunks, embeds and stores one memory per chunk with source_ref stamped", async () => {
    registerIngestProvider(
      provider([
        {
          source_ref: "/roots/notes.md",
          text: "다비치 PoC 마감은 9월 23일이다.",
          validFrom: VALID_FROM,
        },
      ]),
    );
    const out = await runIngest({ pool, logger, kind: "file" });
    expect(out.chunks).toBe(1);
    expect(out.memories).toBe(1);
    expect(out.deadLettered).toBe(0);

    const row = await one<{
      content: string;
      source_kind: string;
      source_ref: string;
      valid_from: Date;
      embedding: string | null;
    }>(
      pool,
      `SELECT content, source_kind, source_ref, valid_from, embedding FROM memories ${MINE}`,
    );
    expect(row.source_kind).toBe("file");
    expect(row.source_ref).toBe("/roots/notes.md");
    expect(row.valid_from.toISOString()).toBe(VALID_FROM);
    expect(row.embedding).toMatch(/^\[-?\d/);
  });

  it("is idempotent — a second run over the same content adds no rows", async () => {
    const docs = [{ source_ref: "/roots/a.md", text: "같은 내용", validFrom: VALID_FROM }];
    registerIngestProvider(provider(docs));
    await runIngest({ pool, logger, kind: "file" });
    await runIngest({ pool, logger, kind: "file" });
    expect(await query(pool, `SELECT id FROM memories ${MINE}`)).toHaveLength(1);
  });

  it("uses code chunking for a source_ref that looks like code", async () => {
    registerIngestProvider(
      provider([
        {
          source_ref: "/roots/src/a.ts",
          text: "export function f(): number {\n  return 1;\n}\n",
          validFrom: VALID_FROM,
        },
      ]),
    );
    await runIngest({ pool, logger, kind: "file" });
    const row = await one<{ content: string }>(pool, `SELECT content FROM memories ${MINE}`);
    expect(row.content).toContain("export function f");
  });

  it("skips denied paths without opening them and counts no chunk", async () => {
    registerIngestProvider(
      provider([
        { source_ref: "/roots/.env", text: "OPENAI_KEY=sk-live", validFrom: VALID_FROM },
        { source_ref: "/roots/ok.md", text: "정상 노트", validFrom: VALID_FROM },
      ]),
    );
    const out = await runIngest({ pool, logger, kind: "file" });
    expect(out.chunks).toBe(1);
    const refs = await query<{ source_ref: string }>(
      pool,
      `SELECT source_ref FROM memories ${MINE}`,
    );
    expect(refs.map((r) => r.source_ref)).toEqual(["/roots/ok.md"]);
  });

  it("invalidates every memory of a deleted document instead of deleting rows", async () => {
    registerIngestProvider(
      provider([{ source_ref: "/roots/gone.md", text: "사라질 것", validFrom: VALID_FROM }]),
    );
    await runIngest({ pool, logger, kind: "file" });

    resetIngestProviders();
    registerIngestProvider(
      provider([
        { source_ref: "/roots/gone.md", text: null, deleted: true, validFrom: VALID_FROM },
      ]),
    );
    await runIngest({ pool, logger, kind: "file" });

    const rows = await query<{ invalidated_at: Date | null }>(
      pool,
      `SELECT invalidated_at FROM memories ${MINE}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.invalidated_at).toBeInstanceOf(Date);
  });

  it("persists the provider cursor between runs", async () => {
    registerIngestProvider({
      kind: "file",
      ref: "/roots",
      async *list(ctx) {
        expect(ctx.cursor).toEqual({});
        yield {
          source_ref: "/roots/a.md",
          text: "본문",
          validFrom: VALID_FROM,
          nextCursor: { since: "2026-09-20T00:00:00.000Z" },
        };
      },
    });
    await runIngest({ pool, logger, kind: "file" });
    expect((await getSource(pool, "file", "/roots")).cursor).toEqual({
      since: "2026-09-20T00:00:00.000Z",
    });
  });
});

describe("runIngest — 추출(T1)", () => {
  it("writes the entities and relations the injected extractor returns", async () => {
    setExtractor(async () => ({
      memories: [
        {
          content: "온워드랩은 서울에 있다",
          kind: "fact",
          confidence: 0.9,
          valid_from: VALID_FROM,
        },
      ],
      entities: [
        { type: "org", name: "온워드랩", attributes: { city: "서울" }, valid_from: VALID_FROM },
        { type: "project", name: "omnis", attributes: {}, valid_from: VALID_FROM },
      ],
      relations: [
        {
          from: "omnis",
          to: "온워드랩",
          type: "owned_by",
          confidence: 0.7,
          valid_from: VALID_FROM,
        },
      ],
    }));
    registerIngestProvider(
      provider([{ source_ref: "/roots/co.md", text: "회사 소개", validFrom: VALID_FROM }]),
    );

    const out = await runIngest({ pool, logger, kind: "file" });
    expect(out.memories).toBe(2); // 청크 1건 + 추출 1건

    // COLLATE "C": 기본 로케일에서는 한글이 ASCII보다 먼저 온다 — 순서를 DB 로케일에 맡기지 않는다.
    const names = await query<{ name: string }>(
      pool,
      `SELECT name FROM entities ${MINE_ENTITIES} ORDER BY name COLLATE "C"`,
    );
    expect(names.map((n) => n.name)).toEqual(["omnis", "온워드랩"]);
    const rel = await one<{ type: string }>(pool, `SELECT type FROM relations ${MINE_RELATIONS}`);
    expect(rel.type).toBe("owned_by");
  });

  it("skips only the failing chunk when the extractor throws", async () => {
    let n = 0;
    setExtractor(async () => {
      n += 1;
      if (n === 1) throw new Error("깨진 출력");
      return { memories: [], entities: [], relations: [] };
    });
    registerIngestProvider(
      provider([
        { source_ref: "/roots/a.md", text: "첫 문서", validFrom: VALID_FROM },
        { source_ref: "/roots/b.md", text: "둘째 문서", validFrom: VALID_FROM },
      ]),
    );
    const out = await runIngest({ pool, logger, kind: "file" });
    expect(out.chunks).toBe(2);
    expect(await query(pool, `SELECT id FROM memories ${MINE}`)).toHaveLength(2); // 청크 메모리는 둘 다 남는다
  });
});

describe("runIngest — 실패와 dead-letter (A4 §10.5)", () => {
  it("counts a provider failure and leaves the cursor untouched", async () => {
    registerIngestProvider({
      kind: "file",
      ref: "/roots",
      // biome-ignore lint/correctness/useYield: provider가 첫 페이지에서 터지는 경우를 흉내 낸다.
      async *list(): AsyncGenerator<IngestDoc> {
        throw new Error("네트워크 끊김");
      },
    });
    const out = await runIngest({ pool, logger, kind: "file", sleep: async () => undefined });
    expect(out.deadLettered).toBe(0);
    expect((await getSource(pool, "file", "/roots")).fail_count).toBe(1);
  });

  it("dead-letters the source on the third consecutive failure", async () => {
    registerIngestProvider({
      kind: "file",
      ref: "/roots",
      // biome-ignore lint/correctness/useYield: 소스가 매번 터지는 경우를 흉내 낸다.
      async *list(): AsyncGenerator<IngestDoc> {
        throw new Error("계속 실패");
      },
    });
    for (let i = 0; i < 2; i += 1) {
      await runIngest({ pool, logger, kind: "file", sleep: async () => undefined });
    }
    const out = await runIngest({ pool, logger, kind: "file", sleep: async () => undefined });
    expect(out.deadLettered).toBe(1);

    const item = await one<{ subject: string; body: string }>(
      pool,
      `SELECT subject, body FROM items
        WHERE kind = 'system' AND subject LIKE 'ingestion 실패:%'
        ORDER BY received_at DESC LIMIT 1`,
    );
    expect(item.subject).toContain("file");
    expect(item.body).toContain("/roots");
    expect(item.body).toContain("계속 실패");
  });
});

describe("createCalendarProvider (A4 §10.1 캘린더)", () => {
  it("turns each calendar event into one memory keyed by its external id", async () => {
    const account = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gcal','test-cal','cal')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display RETURNING id`,
    );
    const thread = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'cal-thr','calendar')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind = EXCLUDED.kind RETURNING id`,
      [account.id],
    );
    const item = await one<{ id: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
         VALUES ($1,$2,'event','킥오프','기획서 리뷰', now()) RETURNING id`,
      [thread.id, account.id],
    );
    await query(
      pool,
      `INSERT INTO calendar_events (item_id, account_id, external_id, start_at, end_at, attendees)
         VALUES ($1,$2,'evt-1', now(), now() + interval '1 hour', '[{"email":"a@corp.com"}]'::jsonb)`,
      [item.id, account.id],
    );

    registerIngestProvider(createCalendarProvider());
    const out = await runIngest({ pool, logger, kind: "calendar" });
    expect(out.chunks).toBe(1);

    const row = await one<{ content: string; source_ref: string }>(
      pool,
      "SELECT content, source_ref FROM memories WHERE source_kind = 'calendar'",
    );
    expect(row.source_ref).toBe("evt-1");
    expect(row.content).toContain("킥오프");
    expect(row.content).toContain("a@corp.com");
  });
});
