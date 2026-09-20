import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DRAFT_PLACEHOLDER_MS,
  DRAFT_SLA_MS,
  configureAgents,
  draftLoop,
  shouldEscalate,
  writePlaceholderDraft,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let threadId = "";

beforeAll(async () => {
  configureAgents({ pool });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','draft@test','d')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='d' RETURNING id`,
  );
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_draft','email')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
    [a.rows[0]?.id ?? ""],
  );
  threadId = t.rows[0]?.id ?? "";
});
// 이 테스트가 만든 draft row를 남기면 커널의 push_batch 테스트(전역 draft 수를 센다)가 깨진다.
afterAll(async () => {
  await pool.query("DELETE FROM items WHERE thread_id = $1", [threadId]);
  await pool.end();
});

describe("draftLoop (A4 §3)", () => {
  it("declares the A4 §3.7 budget and the 20s debounce", () => {
    expect(draftLoop.id).toBe("draft");
    expect(draftLoop.kind).toBe("deliberate");
    expect(draftLoop.trigger.debounceMs).toBe(20_000);
    expect(draftLoop.budget).toEqual({
      inputTokens: 6500,
      outputTokens: 800,
      wallClockMs: 45_000,
      maxSteps: 8,
    });
    expect(draftLoop.palette).not.toContain("propose_delegation");
    expect(DRAFT_SLA_MS).toBe(60_000);
    expect(DRAFT_PLACEHOLDER_MS).toBe(55_000);
  });

  it("escalates to T2 on each of the six conditions (A4 §3.5)", () => {
    const base = {
      vip: false,
      sensitivity: "normal" as const,
      t1Confidence: 0.9,
      t1Escalate: false,
      unresolvedCount: 0,
      firstContact: false,
      channel: "gmail" as const,
    };
    expect(shouldEscalate(base)).toBe(false);
    expect(shouldEscalate({ ...base, vip: true })).toBe(true);
    expect(shouldEscalate({ ...base, sensitivity: "finance" })).toBe(true);
    expect(shouldEscalate({ ...base, t1Confidence: 0.6 })).toBe(true);
    expect(shouldEscalate({ ...base, t1Escalate: true })).toBe(true);
    expect(shouldEscalate({ ...base, unresolvedCount: 2 })).toBe(true);
    expect(shouldEscalate({ ...base, firstContact: true })).toBe(true);
    expect(shouldEscalate({ ...base, firstContact: true, channel: "slack" })).toBe(false);
  });

  it("writes a pending placeholder draft and replaces it in place", async () => {
    const id = await writePlaceholderDraft(threadId);
    const { rows } = await pool.query<{
      status: string;
      body: string;
      meta: { pending?: boolean };
    }>("SELECT status, body, meta FROM items WHERE id = $1", [id]);
    expect(rows[0]).toMatchObject({ status: "draft", body: "초안 준비 중…" });
    expect(rows[0]?.meta.pending).toBe(true);

    await draftLoop.apply(
      {
        loop: "draft",
        run_id: "00000000-0000-0000-0000-000000000000",
        output: {
          body: "내일 오전에 보내드리겠습니다.",
          language: "ko",
          rationale: "상대가 마감일을 물었다",
          evidence: [],
          confidence: 0.8,
          escalate: false,
          unresolved: [],
          injection_flags: [],
        },
        confidence: 0.8,
        rationale: "",
        escalate: false,
        injection_flags: [],
        unresolved: [],
      },
      {
        trigger_kind: "event",
        thread_id: threadId,
        now: new Date(),
        payload: { placeholder_item_id: id, channel: "gmail", question_count: 1 },
      },
    );
    const after = await pool.query<{
      body: string;
      meta: { pending?: boolean; draft?: { register?: string }; draft_self_check?: unknown };
    }>("SELECT body, meta FROM items WHERE id = $1", [id]);
    expect(after.rows[0]?.body).toBe("내일 오전에 보내드리겠습니다.");
    expect(after.rows[0]?.meta.pending).toBeUndefined();
    expect(after.rows[0]?.meta.draft?.register).toBe("formal_ko");
    expect(after.rows[0]?.meta.draft_self_check).toBeDefined();
  });
});
