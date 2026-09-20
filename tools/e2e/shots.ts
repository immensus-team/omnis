// Capture script for docs/design/screens/*.png. It brings up the same e2e stack, adds "density"
// on top of seed.ts (several needs-approval items + all four agent session states) and shoots with
// Playwright. It is committed: design screenshots have to be retaken every round, and what was on
// the screen at the time is as much evidence as the picture — which fixture produced that density
// is written down only in densify().
// Run: pnpm tsx tools/e2e/shots.ts (same ports as the e2e smoke — never run both at once).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { Pool, one, query } from "../../packages/db/src/index.js";
import { createKernel, createLogger } from "../../packages/kernel/src/index.js";
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

const OUT = join(REPO_ROOT, "docs/design/screens");
const logger = createLogger("@omnis/shots");

async function densify(pool: Pool): Promise<void> {
  const kernel = createKernel({ pool, logger });
  try {
    // Several needs-approval items, all through the kernel's real propose path.
    const threads = await query<{ id: string; title: string | null }>(
      pool,
      "SELECT id, title FROM threads WHERE kind <> 'agent_session' ORDER BY created_at",
    );
    const asks = [
      "Share the latest Brightstone purchase agreement?",
      "Put the Friday 14:00 design review on the calendar?",
      "Answer the invoice reissue request with 'I will check and get back to you'?",
    ];
    for (const [i, t] of threads.entries()) {
      const description = asks[i % asks.length] ?? asks[0] ?? "";
      await kernel.approvals.propose({
        action: "send",
        args: { channel: "slack", body: description },
        description,
        config: { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true },
        risk: "normal",
        thread_id: t.id,
      });
    }
  } finally {
    await kernel.close();
  }

  // The four agent session states — add three more on top of the one session the seed created (screenshot fixture).
  const runtime = await one<{ id: string }>(pool, "SELECT id FROM agent_runtimes LIMIT 1");
  const account = await one<{ id: string }>(
    pool,
    "SELECT id FROM accounts WHERE channel = 'slack' LIMIT 1",
  );
  // At least two per state — with every group count at 1 you get four bare headers, not a "density system".
  const extra: [string, string, string, string][] = [
    [
      "running",
      "Drafting 3 inbox replies",
      "answers:draft",
      "Writing drafts for 3 received mails (2/3)",
    ],
    ["running", "Summarizing contract diff", "contract:diff", "Comparing 2 changed special terms"],
    [
      "waiting_approval",
      "Invoice reissue reply",
      "billing:reissue",
      "Waiting for approval of the reply wording",
    ],
    ["idle", "Weekly report collection", "report:weekly", "Waiting for the next run"],
    ["idle", "Calendar conflict watch", "calendar:watch", "Waiting for the next check"],
    ["ended", "Label rule cleanup", "labels:tidy", "Finished merging 4 duplicate labels"],
    ["ended", "Spam filter training", "spam:train", "Finished folding in 6 false positives"],
  ];
  for (const [state, title, key, summary] of extra) {
    const thread = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind, title, scope, unread_count, last_item_at)
         VALUES ($1, $2, 'agent_session', $3, 'work', 0, now()) RETURNING id`,
      [account.id, `shots-${key}`, title],
    );
    await query(
      pool,
      `INSERT INTO agent_sessions (runtime_id, thread_id, session_key, state, started_at, last_turn_at)
         VALUES ($1, $2, $3, $4, now(), now())`,
      [runtime.id, thread.id, `agent:claude_code:macbook:${key}`, state],
    );
    await query(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, status, scope, body, sent_at)
         VALUES ($1, $2, 'message', 'received', 'work', $3, now())`,
      [thread.id, account.id, summary],
    );
  }
  // Raise the seed session to waiting_approval so the blocked group lands at the top.
  await query(
    pool,
    "UPDATE agent_sessions SET state = 'waiting_approval' WHERE session_key LIKE '%inbox-draft'",
  );
  // Make the hover card actually carry what the row truncated: a long summary + more labels than two chips hold.
  await query(
    pool,
    `UPDATE threads SET meta = jsonb_set(meta, '{summary}', to_jsonb($1::text)), unread_count = 2
       WHERE kind IN ('dm', 'group')`,
    [
      "A request to share the latest Brightstone Realty purchase agreement. Two lines of special terms changed since last week's reviewed copy, and they need a reply by Friday morning.",
    ],
  );
  await query(
    pool,
    `INSERT INTO labels (name, kind, color) VALUES ('contract', 'topic', '#f59e0b')
       ON CONFLICT (kind, name) DO NOTHING`,
  );
  await query(
    pool,
    `INSERT INTO thread_labels (thread_id, label_id, by)
       SELECT t.id, l.id, 'rule' FROM threads t, labels l
        WHERE l.name = 'contract' AND t.kind IN ('dm', 'group')
        ON CONFLICT DO NOTHING`,
  );

  // Attach a few more labels so the label chip filter has something real to work with.
  await query(
    pool,
    `INSERT INTO thread_labels (thread_id, label_id, by)
       SELECT t.id, l.id, 'rule' FROM threads t, labels l
        WHERE l.name = 'launch' AND t.kind = 'email'
        ON CONFLICT DO NOTHING`,
  );
}

async function main(): Promise<void> {
  const env = loadOrCreateEnv();
  assertPortsFree();
  await resetDatabase(env);
  deployZeroPermissions(env);
  startZeroCache(env);
  await waitForHttp(`http://127.0.0.1:${ZERO_PORT}/`, 90_000);
  startHub(env);
  await waitForHttp(`http://127.0.0.1:${HUB_PORT}/health`, 60_000);
  startDesktop();
  await waitForHttp(`http://127.0.0.1:${VITE_PORT}/`, 90_000);

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  let closeBridge: (() => void) | undefined;
  try {
    const seeded = await seed(pool, env);
    closeBridge = seeded.closeBridge;
    await densify(pool);

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`http://127.0.0.1:${VITE_PORT}/`);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await page.waitForTimeout(2500);

    // 1) needs-approval — the pending count inside the tab pill, the pending-approval rows and
    //    the filter chip bar. It used to be filed as "approvals-density", but this view has
    //    neither status pills nor group headers (view 2 below is the one that has both), so it is
    //    named after the screen: needs-approval.png.
    await page.getByRole("radio", { name: /^needs-approval/ }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, "needs-approval.png") });

    // 2) agents — state group order (blocked → working → idle → done)
    await page.getByRole("radio", { name: "agents" }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, "agents-density.png") });

    // 3) Filter chips: actually pick two labels, then frame the chips and the popover (✓) together
    await page.getByRole("radio", { name: "all" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Add Label filter" }).click();
    await page.waitForTimeout(300);
    const dialog = page.getByRole("dialog");
    const options = dialog.getByRole("option");
    const n = await options.count();
    for (let i = 0; i < Math.min(2, n); i++) {
      await options.nth(i).click();
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, "filter-chips.png") });

    // 4) Row hover card — rest on the row with the long summary for more than 400ms
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Remove Label filter" }).click();
    await page.waitForTimeout(400);
    const row = page.locator(".inbox-row", { hasText: "#omnis-launch" }).first();
    await row.hover();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: join(OUT, "row-hover-card.png") });

    // The layout has to hold at the narrowest reachable width (src-tauri/tauri.conf.json minWidth
    // 1024). Page-level horizontal scroll alone is not evidence: two grid items inside a row can
    // share the same track and overlap while scrollWidth stays 0 (that is exactly how round three of
    // US-D02 passed — the channel glyph and approval dot were painted over the label chips and it
    // still read "overflow 0px"). So every width is measured three ways: the shared overflow probe
    // (page scroll off <body> + an element-rect scan, tools/e2e/overflow.ts), and whether
    // .inbox-row__chips and .inbox-row__side bounding boxes overlap in any rendered row — the
    // overlap is the one inside a clipped box that neither scroll reading can see.
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(measureOverflow);
      const collisions = await page.evaluate(() => {
        const hits: string[] = [];
        for (const row of document.querySelectorAll(".inbox-row")) {
          const chips = row.querySelector(".inbox-row__chips");
          const side = row.querySelector(".inbox-row__side");
          if (!chips || !side) continue;
          const a = chips.getBoundingClientRect();
          const b = side.getBoundingClientRect();
          // An empty chip container (width 0) cannot overlap anything — only a positive intersection counts.
          const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (dx > 0 && dy > 0) {
            const name = row.querySelector(".inbox-row__name")?.textContent ?? "?";
            hits.push(`${name} (${dx.toFixed(1)}x${dy.toFixed(1)}px)`);
          }
        }
        return hits;
      });
      const rows = await page.locator(".inbox-row").count();
      console.log(
        `width ${width}: ${describeOverflow(overflow)}, chip/side-slot overlap in ${collisions.length} of ${rows} rows`,
      );
      assertNoOverflow(`${width}px`, overflow);
      if (collisions.length > 0)
        throw new Error(
          `chips overlap the side slot inside a row at ${width}px: ${collisions.join(", ")}`,
        );
    }

    await browser.close();
    console.log("shots written to", OUT);
  } finally {
    closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
