// US-B32 (Digest screen) screenshots: docs/design/screens/w4b/digest-{1440,390}.png.
//
// Same stack and the same two sizes as the other w4b shot tools (1440x900 and 390x844). This story
// needs a fixture of its own because the seed writes no `digests` row at all: a screen whose query
// returned nothing draws the waiting copy and screenshots just as cleanly as a finished one, which
// is the failure mode these frames exist to rule out.
//
// Everything on the frame is driven through the **real** writers, the same call the other w4b shot
// tools make:
//
//   - `hardGate` (packages/agents/src/loops/auto-archive.ts, A4 §9.2) picks the items that may be
//     archived at all. The fixture archives nothing the real gate blocks, so the frame cannot depict
//     the guard being skipped — a finance item or a VIP sender stays in the Inbox on screen.
//   - `autoArchiveLoop.apply` is the archive write itself (A4 §9.1), and the one that stamps
//     `meta.archived_by.undo_token` — the US-B32 token the digest recomputes below. Only the
//     verdict is stubbed, and only the model's own fields of it (`reason`, `rationale`,
//     `confidence`); the rule ids and the tier are the ones the T0 rule cites for a non-human
//     sender (A4 §9.2 ①–④), and the reason strings are the two that rule itself produces.
//   - `nightlyDigestLoop.apply` is the 23:00 writer of `digests` (A4 §6.4). It is what builds the
//     groups, counts them off `meta.archived_by.reason`, cuts the samples to three, and writes
//     `metrics`. Its headline is the model's, so that is stubbed too.
//   - `currentPolicy` (packages/kernel/src/cost/governor.ts) supplies the cost line A5 §3.8 asks
//     for, read off the real `agent_runs` this run left behind — no number here is typed by hand,
//     and a month with no spend truthfully reads as `$0 / $60`.
//
// The item lines on the frame are the seeded items' own `subject`/`body`, because `nightlyGroups`
// takes them from the rows (`left(COALESCE(subject, body), 90)`).
//
// Run: pnpm tsx tools/e2e/shots-w4b-digest.ts   (same ports as the e2e smoke — never run both at once)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "@playwright/test";
import {
  AUTO_ARCHIVE_RULES,
  autoArchiveLoop,
  configureAgents,
  digestIdFor,
  hardGate,
  nightlyDigestLoop,
  undoTokenFor,
} from "../../packages/agents/src/index.js";
import { Pool, query } from "../../packages/db/src/index.js";
import { currentPolicy } from "../../packages/kernel/src/cost/governor.js";
import { createIngestSink, createLogger } from "../../packages/kernel/src/index.js";
import { getSetting } from "../../packages/kernel/src/settings.js";
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
const logger = createLogger("@omnis/shots-digest");

/** A4 §9.2 ①–④: the rules the T0 branch of `autoArchiveLoop.decide` cites. */
const T0_RULE_IDS = [
  AUTO_ARCHIVE_RULES.senderNonHuman,
  AUTO_ARCHIVE_RULES.notVipNormal,
  AUTO_ARCHIVE_RULES.neverReplied,
  AUTO_ARCHIVE_RULES.noCta,
];

/** The two categories `nightlyGroups` will fold the archived items into, and the mail that goes into
 *  each. Both reason strings are the ones A4 §9.2's T0 rule produces for a non-human sender
 *  (`newsletter` when the mail carries List-Unsubscribe, `notification email` otherwise), so the
 *  frame's two category lines are the vocabulary the writer really emits.
 *
 *  The seed's own items cannot carry these: the threads it writes have a pending approval against
 *  them (A4 §9.2's gate blocks archiving there) and it has no bulk-sender mail at all. So the fixture
 *  pushes its own through the hub's **IngestSink** — the production path every adapter ends at, and
 *  the one the seed itself uses — onto threads nothing else has touched. */
const PLAN = [
  {
    reason: "newsletter",
    sender: "news@standup.example",
    thread: "The Weekly Standup",
    lines: [
      "The Weekly Standup, issue 91: what shipped, and what slipped",
      "The Weekly Standup, issue 90: the platform work, in five minutes",
      "The Weekly Standup, issue 89: three migrations and a rollback",
      "The Weekly Standup, issue 88: the quiet week",
      "The Weekly Standup, issue 87: everything we said we would do",
    ],
  },
  {
    reason: "notification email",
    sender: "no-reply@northwind.example",
    thread: "Northwind delivery notices",
    lines: [
      "Order 4471 was delivered at 14:02",
      "Order 4468 is out for delivery",
      "Your invoice for September is ready",
    ],
  },
] as const;

function stubResult<T>(loop: string, output: T) {
  return {
    loop,
    run_id: "e2e-shots-digest",
    output,
    confidence: 1,
    rationale: "e2e screenshot fixture",
    escalate: false,
    injection_flags: [],
    unresolved: [],
  };
}

interface Seeded {
  /** The digest's own date, as SQL wrote it, and the label the screen has to derive from it. */
  heading: string;
  /** reason → the count the digest recorded, in the order the groups come back. */
  groups: { reason: string; count: number; token: string }[];
  archived: number;
  /** The newest newsletter item's line — checked against what the screen draws. */
  firstLine: string;
}

/** Archives the fixture's mail, then writes the night's digest over it. */
async function seedDigest(pool: Pool): Promise<Seeded> {
  configureAgents({ pool });
  const now = new Date();

  // The hub's own ingest path, on its own threads. `items.status` lands as 'received' and
  // `sensitivity` as 'normal', which is what A4 §9.2's gate requires.
  const sink = createIngestSink({ pool, logger });
  const [account] = await query<{ id: string }>(
    pool,
    "SELECT id FROM accounts WHERE channel = 'gmail' LIMIT 1",
  );
  if (account === undefined) throw new Error("the seed created no gmail account to ingest into");

  const wanted = PLAN.reduce((n, p) => n + p.lines.length, 0);
  const archivable: { id: string; threadId: string; reason: string }[] = [];
  for (const planned of PLAN) {
    const threadExternalId = `shots-digest-${planned.reason.replaceAll(" ", "-")}`;
    let minutesAgo = 0;
    for (const body of planned.lines) {
      minutesAgo += 7;
      const sentAt = new Date(now.getTime() - minutesAgo * 60_000).toISOString();
      const externalId = `${threadExternalId}-${String(minutesAgo)}`;
      await sink(account.id, {
        threadExternalId,
        externalId,
        kind: "email",
        author: { kind: "person", id: planned.sender },
        body,
        attachments: [],
        sentAt,
        status: "received",
        sourceHash: externalId,
        threadMeta: {
          externalId: threadExternalId,
          kind: "email",
          title: planned.thread,
          participants: [{ externalId: planned.sender, displayName: planned.sender }],
          lastItemAt: sentAt,
          archivedAt: null,
        },
      });
      const [row] = await query<{ id: string; thread_id: string }>(
        pool,
        "SELECT id, thread_id FROM items WHERE external_id = $1",
        [externalId],
      );
      if (row === undefined) throw new Error(`ingest wrote no row for ${externalId}`);
      archivable.push({ id: row.id, threadId: row.thread_id, reason: planned.reason });
    }
  }

  // The gate is run for real rather than assumed: an item it blocks would make the frame a picture
  // of the guard being skipped.
  for (const item of archivable) {
    const gate = await hardGate(pool, item.id);
    if (gate.blocked) throw new Error(`the gate blocks a fixture item: ${String(gate.reason)}`);
    await autoArchiveLoop.apply(
      stubResult("auto_archive", {
        archive: true,
        reason: item.reason,
        rule_ids: T0_RULE_IDS,
        tier: "T0" as const,
        confidence: 0.95,
        rationale: "The sender is not a human and no question is addressed to me.",
        injection_flags: [],
      }),
      { trigger_kind: "event", item_id: item.id, thread_id: item.threadId, now, payload: {} },
    );
  }

  // A4 §6.4's cost line, read off the real runs this month rather than typed here.
  const { state, mtdUsd } = await currentPolicy(pool, now);
  const capUsd = await getSetting<number>(pool, "cost.cap_usd", 60);
  await nightlyDigestLoop.apply(
    stubResult("digest", {
      headline: "A quiet day: what was worth keeping came back out of the noise",
      one_liner: "Nothing needed you today.",
      confidence: 0.9,
      rationale: "e2e screenshot fixture",
      injection_flags: [],
    }),
    {
      trigger_kind: "cron",
      now,
      payload: { cost: { month_to_date_usd: mtdUsd, cap_usd: capUsd, tier_state: state } },
    },
  );

  const [row] = await query<{ heading: string; body: string; archived: string }>(
    pool,
    `SELECT to_char(for_date, 'FMMonth FMDD') || ' night digest, ' ||
            (metrics->>'archived') || ' archived' AS heading,
            body, metrics->>'archived' AS archived
       FROM digests WHERE kind = 'nightly' ORDER BY for_date DESC LIMIT 1`,
  );
  if (row === undefined) throw new Error("the nightly loop wrote no digest row");

  const body = JSON.parse(row.body) as {
    auto_archived: {
      reason: string;
      count: number;
      samples: { ref: { id: string }; line: string }[];
      undo_token: string;
    }[];
  };
  const archived = Number(row.archived);
  if (body.auto_archived.length !== PLAN.length) {
    throw new Error(
      `the digest wrote ${String(body.auto_archived.length)} groups, the fixture archived ${String(PLAN.length)}`,
    );
  }

  // The token path, asserted against the database rather than against the digest's own copy: the
  // group's token is the one its items carry, which is what makes "Restore all" reach them.
  for (const group of body.auto_archived) {
    const [carrying] = await query<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM items
        WHERE status = 'archived' AND meta->'archived_by'->>'undo_token' = $1
          AND meta->'archived_by'->>'reason' = $2`,
      [group.undo_token, group.reason],
    );
    if (Number(carrying?.n) !== group.count) {
      throw new Error(
        `group "${group.reason}" carries token ${group.undo_token} on ${String(carrying?.n)} items, digest says ${String(group.count)}`,
      );
    }
    if (group.undo_token !== undoTokenFor(digestIdFor(now), group.reason)) {
      throw new Error(
        `group "${group.reason}" has token ${group.undo_token}, not the one its own writer stamps`,
      );
    }
  }

  const firstLine = body.auto_archived[0]?.samples[0]?.line ?? "";
  if (firstLine === "") throw new Error("the first group listed no samples to draw");
  if (archived !== wanted) {
    throw new Error(
      `the digest recorded ${String(archived)} archived, ${String(wanted)} were archived`,
    );
  }

  logger.info(`digest seeded: ${String(archived)} archived in ${String(PLAN.length)} groups`);
  return {
    heading: row.heading,
    groups: body.auto_archived.map((g) => ({
      reason: g.reason,
      count: g.count,
      token: g.undo_token,
    })),
    archived,
    firstLine,
  };
}

/** One frame plus the horizontal-overflow reading. Measured before the shutter, not after: at 1440 and
 *  at 390 anything past the edge is a defect, and a run that fails on it should not leave the frame
 *  behind for someone to commit. */
async function shoot(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(measureOverflow);
  assertNoOverflow(`digest at ${label}px`, overflow);
  console.log(`  digest-${label}.png — ${describeOverflow(overflow)}`);
  await page.screenshot({ path: join(OUT, `digest-${label}.png`) });
}

/** A finished screen: the night's own heading, a category line per reason with its count, the first
 *  category opened onto its samples, and the cost report. Every one of those is asserted before the
 *  frame is taken — a screen still on `data-state="loading"`, or one showing the waiting copy,
 *  photographs just as cleanly. */
async function openDigest(page: Page, expected: Seeded): Promise<void> {
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/?screen=digest`);
  await page.waitForSelector(".digest-screen", { timeout: 60_000 });
  await page.waitForSelector(".digest-screen__group", { timeout: 60_000 });

  const state = await page.getAttribute(".digest-screen", "data-state");
  if (state !== "ready") {
    throw new Error(`the Digest screen is in state "${String(state)}", not "ready"`);
  }
  const title = await page.textContent(".digest-screen__title");
  if (title !== expected.heading) {
    throw new Error(`the heading reads "${String(title)}", expected "${expected.heading}"`);
  }

  const toggle = page.getByRole("button", { name: new RegExp(expected.groups[0]?.reason ?? "") });
  await toggle.click();
  await page.waitForSelector(".digest-screen__sample", { timeout: 30_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    throw new Error("the first category did not stay open after it was clicked");
  }

  // Each category drew its own count, and the opened one drew the digest's own line for its newest
  // item — a count the screen invented would still look right in a frame.
  for (const group of expected.groups) {
    const chip = page
      .locator(".digest-screen__group", { has: page.getByText(group.reason, { exact: true }) })
      .locator(".digest-screen__count");
    const drawn = await chip.first().textContent();
    if (drawn !== String(group.count)) {
      throw new Error(
        `category "${group.reason}" reads "${String(drawn)}", expected "${String(group.count)}"`,
      );
    }
  }
  const lines = await page.locator(".digest-screen__sample-line").allTextContents();
  if (!lines.includes(expected.firstLine)) {
    throw new Error(`no sample reads "${expected.firstLine}": ${JSON.stringify(lines)}`);
  }
  // A5 §3.8's restore controls: one per sample drawn plus one "Restore all" per category line.
  const restoring = await page.getByRole("button", { name: /^Restore/ }).count();
  if (restoring !== lines.length + expected.groups.length) {
    throw new Error(
      `the screen drew ${String(restoring)} restore controls, expected ${String(lines.length + expected.groups.length)}`,
    );
  }
  const cost = await page.textContent(".digest-screen__cost-line");
  if (!/^Monthly cost report: \$\d/.test(cost ?? "")) {
    throw new Error(`the cost line reads "${String(cost)}"`);
  }
}

async function pass(
  browser: Browser,
  label: string,
  size: { width: number; height: number },
  expected: Seeded,
): Promise<void> {
  const page = await browser.newPage({ viewport: size });
  try {
    await openDigest(page, expected);
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

    const expected = await seedDigest(pool);
    console.log(
      `digest written: ${expected.heading} — ${expected.groups.map((g) => `${g.reason}=${String(g.count)}`).join(", ")}`,
    );

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
