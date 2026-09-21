// US-B28 (Today screen) screenshots: docs/design/screens/w4b/today-{1440,390}.png.
//
// Same stack and the same two sizes as shots-w4b.ts (1440x900 and 390x844). This story does need a
// fixture of its own, and the reason is in the seed: `docs/design/screens/*` has never pictured the
// Today screen, because until US-B28 there was nothing to picture. Three of the seed's rows are what
// today's screen is made of, and the seed has none of them for *today*:
//
//   - `items(kind='event')` — gcal's three fixtures are dated 25 Sep / 2 Oct 2026, so the schedule
//     section shoots its empty line.
//   - `pending_approvals` — the seed proposes exactly one.
//   - `digests` — the seed writes none; US-B23/US-B24's loops are the only writers.
//
// So the fixture below drives those three through the real production paths rather than typing rows
// in: google-calendar's own `normalize()` → the kernel `IngestSink` for the events, the kernel's
// `approvals.propose` for the queue, `autoArchiveLoop.apply` for the archived items, and
// `morningDigestLoop.apply` / `nightlyDigestLoop.apply` for the two digests. The digests are then
// genuinely produced by A4 §6.3's candidate query and ranking over the seeded rows — only the two
// sentences each loop asks the model for are stubbed, since a fixture that called T1 would need a
// network and a key. What the frame shows is therefore what the screen shows on a real morning,
// not a mock of it.
//
// Run: pnpm tsx tools/e2e/shots-w4b-today.ts   (same ports as the e2e smoke — never run both at once)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "@playwright/test";
import { normalize as normalizeGcal } from "../../packages/adapters/google-calendar/src/index.js";
import {
  AUTO_ARCHIVE_RULES,
  autoArchiveLoop,
  configureAgents,
  morningDigestLoop,
  nightlyDigestLoop,
} from "../../packages/agents/src/index.js";
import { Pool, one, query } from "../../packages/db/src/index.js";
import { createIngestSink, createKernel, createLogger } from "../../packages/kernel/src/index.js";
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
const logger = createLogger("@omnis/shots-today");

/** Today's calendar, in the shape google-calendar's API returns it. Local wall-clock on purpose:
 *  the machine and the dev database are both Asia/Seoul (the digest loops pin that zone too), and an
 *  offset of +09:00 on today's date is what a real KST calendar hands the adapter. */
function todayAt(hour: number, minute: number): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${ymd}T${pad(hour)}:${pad(minute)}:00+09:00`;
}

const TODAYS_EVENTS: { hour: number; minute: number; summary: string; who: string }[] = [
  { hour: 9, minute: 15, summary: "Design system sync", who: "Dana Lee" },
  { hour: 11, minute: 0, summary: "Brightstone contract review", who: "Minjun Park" },
  { hour: 15, minute: 30, summary: "Northwind legal call", who: "client@example.com" },
];

/** Four asks on four different threads. Unique strings, like shots.ts's per-thread fallback: a
 *  screenshot that catches four approvals must not print the same sentence twice, which reads as a
 *  rendering bug rather than a queue. */
const ASKS = [
  "Send the countersigned NDA back to Northwind legal?",
  "Put the Friday 14:00 design review on the calendar?",
  "Approve the Brightstone redlines and reply to Dana Lee?",
  "Reissue invoice 2291 with the corrected purchase-order number?",
];

/** The auto-archive reasons a real sweep writes (A4 §9.1). Free strings of at most 40 chars. */
const ARCHIVE_REASONS = ["newsletter", "receipt"];

/** US-B23/B24 ask the model for two sentences each, and nothing else — the ranking is arithmetic
 *  (A4 §6.3: `rankBriefItems`, not the LLM). Stubbing exactly those two sentences is what lets the
 *  whole rest of the loop run for real: the candidate query, the rank, the section assembly and the
 *  INSERT on digests are the production code path. */
function stubResult<T>(loop: "digest" | "auto_archive", output: T) {
  return {
    loop,
    run_id: "e2e-shots-today",
    output,
    confidence: 1,
    rationale: "e2e screenshot fixture",
    escalate: false,
    injection_flags: [],
    unresolved: [],
  };
}

const nowContext = () => ({
  trigger_kind: "manual" as const,
  now: new Date(),
  payload: {} as Record<string, unknown>,
});

/** The three rows the Today screen is made of, all through production code. */
async function densifyToday(pool: Pool): Promise<void> {
  // ── 1) today's calendar (real gcal normalize → the real IngestSink)
  const calendar = await one<{ id: string }>(
    pool,
    "SELECT id FROM accounts WHERE channel = 'gcal' LIMIT 1",
  );
  const sink = createIngestSink({ pool, logger });
  for (const [i, e] of TODAYS_EVENTS.entries()) {
    const raw = {
      kind: "calendar#event",
      id: `evt_today_${String(i + 1)}`,
      status: "confirmed",
      summary: e.summary,
      start: { dateTime: todayAt(e.hour, e.minute), timeZone: "Asia/Seoul" },
      end: { dateTime: todayAt(e.hour, e.minute + 30), timeZone: "Asia/Seoul" },
      attendees: [{ email: "dana@example.com", displayName: e.who, responseStatus: "accepted" }],
    };
    for (const item of normalizeGcal(raw)) await sink(calendar.id, item);
  }

  // ── 2) the approval queue (contract §5: kernel.approvals.propose is the only way one exists)
  const kernel = createKernel({ pool, logger });
  try {
    // The seed's own approval already sits on the Slack thread; these go on other threads so the
    // briefing's `needs_you` section is a queue rather than one row (rankBriefItems keeps at most
    // one candidate per thread — A4 §6.3's last term).
    const slack = await one<{ id: string }>(
      pool,
      "SELECT t.id FROM threads t JOIN accounts a ON a.id = t.account_id WHERE a.channel = 'slack' LIMIT 1",
    );
    const threads = await query<{ id: string; title: string | null }>(
      pool,
      `SELECT id, title FROM threads
        WHERE kind <> 'agent_session' AND id <> $1 ORDER BY created_at LIMIT $2`,
      [slack.id, ASKS.length],
    );
    for (const [i, t] of threads.entries()) {
      const description = ASKS[i] ?? `Reply on ${t.title ?? "this thread"}?`;
      await kernel.approvals.propose({
        action: "send",
        args: { channel: "slack", body: description },
        description,
        config: { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true },
        risk: i === 0 ? "high" : "normal",
        thread_id: t.id,
      });
    }
  } finally {
    await kernel.close();
  }

  // ── 3) a night's worth of auto-archive, through the loop that writes it
  configureAgents({ pool });
  const archivable = await query<{ id: string; thread_id: string }>(
    pool,
    `SELECT id, thread_id FROM items
      WHERE status = 'received' AND author_is_me = false AND kind IN ('message','email')
      ORDER BY sent_at DESC LIMIT 6`,
  );
  for (const [i, item] of archivable.entries()) {
    await autoArchiveLoop.apply(
      stubResult("auto_archive", {
        archive: true,
        reason: ARCHIVE_REASONS[i % ARCHIVE_REASONS.length] ?? "newsletter",
        rule_ids: [AUTO_ARCHIVE_RULES.senderNonHuman, AUTO_ARCHIVE_RULES.noCta],
        tier: "T0" as const,
        confidence: 0.95,
        rationale: "no question and no prior reply",
        injection_flags: [],
      }),
      { ...nowContext(), item_id: item.id, thread_id: item.thread_id },
    );
  }

  // ── 4) the two digests. Morning first: its candidates include the approvals above.
  await morningDigestLoop.apply(
    stubResult("digest", {
      greeting: "Good morning",
      one_liner: `${String(TODAYS_EVENTS.length)} meetings, ${String(ASKS.length)} approvals waiting, and the Brightstone redlines are the one thing that cannot slip.`,
      confidence: 0.9,
      rationale: "e2e screenshot fixture",
      injection_flags: [],
    }),
    nowContext(),
  );
  await nightlyDigestLoop.apply(
    stubResult("digest", {
      headline: "Nothing urgent slipped through",
      one_liner: "Handled while you were out.",
      confidence: 0.9,
      rationale: "e2e screenshot fixture",
      injection_flags: [],
    }),
    nowContext(),
  );
}

/** One frame plus the horizontal-overflow reading. Both readings are asserted here (unlike
 *  shots-w4b.ts, which prints the element scan because its floating panel legitimately reaches past
 *  the edge): the Today screen draws nothing that is meant to sit outside the viewport, so at 1440
 *  and at 390 anything past the edge is a defect. */
async function shoot(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(700);
  const file = join(OUT, `today-${label}.png`);
  await page.screenshot({ path: file });
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  today-${label}.png — ${describeOverflow(overflow)}`);
  if (overflow.diff > 0 || overflow.worst !== null) {
    throw new Error(`the Today screen overflows at ${label}px: ${describeOverflow(overflow)}`);
  }
}

/** A finished screen, not an empty one. The three sections are waited for by name and the state
 *  word is read off the surface, because a frame of `data-state="empty"` is exactly the placeholder
 *  this shot exists to disprove — and it would still screenshot cleanly. */
async function openToday(page: Page): Promise<void> {
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/?screen=today`);
  await page.waitForSelector(".today-screen", { timeout: 60_000 });
  await page.waitForSelector(".today-screen__brief-group", { timeout: 30_000 });
  await page.waitForSelector(".today-screen__event", { timeout: 30_000 });
  await page.waitForSelector(".today-screen__chip", { timeout: 30_000 });
  const state = await page.getAttribute(".today-screen", "data-state");
  if (state !== "ready") {
    throw new Error(`the Today screen is in state "${String(state)}", not "ready"`);
  }
}

/** 1440x900 — the three-pane shell. The first chip is expanded: A5 §3.4's whole point is that the
 *  queue opens its card in place rather than navigating, and a frame of the strip with every chip
 *  closed cannot show that. */
async function widePass(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await openToday(page);
    await page.locator(".today-screen__chip").first().click();
    await page.waitForSelector(".today-screen__expanded", { timeout: 10_000 });
    await shoot(page, "1440");
  } finally {
    await page.close();
  }
}

/** 390x844 — one column and the bottom bar. The strip is left closed here: the expanded card lands
 *  below the fold on a narrow screen, so the frame would show the same top of the page either way. */
async function narrowPass(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openToday(page);
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
    await densifyToday(pool);

    // What the screen will draw, asked of the database before the browser is even open. The morning
    // row's `for_date` is printed rather than asserted: it is stored as a `date` and reaches Zero as
    // a number, and the plan's own open question is whether that number is KST midnight or UTC
    // midnight — a wrong answer shows up below as the briefing section simply not being there.
    const digests = await query<{ kind: string; for_date: unknown; items: number }>(
      pool,
      "SELECT kind, for_date, cardinality(item_ids) AS items FROM digests ORDER BY kind",
    );
    for (const d of digests) {
      console.log(`digests ${d.kind}: for_date=${String(d.for_date)} item_ids=${String(d.items)}`);
    }
    const [todayCount] = await query<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM items WHERE kind = 'event'
        AND sent_at >= date_trunc('day', now()) AND sent_at < date_trunc('day', now()) + interval '1 day'`,
    );
    const [pending] = await query<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM pending_approvals WHERE state = 'pending'",
    );
    console.log(`today: events=${String(todayCount?.n)} pending_approvals=${String(pending?.n)}`);
    if (todayCount?.n === "0" || pending?.n === "0" || digests.length === 0) {
      throw new Error("the fixture did not produce what the Today screen draws");
    }

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
      await widePass(browser);
      await narrowPass(browser);
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
