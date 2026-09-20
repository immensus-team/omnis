import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  INACTIVE_SWEEP_LIMIT,
  NO_COLD_OUTREACH_CHANNELS,
  configureAgents,
  followupLoop,
  inactiveCandidates,
  isFirstContact,
  pickFollowupChannel,
  sweepFollowups,
} from "../../src/index.js";
import { returningId } from "./returning-id.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeEach(() => configureAgents({ pool }));
afterAll(() => pool.end());

const now = new Date("2026-09-20T00:00:00Z");

describe("isFirstContact (A4 §7.2)", () => {
  it("is true with no history, or within 90 days and fewer than 3 items", () => {
    expect(isFirstContact({ first_contact_at: null, item_count: 0 }, now)).toBe(true);
    expect(isFirstContact({ first_contact_at: "2026-09-01T00:00:00Z", item_count: 2 }, now)).toBe(
      true,
    );
    expect(isFirstContact({ first_contact_at: "2026-09-01T00:00:00Z", item_count: 3 }, now)).toBe(
      false,
    );
    expect(isFirstContact({ first_contact_at: "2025-01-01T00:00:00Z", item_count: 1 }, now)).toBe(
      false,
    );
  });
});

describe("pickFollowupChannel (A4 §7.4)", () => {
  it("never cold-opens LinkedIn or KakaoTalk", () => {
    expect(NO_COLD_OUTREACH_CHANNELS).toEqual(["linkedin", "kakaotalk"]);
    expect(
      pickFollowupChannel({ counts: { linkedin: 9 }, theySentLast: false, hasEmail: true }),
    ).toBe("gmail");
    expect(
      pickFollowupChannel({ counts: { linkedin: 9 }, theySentLast: true, hasEmail: true }),
    ).toBe("linkedin");
    expect(
      pickFollowupChannel({ counts: { kakaotalk: 9 }, theySentLast: false, hasEmail: false }),
    ).toBe(null);
    expect(
      pickFollowupChannel({
        counts: { slack: 3, telegram: 3 },
        theySentLast: true,
        hasEmail: true,
      }),
    ).toBe("gmail"); // 동률이면 이메일
  });

  it("keeps the cold-outreach gate on a tie with no email — task only, no channel", () => {
    // A4 §7.4/§7.5 위반 0건: 동률 1위가 금지 채널이면 이메일이 없어도 그 채널로 열지 않는다.
    expect(
      pickFollowupChannel({
        counts: { kakaotalk: 3, slack: 3 },
        theySentLast: false,
        hasEmail: false,
      }),
    ).toBe(null);
    expect(
      pickFollowupChannel({
        counts: { linkedin: 3, whatsapp: 3 },
        theySentLast: false,
        hasEmail: false,
      }),
    ).toBe(null);
    // 상대가 먼저 보냈으면 금지가 풀리고, 이메일이 없으니 동률 1위를 그대로 쓴다.
    expect(
      pickFollowupChannel({
        counts: { kakaotalk: 3, slack: 3 },
        theySentLast: true,
        hasEmail: false,
      }),
    ).toBe("kakaotalk");
    // 금지 채널이 아닌 동률은 이메일이 없을 때 1위를 쓴다.
    expect(
      pickFollowupChannel({
        counts: { slack: 3, telegram: 3 },
        theySentLast: false,
        hasEmail: false,
      }),
    ).toBe("slack");
    // 이메일이 있으면 금지 동률도 이메일로 대체된다.
    expect(
      pickFollowupChannel({
        counts: { kakaotalk: 3, slack: 3 },
        theySentLast: false,
        hasEmail: true,
      }),
    ).toBe("gmail");
  });
});

describe("inactiveCandidates (A4 §7.3)", () => {
  const seed = async (): Promise<string> => {
    const accountId = returningId(
      await pool.query<{ id: string }>(
        `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','fu@test','f')
           ON CONFLICT (channel, external_id) DO UPDATE SET display='f' RETURNING id`,
      ),
    );
    return returningId(
      await pool.query<{ id: string }>(
        `INSERT INTO threads (account_id, external_id, kind, last_item_at)
         VALUES ($1,'thr_fu','email', now() - interval '20 days')
         ON CONFLICT (account_id, external_id)
           DO UPDATE SET last_item_at = now() - interval '20 days' RETURNING id`,
        [accountId],
      ),
    );
  };

  it("applies the cadence priority: cadence_days > vip 14 > warming 21 > active 30", async () => {
    const threadId = await seed();
    await pool.query("DELETE FROM persons WHERE display_name LIKE 'fu-%'");
    await pool.query(
      `INSERT INTO persons (display_name, relationship_state, vip, primary_thread_id, priority_score)
       VALUES ('fu-vip','active', true, $1, 9),
              ('fu-active','active', false, $1, 5),
              ('fu-warming','warming', false, $1, 7)`,
      [threadId],
    );
    const rows = await inactiveCandidates(pool);
    const names = rows.map((r) => r.display_name);
    expect(names).toContain("fu-vip"); // vip=14일 < 20일 경과
    expect(names).not.toContain("fu-warming"); // warming=21일 > 20일 경과
    expect(names).not.toContain("fu-active"); // active=30일 > 20일 경과
    expect(rows.find((r) => r.display_name === "fu-vip")?.effective_cadence_days).toBe(14);
    expect(rows.length).toBeLessThanOrEqual(INACTIVE_SWEEP_LIMIT);
  });

  it("lets an explicit cadence_days override the state default, and skips a fresh followup task", async () => {
    const threadId = await seed();
    await pool.query("DELETE FROM persons WHERE display_name LIKE 'fu-%'");
    await pool.query(
      `INSERT INTO persons (display_name, relationship_state, vip, primary_thread_id, cadence_days)
       VALUES ('fu-slow','warming', true, $1, 60),
              ('fu-tasked','active', true, $1, NULL)`,
      [threadId],
    );
    const tasked = returningId(
      await pool.query<{ id: string }>("SELECT id FROM persons WHERE display_name = 'fu-tasked'"),
    );
    await pool.query(
      "INSERT INTO tasks (title, kind, state, person_id) VALUES ('팔로업','followup','open',$1)",
      [tasked],
    );
    const names = (await inactiveCandidates(pool)).map((r) => r.display_name);
    expect(names).not.toContain("fu-slow"); // 60일 > 20일 경과 — vip 14일을 덮는다
    expect(names).not.toContain("fu-tasked"); // 14일 안에 만든 followup task가 이미 있다
  });

  it("sweepFollowups runs the loop once per candidate", async () => {
    const threadId = await seed();
    await pool.query("DELETE FROM persons WHERE display_name LIKE 'fu-%'");
    await pool.query(
      `INSERT INTO persons (display_name, relationship_state, vip, primary_thread_id, cadence_days)
       VALUES ('fu-one','active', true, $1, NULL), ('fu-two','warming', false, $1, 7)`,
      [threadId],
    );
    const seen: string[] = [];
    const n = await sweepFollowups(async (c) => {
      seen.push(c.display_name);
    });
    expect(n).toBe(2);
    expect(seen.sort()).toEqual(["fu-one", "fu-two"]);
  });
});

describe("followupLoop (A4 §7.4)", () => {
  it("declares the A4 §7.5 budget and never carries an egress tool", () => {
    expect(followupLoop.id).toBe("followup");
    expect(followupLoop.kind).toBe("deliberate");
    expect(followupLoop.budget).toEqual({
      inputTokens: 5500,
      outputTokens: 800,
      wallClockMs: 40_000,
      maxSteps: 5,
    });
    expect(followupLoop.palette.filter((t) => t.startsWith("propose_"))).toEqual([
      "propose_draft",
      "propose_task",
    ]);
  });

  it("applies relationship updates automatically except closed", async () => {
    const personId = returningId(
      await pool.query<{ id: string }>(
        "INSERT INTO persons (display_name, relationship_state) VALUES ('fu-upd','warming') RETURNING id",
      ),
    );
    const mk = (state: string) => ({
      loop: "followup" as const,
      run_id: "00000000-0000-0000-0000-0000000000ff",
      output: {
        kind: "pending_step",
        person_id: personId,
        relationship_update: { state, cadence_days: 21 },
        confidence: 0.8,
        rationale: "x",
        injection_flags: [],
      },
      confidence: 0.8,
      rationale: "x",
      escalate: false,
      injection_flags: [],
      unresolved: [],
    });
    const ctx = {
      trigger_kind: "cron" as const,
      person_id: personId,
      now: new Date(),
      payload: {},
    };

    await followupLoop.apply(mk("active") as never, ctx);
    let { rows } = await pool.query<{ s: string; c: number }>(
      "SELECT relationship_state AS s, cadence_days AS c FROM persons WHERE id = $1",
      [personId],
    );
    expect(rows[0]?.s).toBe("active");
    expect(rows[0]?.c).toBe(21);

    await followupLoop.apply(mk("closed") as never, ctx);
    ({ rows } = await pool.query<{ s: string; c: number }>(
      "SELECT relationship_state AS s, cadence_days AS c FROM persons WHERE id = $1",
      [personId],
    ));
    expect(rows[0]?.s).toBe("active"); // closed는 승인을 타므로 아직 안 바뀐다
    const ap = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pending_approvals
        WHERE action = 'memory_write' AND args->>'person_id' = $1`,
      [personId],
    );
    expect(ap.rows[0]?.n).toBe("1");
  });
});
