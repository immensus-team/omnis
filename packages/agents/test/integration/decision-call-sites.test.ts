// Slice 3 of the Jev spike: the six call sites. Two properties have to hold at each of them —
// with the flag off Jev is never called at all, and with the flag on the answer moves the loop
// without ever approving an outbound action on its own.
//
// The loops construct their own JevDecider, so these tests spy on the prototype instead of
// injecting one. That is deliberate: it is the only seam that says something about what the *real*
// call site does, rather than about what an injected stand-in would have done.
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DECISION_PROVIDER_KEY,
  DELEGATION_JEV_MIN,
  DRAFT_WORTHINESS_VETO_BELOW,
  FOLLOWUP_VETO_BELOW,
  JevDecider,
  T1_ARCHIVE_CONFIDENCE_MIN,
  autoArchiveLoop,
  classify,
  configureAgents,
  draftLoop,
  extractHints,
  followupLoop,
  routeDelegation,
  sensitivityFor,
} from "../../src/index.js";
import type { ClassifyCtx } from "../../src/index.js";
import type { DecisionAnswer, DecisionRequest, ItemRow } from "../../src/index.js";
import type { TriggerContext } from "../../src/loop/spec.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let accountId = "";
let threadId = "";
let personId = "";

beforeAll(async () => {
  configureAgents({ pool });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display)
     VALUES ('gmail','dcs@test','d')
     ON CONFLICT (channel, external_id) DO UPDATE SET display='d' RETURNING id`,
  );
  accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind, meta)
     VALUES ($1,'thr_dcs','email','{}'::jsonb)
     ON CONFLICT (account_id, external_id) DO UPDATE SET meta='{}'::jsonb RETURNING id`,
    [accountId],
  );
  threadId = t.rows[0]?.id ?? "";
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (display_name, notes, relationship_state, primary_thread_id)
     VALUES ('Dana Reyes', 'met at the conference', 'active', $1) RETURNING id`,
    [threadId],
  );
  personId = p.rows[0]?.id ?? "";
});

beforeEach(async () => {
  await setFlag("llm");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await pool.query("DELETE FROM items WHERE thread_id = $1", [threadId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM settings WHERE key = $1", [DECISION_PROVIDER_KEY]);
  await pool.query("DELETE FROM persons WHERE id = $1", [personId]);
  await pool.query("DELETE FROM items WHERE thread_id = $1", [threadId]);
  await pool.end();
});

async function setFlag(value: "llm" | "jev"): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [DECISION_PROVIDER_KEY, JSON.stringify(value)],
  );
}

async function mkItem(
  over: { sensitivity?: string; subject?: string | null; body?: string } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, status, sensitivity, subject, body, sent_at, meta)
     VALUES ($1,$2,'email','received',$3,$4,$5, now(), '{}'::jsonb) RETURNING id`,
    [
      threadId,
      accountId,
      over.sensitivity ?? "normal",
      over.subject ?? "Weekly newsletter",
      over.body ?? "This is the weekly newsletter.",
    ],
  );
  return rows[0]?.id ?? "";
}

function ctxOf(over: Partial<TriggerContext> = {}): TriggerContext {
  return { trigger_kind: "event", now: new Date(), payload: {}, ...over };
}

function itemRow(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    thread_id: threadId,
    account_id: accountId,
    channel: "gmail",
    kind: "email",
    scope: "unknown",
    sensitivity: "normal",
    author_person_id: null,
    author_is_me: false,
    subject: "Invoice for August",
    body: "Please find the invoice for August attached.",
    sent_at: new Date().toISOString(),
    embedding: null,
    ...over,
  };
}

function classifyCtx(): ClassifyCtx {
  return { threadId, accountChannel: "gmail", pool };
}

/** A prototype spy that fails the test loudly if anything reaches Jev while the flag is off. */
function spyJevOnly(): ReturnType<typeof vi.spyOn> {
  vi.spyOn(JevDecider.prototype, "available").mockResolvedValue(true);
  return vi
    .spyOn(JevDecider.prototype, "decide")
    .mockRejectedValue(new Error("Jev must not be called while agents.decision_provider is 'llm'"));
}

/** A prototype spy that answers only the questions the call site actually asked. */
function stubJev(answers: Record<string, DecisionAnswer>): DecisionRequest[] {
  const seen: DecisionRequest[] = [];
  vi.spyOn(JevDecider.prototype, "available").mockResolvedValue(true);
  vi.spyOn(JevDecider.prototype, "decide").mockImplementation(async (req) => {
    seen.push(req);
    const asked = Object.entries(answers).filter(([id]) => req.questions[id] !== undefined);
    return {
      provider: "vercel-ai-gateway" as const,
      model: "jev-latest",
      answers: Object.fromEntries(asked),
      confidence: {},
      latencyMs: 11,
      tokensIn: 240,
      tokensOut: 0,
      costUsd: (240 / 1_000_000) * 0.042,
    };
  });
  return seen;
}

const YES: DecisionAnswer = { type: "boolean", probability: 0.95 };
const NO: DecisionAnswer = { type: "boolean", probability: 0.05 };

describe("flag off: no call site reaches Jev", () => {
  it("keeps all six on their existing paths", async () => {
    const decide = spyJevOnly();
    const itemId = await mkItem();
    const ctx = ctxOf({ item_id: itemId, thread_id: threadId, person_id: personId });

    // 1. classify — whatever stage it lands in, nothing Jev-shaped is constructed.
    // The id has to be a real row: classify records an agent_run and agent_runs has an item FK.
    await classify(itemRow({ id: itemId }), classifyCtx());
    // 6. sensitivity
    expect(await sensitivityFor(itemRow(), classifyCtx())).toBe("normal");
    // 2. auto-archive: the hard gates pass and the human sender falls past T0 → would be T1's job
    expect(await autoArchiveLoop.decide?.(ctx)).toBe(null);
    // 3. draft-worthiness
    expect(await draftLoop.decide?.(ctx)).toBe(null);
    // 4. follow-up nudge
    expect(await followupLoop.decide?.(ctx)).toBe(null);
    // 5. delegation eligibility: no rule matches, so routeByRule's null would have gone to L4
    await makeMacbookOnline();
    expect(
      await routeDelegation(extractHints("tidy the notes"), "tidy", "", "tidy the notes"),
    ).toBe(null);

    expect(decide).not.toHaveBeenCalled();
  });
});

describe("flag on: each call site acts on the answer", () => {
  it("6. sensitivity: a Jev answer raises the level through pickSensitivity", async () => {
    await setFlag("jev");
    stubJev({ sensitivity: { type: "choice", choice: "health", probabilities: { health: 0.9 } } });
    expect(await sensitivityFor(itemRow(), classifyCtx())).toBe("health");
  });

  it("6. sensitivity: and can never lower one the T0 path already found", async () => {
    await setFlag("jev");
    stubJev({ sensitivity: { type: "choice", choice: "normal", probabilities: { normal: 0.9 } } });
    expect(await sensitivityFor(itemRow({ sensitivity: "finance" }), classifyCtx())).toBe(
      "finance",
    );
  });

  it("2. auto-archive: archives only above T1_ARCHIVE_CONFIDENCE_MIN", async () => {
    await setFlag("jev");
    const itemId = await mkItem();
    const ctx = ctxOf({ item_id: itemId, thread_id: threadId });

    stubJev({ archive: { type: "boolean", probability: 0.95 } });
    const above = await autoArchiveLoop.decide?.(ctx);
    expect(above?.output).toMatchObject({ archive: true, tier: "T1", reason: "jev_bulk_mail" });
    expect(above?.confidence).toBe(0.95);

    vi.restoreAllMocks();
    stubJev({ archive: { type: "boolean", probability: 0.4 } });
    const below = await autoArchiveLoop.decide?.(ctx);
    expect(below?.output).toMatchObject({ archive: false, tier: "T1", reason: "jev_keep" });
    expect(T1_ARCHIVE_CONFIDENCE_MIN).toBe(0.85);
  });

  it("3. draft-worthiness: a confident 'no' skips the loop, a 'yes' leaves it alone", async () => {
    await setFlag("jev");
    const itemId = await mkItem(); // T0 found a human sender, so this is the residue
    const ctx = ctxOf({ item_id: itemId, thread_id: threadId });

    stubJev({ worth_drafting: NO });
    const vetoed = await draftLoop.decide?.(ctx);
    expect(vetoed).not.toBe(null);
    expect(vetoed !== null && "skip" in vetoed && vetoed.skip).toContain("no reply is needed");

    vi.restoreAllMocks();
    stubJev({ worth_drafting: YES });
    expect(await draftLoop.decide?.(ctx)).toBe(null);
    expect(DRAFT_WORTHINESS_VETO_BELOW).toBeGreaterThan(NO.probability ?? 0);
  });

  it("4. follow-up: a confident 'no' cancels the nudge, a 'yes' leaves it alone", async () => {
    await setFlag("jev");
    const ctx = ctxOf({ person_id: personId, thread_id: threadId });

    stubJev({ reach_out: NO });
    const vetoed = await followupLoop.decide?.(ctx);
    expect(vetoed !== null && "skip" in vetoed && vetoed.skip).toContain("not appropriate");

    vi.restoreAllMocks();
    stubJev({ reach_out: YES });
    expect(await followupLoop.decide?.(ctx)).toBe(null);
    expect(FOLLOWUP_VETO_BELOW).toBeGreaterThan(NO.probability ?? 0);
  });

  it("5. delegation: answers host and runtime only where no rule could", async () => {
    await setFlag("jev");
    await makeMacbookOnline(); // the last rule sends every unmatched task to the mini otherwise

    stubJev({
      delegate: YES,
      host: { type: "choice", choice: "macbook", probabilities: { macbook: 0.8 } },
      runtime: { type: "choice", choice: "claude_ds", probabilities: { claude_ds: 0.8 } },
    });
    expect(await routeDelegation(extractHints("tidy the notes"), "tidy", "", "tidy")).toEqual({
      host: "macbook",
      runtime: "claude_ds",
      rule_id: "jev_delegation",
    });

    vi.restoreAllMocks();
    stubJev({
      delegate: { type: "boolean", probability: 0.3 },
      host: { type: "choice", choice: "mini" },
      runtime: { type: "choice", choice: "omnis" },
    });
    expect(await routeDelegation(extractHints("tidy the notes"), "tidy", "", "tidy")).toBe(null);
    expect(DELEGATION_JEV_MIN).toBeGreaterThan(0.3);

    vi.restoreAllMocks();
    stubJev({ delegate: YES }); // no host/runtime answered → abstain
    expect(await routeDelegation(extractHints("tidy the notes"), "tidy", "", "tidy")).toBe(null);
  });

  it("5. delegation: a rule still wins outright, without asking Jev at all", async () => {
    await setFlag("jev");
    const decide = spyJevOnly();
    const local = extractHints("update /Users/logan/notes/todo.md");
    expect(await routeDelegation(local, "t", "", "update /Users/logan/notes/todo.md")).toEqual({
      host: "macbook",
      rule_id: "dr_local_files",
    });
    expect(decide).not.toHaveBeenCalled();
  });
});

/** hostHealth() reads max(last_seen_at) per host; a fresh macbook row is the only way routeByRule abstains. */
async function makeMacbookOnline(): Promise<void> {
  await pool.query(
    `INSERT INTO agent_runtimes (runtime, host, display, state, last_seen_at)
     VALUES ('claude_code','macbook','mb','online', now())
     ON CONFLICT (runtime, host) DO UPDATE SET last_seen_at = now()`,
  );
}
