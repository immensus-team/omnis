import { describe, expect, it, vi } from "vitest";
import { NOTE_MAX_CHARS, createNote, decideNoteRouting } from "./notes.js";

interface Written {
  sql: string;
  params: readonly unknown[];
}

/** `@omnis/db`'s `query()` is `pool.query(sql, params)` and nothing else, so a recorder standing in
 *  for the pool is all the module ever touches. `rows` is a queue: each call takes the next entry,
 *  which is how a test hands the module what a real UPDATE ... RETURNING would have handed it. */
function fakePool(rows: unknown[][] = []) {
  const written: Written[] = [];
  const emitted: { tier: string; kind: string; payload: Record<string, unknown> }[] = [];
  const pool = {
    query: vi.fn((sql: string, params: readonly unknown[] = []) => {
      written.push({ sql, params });
      return Promise.resolve({ rows: rows.shift() ?? [] });
    }),
  };
  const events = {
    emit: (tier: string, kind: string, payload: Record<string, unknown>) => {
      emitted.push({ tier, kind, payload });
      return Promise.resolve();
    },
  };
  return { pool, events, written, emitted };
}

describe("createNote (A5 §3.7's one-line input)", () => {
  const stored = {
    id: "n1",
    body: "Give David a heads-up that the PoC needs 3 more days",
    route_state: "proposed",
    created_at: "2026-09-21T09:00:00.000Z",
  };

  it("inserts the body and returns the row the database stored", async () => {
    const f = fakePool([[stored]]);
    await expect(createNote(f.pool as never, f.events as never, "  a note  ")).resolves.toEqual(
      stored,
    );
    expect(f.written).toHaveLength(1);
    expect(f.written[0]?.sql).toContain("INSERT INTO notes");
    // Trimmed before it is stored: the column is the note, and A5 §3.7's input is one line.
    expect(f.written[0]?.params).toEqual(["a note"]);
  });

  it("arms the L7 loop — note.created is the loop's trigger and this is its only producer", async () => {
    const f = fakePool([[stored]]);
    await createNote(f.pool as never, f.events as never, "a note");
    // The payload carries the stored row, not the argument: what the loop reads is what the database
    // kept. Ephemeral, not durable — `note.created` is not in the kernel's DURABLE_CHANNEL map, and
    // the loop runner subscribes in this same process (apps/hub/src/main.ts calls startLoops).
    expect(f.emitted).toEqual([
      { tier: "ephemeral", kind: "note.created", payload: { note_id: "n1", body: stored.body } },
    ]);
  });

  it("writes nothing for a body that is empty once trimmed", async () => {
    const f = fakePool();
    await expect(createNote(f.pool as never, f.events as never, "   \n ")).resolves.toBeNull();
    expect(f.written).toEqual([]);
    expect(f.emitted).toEqual([]);
  });

  it("refuses a note past the cap rather than storing it", async () => {
    const f = fakePool();
    const long = "x".repeat(NOTE_MAX_CHARS + 1);
    await expect(createNote(f.pool as never, f.events as never, long)).resolves.toBeNull();
    expect(f.written).toEqual([]);
  });

  it("still returns the note when the event emit fails — the row is already committed", async () => {
    // A5 §3.7 makes saving local-first: the note exists the moment Enter is pressed, and a loop that
    // could not be armed is a missing suggestion, not a lost note.
    const f = fakePool([[stored]]);
    const throwing = { emit: () => Promise.reject(new Error("no listeners")) };
    await expect(createNote(f.pool as never, throwing as never, "a note")).resolves.toEqual(stored);
  });
});

describe("decideNoteRouting (A4 §8.3 - a human settles the proposal, never the loop)", () => {
  it("accept: writes the confirmed thread and moves 'proposed' to 'accepted'", async () => {
    const f = fakePool([[{ route_state: "accepted" }]]);
    const out = await decideNoteRouting(f.pool as never, "n1", { accept: true, thread_id: "t1" });
    expect(out).toEqual({ ok: true, route_state: "accepted" });
    const sql = f.written[0]?.sql ?? "";
    expect(sql).toContain("route_state = 'accepted'");
    // Only a proposal can be settled: an accepted note is not decided twice, and a 'none' note was
    // already filed (A4 §8.3 row 3).
    expect(sql).toContain("route_state = 'proposed'");
    expect(f.written[0]?.params).toEqual(["n1", "t1", null]);
  });

  it("accept: writes a person target into the person column and leaves the thread column empty", async () => {
    const f = fakePool([[{ route_state: "accepted" }]]);
    await decideNoteRouting(f.pool as never, "n1", { accept: true, person_id: "p1" });
    expect(f.written[0]?.params).toEqual(["n1", null, "p1"]);
  });

  it("accept without a target is a bad request — A4 §8.3 attaches the note or it is not accepted", async () => {
    const f = fakePool();
    await expect(decideNoteRouting(f.pool as never, "n1", { accept: true })).resolves.toEqual({
      ok: false,
      reason: "bad_request",
    });
    await expect(
      decideNoteRouting(f.pool as never, "n1", { accept: true, thread_id: "t1", person_id: "p1" }),
    ).resolves.toEqual({ ok: false, reason: "bad_request" });
    expect(f.written).toEqual([]);
  });

  it("don't route: files the note unrouted and clears whatever target it carried", async () => {
    const f = fakePool([[{ route_state: "none" }]]);
    const out = await decideNoteRouting(f.pool as never, "n1", { accept: false });
    expect(out).toEqual({ ok: true, route_state: "none" });
    const sql = f.written[0]?.sql ?? "";
    expect(sql).toContain("route_state = 'none'");
    expect(sql).toContain("routed_to_thread_id = NULL");
    expect(sql).toContain("routed_to_person_id = NULL");
    expect(f.written[0]?.params).toEqual(["n1"]);
  });

  it("tells a missing note apart from one that is not awaiting a decision", async () => {
    // No row updated: the UPDATE ... RETURNING came back empty, and the second read is what says
    // whether the id exists at all. 404 and 409 are different problems for the screen.
    const gone = fakePool([[], []]);
    await expect(decideNoteRouting(gone.pool as never, "n1", { accept: false })).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    const settled = fakePool([[], [{ route_state: "accepted" }]]);
    await expect(
      decideNoteRouting(settled.pool as never, "n1", { accept: false }),
    ).resolves.toEqual({ ok: false, reason: "not_proposed" });
  });
});
