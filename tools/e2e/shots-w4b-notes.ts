// US-B31 (Notes screen) screenshots: docs/design/screens/w4b/notes-{1440,390}.png.
//
// Same stack and the same two sizes as the other w4b shot tools (1440x900 and 390x844). This story
// needs a fixture of its own because the seed writes no `notes` rows at all, and a screen whose list
// is empty screenshots as cleanly as one whose query returned nothing — the failure mode these
// frames exist to rule out.
//
// Every note is driven through the **real** writers, the same call shots-w4b-tasks and
// shots-w4b-network make:
//
//   - `createNote` (apps/hub/src/notes.ts) inserts the row and emits `note.created`, which is the
//     production path a press of Save takes. Only the emit's delivery differs: this process has no
//     loop runner subscribed, so the L7 loop is run by hand below, the way the hub's own runner
//     would run it 2 seconds later.
//   - `noteRouteLoop.apply` (packages/agents/src/loops/note-route.ts, A4 §8) for the loop itself.
//     It owns the confidence gate — the frame's fourth note is below 0.50 and the loop, not this
//     fixture, is what files it unrouted — and it is what calls `propose_route`, which is the write
//     that puts the candidate JSON in `notes.rationale`.
//   - `decideNoteRouting` (apps/hub/src/notes.ts) for the two accepted notes: the human's half of
//     A4 §8.3, and the same function `POST /notes/:id/route` calls.
//
// Only the model's own output is stubbed — the candidates T1 would have narrowed to — and every
// candidate names a row that exists (a person and a thread the seed produced), so the suggestion's
// target label on screen is resolved from real data rather than from a string this fixture typed.
//
// Run: pnpm tsx tools/e2e/shots-w4b-notes.ts   (same ports as the e2e smoke — never run both at once)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "@playwright/test";
import { createNote, decideNoteRouting } from "../../apps/hub/src/notes.js";
import { configureAgents, noteRouteLoop } from "../../packages/agents/src/index.js";
import { Pool, query } from "../../packages/db/src/index.js";
import { createEvents, createLogger } from "../../packages/kernel/src/index.js";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { seed } from "./seed.js";
import {
  HUB_PORT,
  REPO_ROOT,
  VITE_PORT,
  ZERO_PORT,
  assertPortsFree,
  deployZeroPermissions,
  loadOrCreateEnv,
  resetDatabase,
  startDesktop,
  startHub,
  startZeroCache,
  stopAll,
  waitForHttp,
} from "./stack.js";

const OUT = join(REPO_ROOT, "docs/design/screens/w4b");
const logger = createLogger("@omnis/shots-notes");

/** A4 §8.3's line. Below it the loop stores no proposal at all, which is the state the fourth note
 *  in this fixture is here to photograph. */
const ROUTE_CONFIDENCE_MIN = 0.5;

interface PlannedNote {
  /** What the note says. `{person}` is filled with the name of the person the candidate points at,
   *  so the note and its suggestion are about the same human. */
  body: string;
  /** Days ago it was written — the list is ordered by this, and the panel belongs to the newest note
   *  that still has a candidate. */
  daysAgo: number;
  candidate: {
    /** Which row the candidate names. `person` uses the first person the seed resolved, `thread` the
     *  most recently active thread; both are read out of the database before this runs. */
    kind: "person" | "thread";
    confidence: number;
    why: string;
  };
  /** What the human did with the suggestion. `accept-thread` / `accept-person` settle it through
   *  `decideNoteRouting`; `leave` is the note the panel's three buttons act on. */
  decide: "accept-thread" | "accept-person" | "leave";
}

const PLAN: PlannedNote[] = [
  {
    // The newest note, and the only one still awaiting a decision — so it is the one the suggestion
    // panel above the list is about.
    body: "Give {person} a heads-up that the PoC needs 3 more days",
    daysAgo: 0,
    candidate: { kind: "person", confidence: 0.91, why: "The note is about them" },
    decide: "leave",
  },
  {
    body: "Add the renewal numbers before the contract review goes out",
    daysAgo: 1,
    candidate: { kind: "thread", confidence: 0.84, why: "Same project, same week" },
    decide: "accept-thread",
  },
  {
    body: "Send {person} the intro before Friday",
    daysAgo: 3,
    candidate: { kind: "person", confidence: 0.73, why: "They asked for it in the thread" },
    decide: "accept-person",
  },
  {
    // A4 §8.3 row 3: under 0.50 the loop stores no proposal at all, so this one is filed with
    // `route_state = 'none'` by the loop itself.
    body: "Retro ideas for next week: the standup format isn't working",
    daysAgo: 9,
    candidate: { kind: "thread", confidence: 0.42, why: "Vaguely related to the team sync" },
    decide: "leave",
  },
];

function stubResult<T>(loop: string, output: T) {
  return {
    loop,
    run_id: "e2e-shots-notes",
    output,
    confidence: 1,
    rationale: "e2e screenshot fixture",
    escalate: false,
    injection_flags: [],
    unresolved: [],
  };
}

/** Fills the notes in and routes them, and returns what the screen will be asked to have drawn. */
async function seedNotes(pool: Pool): Promise<{ proposed: string; threadTitle: string }> {
  const events = createEvents({ pool, logger });
  // A real person and a real thread: a candidate is an id, and the screen resolves that id to a name
  // through the tables it reads. A fixture that made the ids up would photograph the no-match copy
  // instead of the suggestion.
  const [person] = await query<{ id: string; display_name: string }>(
    pool,
    `SELECT id, display_name FROM persons
      WHERE merged_into IS NULL
      ORDER BY item_count DESC, display_name
      LIMIT 1`,
  );
  const [thread] = await query<{ id: string; title: string }>(
    pool,
    `SELECT id, title FROM threads
      WHERE title <> ''
      ORDER BY last_item_at DESC NULLS LAST
      LIMIT 1`,
  );
  if (person === undefined || thread === undefined) {
    throw new Error("the seed produced no person or no titled thread to route a note to");
  }
  configureAgents({ pool });

  let proposedCopy = "";
  for (const planned of PLAN) {
    const note = await createNote(
      pool,
      events,
      planned.body.replace("{person}", person.display_name.split(" ")[0] ?? person.display_name),
    );
    if (note === null) throw new Error(`createNote refused: ${planned.body}`);

    // `createNote` leaves `created_at` to the column default, so every note in this fixture would
    // otherwise share one instant and the list's order would be the database's to decide. The clock
    // is the fixture's to set, the same way shots-w4b-network sets `items.sent_at`.
    await query(
      pool,
      "UPDATE notes SET created_at = now() - ($2 || ' days')::interval WHERE id = $1",
      [note.id, String(planned.daysAgo)],
    );

    const target = planned.candidate.kind === "person" ? person.id : thread.id;
    await noteRouteLoop.apply(
      stubResult("note_route", {
        candidates: [
          {
            kind: planned.candidate.kind,
            id: target,
            confidence: planned.candidate.confidence,
            why: planned.candidate.why,
            suggested_use: planned.candidate.kind === "person" ? "followup" : "share",
          },
        ],
        confidence: planned.candidate.confidence,
        rationale: "e2e screenshot fixture",
        injection_flags: [],
      }),
      // A4 §8.1's own trigger context: the loop reads the note id off it.
      { trigger_kind: "event", now: new Date(), payload: {}, note_id: note.id },
    );

    const stored = await query<{ route_state: string; rationale: string | null }>(
      pool,
      "SELECT route_state, rationale FROM notes WHERE id = $1",
      [note.id],
    );
    const wantState = planned.candidate.confidence >= ROUTE_CONFIDENCE_MIN ? "proposed" : "none";
    if (stored[0]?.route_state !== wantState) {
      throw new Error(
        `note "${planned.body}" is '${String(stored[0]?.route_state)}' after the loop, expected '${wantState}'`,
      );
    }

    if (planned.decide !== "leave") {
      const outcome = await decideNoteRouting(pool, note.id, {
        accept: true,
        ...(planned.decide === "accept-thread"
          ? { thread_id: thread.id }
          : { person_id: person.id }),
      });
      if (!outcome.ok) {
        throw new Error(`the fixture could not accept "${planned.body}": ${outcome.reason}`);
      }
    }

    if (planned.decide === "leave" && planned.candidate.confidence >= ROUTE_CONFIDENCE_MIN) {
      // The copy the panel will draw, assembled here so the assertion is about the screen and not
      // about this fixture agreeing with itself.
      const band = planned.candidate.confidence >= 0.8 ? "high" : "low";
      proposedCopy = `Routing suggestion: share to ${person.display_name} (${band} confidence)`;
    }
  }

  await events.close();
  logger.info("notes seeded");
  return { proposed: proposedCopy, threadTitle: thread.title };
}

/** One frame plus the horizontal-overflow reading. Measured before the shutter, not after: at 1440 and
 *  at 390 anything past the edge is a defect, and a run that fails on it should not leave the frame
 *  behind for someone to commit. */
async function shoot(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(measureOverflow);
  assertNoOverflow(`notes at ${label}px`, overflow);
  console.log(`  notes-${label}.png — ${describeOverflow(overflow)}`);
  await page.screenshot({ path: join(OUT, `notes-${label}.png`) });
}

/** A finished screen, not an empty one: the state word off the surface, the suggestion panel, the
 *  recent-notes list, and the one note that is still waiting. A frame of `data-state="loading"` — or
 *  of "No notes yet." — would screenshot just as cleanly, which is what this check exists to
 *  disprove. */
async function openNotes(
  page: Page,
  expected: { proposed: string; threadTitle: string },
): Promise<void> {
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/?screen=notes`);
  await page.waitForSelector(".notes-screen", { timeout: 60_000 });
  await page.waitForSelector(".notes-screen__suggestion-copy", { timeout: 60_000 });
  await page.waitForSelector(".notes-screen__note", { timeout: 30_000 });

  const state = await page.getAttribute(".notes-screen", "data-state");
  if (state !== "ready") {
    throw new Error(`the Notes screen is in state "${String(state)}", not "ready"`);
  }
  const copy = await page.textContent(".notes-screen__suggestion-copy");
  if (copy !== expected.proposed) {
    throw new Error(`the suggestion reads "${String(copy)}", expected "${expected.proposed}"`);
  }
  const rows = await page.locator(".notes-screen__note").count();
  if (rows !== PLAN.length) {
    throw new Error(
      `the list drew ${String(rows)} notes, the fixture wrote ${String(PLAN.length)}`,
    );
  }
  // The decisions A5 §3.7 draws, asserted before the frame is taken: "Choose another target" is
  // follow-up scope and is drawn disabled rather than as a button that does nothing.
  const actions = page.locator(".notes-screen__suggestion-actions button");
  if ((await actions.count()) !== 3) {
    throw new Error(`the suggestion drew ${String(await actions.count())} actions, expected 3`);
  }
  if (!(await page.getByRole("button", { name: "Choose another target" }).isDisabled())) {
    throw new Error("'Choose another target' is enabled — the target picker is follow-up scope");
  }
  // The accepted thread note names the thread it went to, which is the one label on this screen that
  // is resolved from a second table.
  const where = await page.locator(".notes-screen__note-where").allTextContents();
  const wanted = `→ ${expected.threadTitle}`;
  if (!where.includes(wanted)) {
    throw new Error(`no note reads "${wanted}": ${JSON.stringify(where)}`);
  }
  if (!where.includes("Not routed")) {
    throw new Error(`no note was filed unrouted: ${JSON.stringify(where)}`);
  }
}

async function pass(
  browser: Browser,
  label: string,
  size: { width: number; height: number },
  expected: { proposed: string; threadTitle: string },
): Promise<void> {
  const page = await browser.newPage({ viewport: size });
  try {
    await openNotes(page, expected);
    await shoot(page, label);
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const env = loadOrCreateEnv();
  assertPortsFree();
  await resetDatabase(env);
  deployZeroPermissions(env);
  startZeroCache(env);
  await waitForHttp(`http://127.0.0.1:${String(ZERO_PORT)}/`, 90_000);
  startHub(env);
  await waitForHttp(`http://127.0.0.1:${String(HUB_PORT)}/health`, 60_000);
  startDesktop();
  await waitForHttp(`http://127.0.0.1:${String(VITE_PORT)}/`, 90_000);

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  let closeBridge: (() => void) | undefined;
  try {
    const seeded = await seed(pool, env);
    closeBridge = seeded.closeBridge;

    const expected = await seedNotes(pool);
    const [count] = await query<{ n: string }>(pool, "SELECT count(*)::text AS n FROM notes");
    console.log(`notes written: ${String(count?.n ?? "?")}, suggestion: ${expected.proposed}`);

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
      await pass(browser, "1440", { width: 1440, height: 900 }, expected);
      await pass(browser, "390", { width: 390, height: 844 }, expected);
    } finally {
      await browser.close();
    }
    console.log("shots written to", OUT);
  } finally {
    closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
