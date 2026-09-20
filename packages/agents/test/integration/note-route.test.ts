import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ROUTE_CONFIDENCE_HIGH,
  ROUTE_CONFIDENCE_MIN,
  configureAgents,
  noteRouteLoop,
} from "../../src/index.js";
import { returningId } from "./returning-id.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let noteId = "";
beforeEach(async () => {
  configureAgents({ pool });
  noteId = returningId(
    await pool.query<{ id: string }>(
      "INSERT INTO notes (body) VALUES ('김 대표님께 견적 다시 확인') RETURNING id",
    ),
  );
});
afterAll(() => pool.end());

const res = (candidates: unknown[]) => ({
  loop: "note_route" as const,
  run_id: "00000000-0000-0000-0000-0000000000dd",
  output: { candidates, confidence: 0.9, rationale: "같은 주제", injection_flags: [] },
  confidence: 0.9,
  rationale: "같은 주제",
  escalate: false,
  injection_flags: [],
  unresolved: [],
});

const ctx = (id: string) => ({
  trigger_kind: "event" as const,
  note_id: id,
  now: new Date(),
  payload: {},
});

describe("noteRouteLoop (A4 §8)", () => {
  it("declares the A4 §8.4 budget and the 2s debounce", () => {
    expect(noteRouteLoop.id).toBe("note_route");
    expect(noteRouteLoop.trigger.on).toBe("note.created");
    expect(noteRouteLoop.trigger.debounceMs).toBe(2000);
    expect(noteRouteLoop.budget).toEqual({
      inputTokens: 4000,
      outputTokens: 450,
      wallClockMs: 20_000,
      maxSteps: 2,
    });
    expect(ROUTE_CONFIDENCE_HIGH).toBe(0.8);
    expect(ROUTE_CONFIDENCE_MIN).toBe(0.5);
  });

  it("never auto-attaches — route_state stays 'proposed' even at confidence 0.99", async () => {
    const accountId = returningId(
      await pool.query<{ id: string }>(
        `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','nr@test','n')
           ON CONFLICT (channel, external_id) DO UPDATE SET display='n' RETURNING id`,
      ),
    );
    const threadId = returningId(
      await pool.query<{ id: string }>(
        `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_nr','email')
           ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
        [accountId],
      ),
    );
    await noteRouteLoop.apply(
      res([{ kind: "thread", id: threadId, confidence: 0.99, why: "같은 견적 건" }]) as never,
      ctx(noteId),
    );
    const { rows } = await pool.query<{ route_state: string; routed_to_thread_id: string | null }>(
      "SELECT route_state, routed_to_thread_id FROM notes WHERE id = $1",
      [noteId],
    );
    expect(rows[0]?.route_state).toBe("proposed");
    expect(rows[0]?.routed_to_thread_id).toBe(null);
  });

  it("stores no proposal at all below 0.50 (route_state='none')", async () => {
    await noteRouteLoop.apply(
      res([
        {
          kind: "thread",
          id: "00000000-0000-0000-0000-0000000000ee",
          confidence: 0.3,
          why: "약함",
        },
      ]) as never,
      ctx(noteId),
    );
    const { rows } = await pool.query<{ route_state: string }>(
      "SELECT route_state FROM notes WHERE id = $1",
      [noteId],
    );
    expect(rows[0]?.route_state).toBe("none");
  });

  it("keeps at most 3 candidates and drops the weak ones (A4 §8.3)", async () => {
    const strong = (n: number) => ({
      kind: "person" as const,
      id: `00000000-0000-0000-0000-00000000000${n}`,
      confidence: 0.9 - n / 100,
      why: `후보 ${n}`,
    });
    await noteRouteLoop.apply(
      res([strong(1), strong(2), strong(3), strong(4), { ...strong(5), confidence: 0.2 }]) as never,
      ctx(noteId),
    );
    const { rows } = await pool.query<{ route_state: string; rationale: string }>(
      "SELECT route_state, rationale FROM notes WHERE id = $1",
      [noteId],
    );
    expect(rows[0]?.route_state).toBe("proposed");
    const stored = JSON.parse(rows[0]?.rationale ?? "[]") as Array<{ id: string }>;
    expect(stored).toHaveLength(3);
    expect(stored.map((c) => c.id)).not.toContain("00000000-0000-0000-0000-000000000005");
  });
});
