// US-B30 (Network screen) screenshots: docs/design/screens/w4b/network-{1440,390}.png.
//
// Same stack and the same two sizes as shots-w4b-today.ts and shots-w4b-tasks.ts (1440x900 and
// 390x844). This story needs a fixture of its own because the seed produces exactly one person per
// account it replays (`resolvePerson` fires once per author in the adapter fixtures) — a grid of two
// cards screenshots as cleanly as a screen whose query returned nothing, which is the failure mode
// these shots exist to rule out.
//
// The people are driven through the **real** writers, the same call the other two shot tools make:
//
//   - `createIngestSink` (packages/kernel/src/ingest.ts) for every message. That is the production
//     entry point, and it is what calls `resolvePerson` — so the persons, the `identities` rows (two
//     on the person who writes from two channels, which is A3 §10 step 2's cross-channel match), the
//     threads and the items are all produced by the code that produces them in production.
//   - `followupLoop.apply` (packages/agents/src/loops/followup.ts, A4 §7.3 L6) for each person's
//     relationship state, cadence and note. Only the model's own output is stubbed — the sentences T1
//     would return — and only `relationship_update` is populated, because that is the whole of what
//     this loop writes.
//
// Four `persons` columns have **no writer anywhere in this wave**, and the fixture fills them
// directly rather than pretending otherwise:
//
//   - `org`, `role`  — A4 §3.2's entity "as of now" view. Memory-ingestion scope, and it has no Zero
//                      table, so nothing in this build can compute them.
//   - `next_followup_at`, `priority_score` — the values A5 §3.6's queue reads. `followupLoop.apply`
//                      writes only `relationship_state`, `cadence_days` and `notes` (verified
//                      repo-wide), so the L6 loop does not populate the queue on this wave.
//
// Everything else on a person — `item_count`, `first_contact_at`, `last_contact_at`,
// `primary_thread_id` — is rolled up in SQL from the items the sink actually stored, so the frame
// cannot show a message count that no row backs.
//
// Run: pnpm tsx tools/e2e/shots-w4b-network.ts   (same ports as the e2e smoke — never run both at once)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "@playwright/test";
import { configureAgents, followupLoop } from "../../packages/agents/src/index.js";
import { Pool, one, query } from "../../packages/db/src/index.js";
import { createIngestSink, createLogger } from "../../packages/kernel/src/index.js";
import type { Channel, NormalizedItem } from "../../packages/protocol/src/index.js";
import { describeOverflow, measureOverflow } from "./overflow.js";
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
const logger = createLogger("@omnis/shots-network");

/** The two accounts the fixture's messages arrive on. Both are email channels because identity
 *  resolution is the thing that has to run for real: an email handle is the only key A3 §10 matches
 *  across channels (slack needs a `team:user` pair, and the seed's own slack handle format is
 *  rejected by `handleNorm` — which is why the seed yields no slack person). */
const GMAIL = "gmail" as const;
const OUTLOOK = "outlook" as const;

interface PlannedPerson {
  name: string;
  org: string;
  role: string;
  /** The address they write from. On the person with two channels the local part carries no dot on
   *  purpose: `handleNorm` collapses dots for gmail and keeps them for outlook, so `d.park@…` would
   *  normalize to two different keys and land as two people instead of one. */
  email: string;
  /** What they have written, one entry per channel. A second entry is a second `identities` row on
   *  the same person — the cross-channel link the detail pane's Handles list draws — and it carries
   *  its own date and subject, because two conversations with one person are not one conversation
   *  that happened twice. The `daysAgo` values become the items' `sent_at`, so every date and count
   *  on the screen is derived from a row rather than typed twice. */
  messages: { channel: typeof GMAIL | typeof OUTLOOK; daysAgo: number; subject: string }[];
  /** A4 §7.4's `relationship_update.state`, the one part of a person a loop really writes. All four
   *  of the screen's relationship words are here so the 3-tier dot is drawn at every level. */
  state: "new" | "warming" | "active" | "dormant";
  cadenceDays: number;
  note: string;
  vip: boolean;
  /** Days ago the follow-up fell due; null for a person nobody has scheduled one for. */
  dueDaysAgo: number | null;
  priority: number;
}

/** Eight people. Six are on one channel and two are on two, which is what makes the Handles section
 *  of the detail pane show more than a single line. The relationship states cover all four of the
 *  screen's words, and four of them have a follow-up due — enough chips that the queue strip has to
 *  wrap at 390, which is the layout the narrow frame exists to check.
 *
 *  The due dates are spread across the three shapes `followupDueLabel` prints (today / yesterday /
 *  a date, past the six-day cut-off) so the strip is legible as a ranking rather than four identical
 *  chips. */
/** The person the wide frame opens, and the one who is on two channels — named so the merge target
 *  below cannot drift away from the plan entry it refers to. */
const DAVID_EMAIL = "davidpark@davich.example";

const PLAN: PlannedPerson[] = [
  {
    name: "David Park",
    org: "Davich",
    role: "CTO",
    email: DAVID_EMAIL,
    // Two channels, two threads, two dates: the outlook thread is the one from last winter the
    // gmail thread picked up from, which is why the pane's First and Last contact differ and its
    // Conversations list is not the same row twice.
    messages: [
      { channel: GMAIL, daysAgo: 41, subject: "Q3 platform review" },
      { channel: OUTLOOK, daysAgo: 251, subject: "Platform review deck" },
    ],
    state: "active",
    cadenceDays: 30,
    note: "Owes us the platform review deck; asked for it after the offsite.",
    vip: true,
    dueDaysAgo: 11,
    priority: 0.92,
  },
  {
    name: "Sora Kim",
    org: "Ownered Lab",
    role: "Product lead",
    email: "sora@owneredlab.example",
    messages: [{ channel: GMAIL, daysAgo: 3, subject: "Pilot retro agenda" }],
    state: "active",
    cadenceDays: 21,
    note: "Weekly cadence since the pilot started.",
    vip: true,
    dueDaysAgo: 0,
    priority: 0.88,
  },
  {
    name: "Priya Raman",
    org: "Northwind",
    role: "Head of Ops",
    email: "priya@northwind.example",
    messages: [{ channel: GMAIL, daysAgo: 27, subject: "Rollout numbers" }],
    state: "warming",
    cadenceDays: 21,
    note: "Wants the rollout numbers before she commits to a date.",
    vip: false,
    dueDaysAgo: 2,
    priority: 0.81,
  },
  {
    name: "Marcus Webb",
    org: "Brightstone Realty",
    role: "Broker",
    email: "marcuswebb@brightstone.example",
    messages: [{ channel: GMAIL, daysAgo: 96, subject: "Spring lease renewal" }],
    state: "dormant",
    // Two years of nothing but listing mail: the cadence is set by hand rather than by the loop.
    cadenceDays: 120,
    note: "Only forwards listings now — the lease conversation went quiet in the spring.",
    vip: false,
    dueDaysAgo: 34,
    priority: 0.64,
  },
  {
    name: "Elena Rossi",
    org: "Northwind Legal",
    role: "Counsel",
    email: "elena@northwindlegal.example",
    messages: [{ channel: OUTLOOK, daysAgo: 6, subject: "Countersigned NDA" }],
    state: "active",
    cadenceDays: 30,
    note: "Handles the countersigned NDAs; cc her on anything contractual.",
    vip: false,
    dueDaysAgo: null,
    priority: 0.55,
  },
  {
    name: "Tom Alvarez",
    org: "Meridian Freight",
    role: "Founder",
    email: "tom@meridianfreight.example",
    messages: [{ channel: GMAIL, daysAgo: 12, subject: "Tracking integration" }],
    state: "warming",
    cadenceDays: 45,
    note: "Met at the logistics meetup; interested in the tracking integration.",
    vip: false,
    dueDaysAgo: null,
    priority: 0.48,
  },
  {
    name: "Yuki Tanaka",
    org: "Kite Systems",
    role: "Staff engineer",
    email: "yuki@kitesystems.example",
    messages: [{ channel: OUTLOOK, daysAgo: 19, subject: "Intro from Sora" }],
    state: "new",
    cadenceDays: 30,
    note: "Introduced by Sora — first call is not booked yet.",
    vip: false,
    dueDaysAgo: null,
    priority: 0.3,
  },
  {
    name: "Nadia Haddad",
    org: "Haddad Studio",
    role: "Designer",
    email: "nadia@haddadstudio.example",
    messages: [{ channel: GMAIL, daysAgo: 0, subject: "Portfolio review" }],
    state: "warming",
    cadenceDays: 60,
    // The newest contact, and the one person A4 §7.4's `relationship_update` wrote no note for —
    // `followupLoop.apply` COALESCEs the note, so an absent one leaves `persons.notes` NULL and the
    // detail pane's Notes section is the only empty one it has to draw.
    note: "",
    vip: false,
    dueDaysAgo: null,
    priority: 0.22,
  },
];

/** The person who is on the grid once but exists as two rows. A3 §10 resolves people from the
 *  handle, and this one reached us through a channel that spells his address with the dot in it:
 *  `handleNorm` collapses dots for gmail and keeps them for outlook, so the two spellings normalize
 *  to two keys and land as two people. That is precisely the case resolution cannot decide and the
 *  "This is the same person" button exists for — so the fixture merges them, and the merged row must
 *  then be absent from the grid (drawing both is drawing one person twice under two names). */
const MERGED_AWAY = { name: "Dave Park", email: "david.park@davich.example" } as const;

function accountFor(pool: Pool, channel: Channel, externalId: string, display: string) {
  return one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display, capabilities)
       VALUES ($1, $2, $3, '{"read":true,"write":true}'::jsonb)
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
       RETURNING id`,
    [channel, externalId, display],
  );
}

function itemFor(
  p: Pick<PlannedPerson, "email" | "name">,
  channel: Channel,
  externalId: string,
  sentAt: string,
  subject: string,
): NormalizedItem {
  return {
    threadExternalId: `${p.email}/${subject}`,
    externalId,
    kind: "email",
    author: { kind: "person", id: p.email },
    body: subject,
    attachments: [],
    sentAt,
    status: "received",
    sourceHash: `${channel}:${externalId}`,
    threadMeta: {
      externalId: `${p.email}/${subject}`,
      kind: "email",
      title: subject,
      participants: [{ externalId: p.email, displayName: p.name }],
      lastItemAt: sentAt,
      archivedAt: null,
    },
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Which person holds this normalized handle. `DISTINCT` because a person reached on two channels has
 *  one `identities` row per channel and both carry the same `handle_norm` — A3 §10 step 2 adds the
 *  second one deliberately, and the table's unique key is `(channel, handle_norm)`, not the handle
 *  alone. Without it the two-channel person matches twice and this throws. */
async function personIdFor(pool: Pool, handleNorm: string): Promise<string> {
  const row = await one<{ id: string }>(
    pool,
    `SELECT DISTINCT p.id FROM persons p
       JOIN identities i ON i.person_id = p.id
      WHERE i.handle_norm = $1`,
    [handleNorm],
  );
  return row.id;
}

/** Every person in these frames, written by the code that writes people. */
async function seedNetwork(pool: Pool): Promise<void> {
  configureAgents({ pool });
  const sink = createIngestSink({ pool, logger });
  const gmail = await accountFor(pool, GMAIL, "e2e-network-gmail", "e2e network gmail");
  const outlook = await accountFor(pool, OUTLOOK, "e2e-network-outlook", "e2e network outlook");
  const accountIds: Record<string, string> = { gmail: gmail.id, outlook: outlook.id };

  for (const [i, p] of PLAN.entries()) {
    for (const m of p.messages) {
      await sink(
        accountIds[m.channel] ?? "",
        itemFor(p, m.channel, `net-${String(i)}-${m.channel}`, daysAgo(m.daysAgo), m.subject),
      );
    }
  }
  // The duplicate, through the account whose spelling of his address does not normalize to David's.
  await sink(
    accountIds[OUTLOOK] ?? "",
    itemFor(MERGED_AWAY, OUTLOOK, "net-merged-away", daysAgo(120), "Re: Q3 platform review"),
  );

  // The rolled-up columns, from the items the sink actually stored. Nothing in this wave maintains
  // them (there is no person-rollup job), so this is the fixture standing in for it — and doing it
  // from the rows rather than from the PLAN above is what keeps the frame's message count and
  // contact date honest.
  await query(
    pool,
    `UPDATE persons p
        SET item_count = c.n,
            first_contact_at = c.first_at,
            last_contact_at = c.last_at,
            primary_thread_id = c.thread_id
       FROM (SELECT i.author_person_id AS pid,
                    count(*) AS n,
                    min(i.sent_at) AS first_at,
                    max(i.sent_at) AS last_at,
                    (array_agg(i.thread_id ORDER BY i.sent_at DESC))[1] AS thread_id
               FROM items i
              WHERE i.author_person_id IS NOT NULL
              GROUP BY 1) c
      WHERE p.id = c.pid`,
  );

  const merged = await personIdFor(pool, MERGED_AWAY.email);
  await query(pool, "UPDATE persons SET merged_into = $2 WHERE id = $1", [
    merged,
    await personIdFor(pool, DAVID_EMAIL),
  ]);

  // A4 §7.3's L6 loop, once per person — the state, the cadence and the note are its output.
  for (const p of PLAN) {
    const personId = await personIdFor(pool, p.email);
    await followupLoop.apply(
      {
        loop: "followup",
        run_id: "e2e-shots-network",
        output: {
          kind: "dormant_revive",
          person_id: personId,
          relationship_update: {
            state: p.state,
            cadence_days: p.cadenceDays,
            ...(p.note === "" ? {} : { note: p.note }),
          },
          confidence: 0.9,
          rationale: "e2e screenshot fixture",
          injection_flags: [],
        },
        confidence: 1,
        rationale: "e2e screenshot fixture",
        escalate: false,
        injection_flags: [],
        unresolved: [],
      },
      { trigger_kind: "event", now: new Date(), payload: {}, person_id: personId },
    );

    // A4 §3.2's entity view, and A5 §3.6's queue. No writer exists for either on this wave — see the
    // header. `dueDaysAgo` is relative to now, so the strip's "Due today" stays today whenever this
    // runs.
    await query(
      pool,
      `UPDATE persons
          SET org = $2, role = $3, vip = $4, priority_score = $5, next_followup_at = $6
        WHERE id = $1`,
      [
        personId,
        p.org,
        p.role,
        p.vip,
        p.priority,
        p.dueDaysAgo === null ? null : new Date(Date.now() - p.dueDaysAgo * 86_400_000),
      ],
    );
  }

  logger.info("network seeded");
}

/** One frame plus the horizontal-overflow reading. Both are asserted: the Network screen draws
 *  nothing meant to sit past the viewport edge, so at 1440 and at 390 anything past it is a defect. */
async function shoot(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `network-${label}.png`) });
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  network-${label}.png — ${describeOverflow(overflow)}`);
  if (overflow.diff > 0 || overflow.worst !== null) {
    throw new Error(`the Network screen overflows at ${label}px: ${describeOverflow(overflow)}`);
  }
}

/** A finished screen, not an empty one: the state word off the surface, then the queue strip, the
 *  grid and a named card. A frame of `data-state="loading"` — or of "No people yet" — would
 *  screenshot just as cleanly, which is exactly what this shot exists to disprove. */
async function openNetwork(page: Page): Promise<void> {
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/?screen=network`);
  await page.waitForSelector(".network-screen", { timeout: 60_000 });
  await page.waitForSelector(".network-screen__queue-chip", { timeout: 30_000 });
  await page.waitForSelector(".person-card", { timeout: 30_000 });
  const state = await page.getAttribute(".network-screen", "data-state");
  if (state !== "ready") {
    throw new Error(`the Network screen is in state "${String(state)}", not "ready"`);
  }
}

/** 1440x900 — all three panes. The rail and the main column are there from the first paint, but the
 *  detail column only exists once something is open, so this clicks a person first: that is the one
 *  navigation the screen makes into the pane (A5 §3.6's card → person), and the frame has to show
 *  what it has to survive — rail + queue + grid + detail at 1440.
 *
 *  David Park, because he is the person with the most in the pane: two channels in Handles, two
 *  conversations, an affiliation row, a note, and a follow-up block on his card underneath. A person
 *  with one handle and one thread would draw the same pane with half its sections empty. */
async function widePass(browser: Browser, expected: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await openNetwork(page);
    // The card's own count, checked before the pane opens and narrows the grid.
    const cards = await page.locator(".network-screen__cell").count();
    if (cards !== expected) {
      throw new Error(`the grid drew ${String(cards)} cards, the database has ${String(expected)}`);
    }
    // `.person-card__name--open` is a button only when the shell passed a handler, so this doubles as
    // the check that the open route is wired rather than drawn as inert text.
    await page
      .locator(".network-screen__grid")
      .getByRole("button", { name: "David Park", exact: true })
      .click();
    await page.waitForSelector(".person-detail__name", { timeout: 10_000 });
    await page.waitForSelector(".person-detail__conversation", { timeout: 10_000 });
    const name = await page.textContent(".person-detail__name");
    if (name !== "David Park") {
      throw new Error(`the detail pane opened on "${String(name)}", not on David Park`);
    }
    const handles = await page.locator(".person-detail__handle").count();
    if (handles !== 2) {
      throw new Error(`David Park has ${String(handles)} handles, the fixture gives him 2`);
    }
    await shoot(page, "1440");
  } finally {
    await page.close();
  }
}

/** 390x844 — one column. The detail pane is deliberately left closed: at this width it is a glass
 *  sheet over the whole screen (app.css takes the glass off only at >=1280px), so opening a person
 *  would hide the grid the frame exists to show. What the narrow frame checks is the re-flow — the
 *  queue strip wrapping to several rows and the grid falling to a single column — with nothing over
 *  the top of it. */
async function narrowPass(browser: Browser, expected: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openNetwork(page);
    const cards = await page.locator(".network-screen__cell").count();
    if (cards !== expected) {
      throw new Error(`the grid drew ${String(cards)} cards, the database has ${String(expected)}`);
    }
    await shoot(page, "390");
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
    // How many people the seed itself resolved, so the grid's expected size is measured rather than
    // assumed: a change to the adapter fixtures changes this number and should not silently change
    // the shot.
    const [before] = await query<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM persons WHERE merged_into IS NULL",
    );
    await seedNetwork(pool);

    const [visible] = await query<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM persons WHERE merged_into IS NULL",
    );
    const expected = Number(visible?.n ?? 0);
    if (Number(before?.n ?? 0) + PLAN.length !== expected) {
      throw new Error(
        `expected ${String(Number(before?.n ?? 0) + PLAN.length)} people, found ${String(expected)} — the fixture's addresses did not all resolve to distinct people`,
      );
    }

    // What the screen will draw, asked of the database before the browser is open. The ORDER BY is
    // the screen's own `followupQueue` restated in SQL, which is a second place for the same rule to
    // live — accepted here because the alternative is asserting against the rendered page, and a page
    // assertion cannot tell "one chip is missing" from "the strip rendered at all".
    const queue = await query<{ display_name: string }>(
      pool,
      `SELECT display_name FROM persons
        WHERE merged_into IS NULL AND next_followup_at IS NOT NULL AND next_followup_at <= now()
        ORDER BY priority_score DESC`,
    );
    const names = queue.map((q) => q.display_name);
    console.log(
      `people ${String(expected)}, follow-up queue ${String(names.length)}: ${names.join(", ")}`,
    );
    const want = ["David Park", "Sora Kim", "Priya Raman", "Marcus Webb"];
    if (names.join("|") !== want.join("|")) {
      throw new Error(
        `the queue is ${JSON.stringify(names)}, the frame needs ${JSON.stringify(want)} (due, unmerged, by priority_score desc)`,
      );
    }

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
      await widePass(browser, expected);
      await narrowPass(browser, expected);
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
