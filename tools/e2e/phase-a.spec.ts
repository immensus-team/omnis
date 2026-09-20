// The UI leg of the Phase A end-to-end smoke. The stack was already brought up by tools/e2e/run.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { Pool, one } from "../../packages/db/src/index.js";
import { ingestOneMore } from "./seed.js";

const E2E_DIR = new URL(".", import.meta.url).pathname;
const EVIDENCE = join(E2E_DIR, "evidence");
const SEED = JSON.parse(readFileSync(join(E2E_DIR, ".tmp", "seed.json"), "utf8")) as {
  slackThreadId: string;
  agentThreadId: string;
  approvalId: string;
  itemCount: number;
};

interface Assertion {
  name: string;
  ok: boolean;
  ms: number;
  note?: string;
}
const results: Assertion[] = [];

async function check(name: string, fn: () => Promise<string | undefined>): Promise<void> {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, ...(note ? { note } : {}) });
  } catch (e) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - started,
      note: e instanceof Error ? e.message.split("\n")[0] : String(e),
    });
  }
}

function shot(page: Page, file: string): Promise<Buffer> {
  mkdirSync(EVIDENCE, { recursive: true });
  return page.screenshot({ path: join(EVIDENCE, file), fullPage: false });
}

/** Hub HTTP shares the desktop's 127.0.0.1 boundary — approval state is read through it (contract §5). */
async function hubApprovals(state: string): Promise<{ id: string; state: string }[]> {
  const res = await fetch(`http://127.0.0.1:8787/approvals?state=${state}`);
  return ((await res.json()) as { approvals: { id: string; state: string }[] }).approvals;
}

test.afterAll(() => {
  mkdirSync(join(E2E_DIR, ".tmp"), { recursive: true });
  writeFileSync(join(E2E_DIR, ".tmp", "assertions.json"), JSON.stringify(results, null, 2));
});

test("Phase A seeded smoke", async ({ page }) => {
  await page.goto("/");
  const rows = page.getByRole("option");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  await check(
    "A1 Inbox lists one row per seeded thread (U2: a row is a thread, not an item)",
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      let expectedThreads: number;
      try {
        const { count } = await one<{ count: string }>(
          pool,
          "SELECT count(DISTINCT thread_id) AS count FROM items WHERE status != 'archived'",
        );
        expectedThreads = Number(count);
      } finally {
        await pool.end();
      }
      // Zero's initial sync is incremental — wait until every seeded thread has arrived.
      await expect.poll(() => rows.count(), { timeout: 30_000 }).toBe(expectedThreads);
      return `${expectedThreads} thread rows (item count was ${SEED.itemCount})`;
    },
  );

  // An accessible name alone is satisfied by an empty div (it once was — see the fix(desktop) in an
  // earlier commit). Since US-D02b the channel mark is the official brand PNG rather than a
  // react-icons SVG, so "there is something visible here" is checked as: an <img> child, a non-zero
  // bounding box, and a non-zero naturalWidth — the last one is what fails if the asset 404s, which
  // a bounding box alone would not catch.
  const CHANNEL_LABELS = ["Slack message", "Gmail message", "Google Calendar message"];
  await check("A2 Inbox rows show a visible channel icon for all three channels", async () => {
    for (const label of CHANNEL_LABELS) {
      await expect
        .poll(() => page.getByLabel(label).count(), { timeout: 15_000 })
        .toBeGreaterThan(0);
      const icon = page.getByLabel(label).first();
      await expect(icon).toBeVisible();
      const mark = icon.locator("img");
      await expect(mark).toHaveCount(1);
      const box = await mark.boundingBox();
      if (!box || box.width === 0 || box.height === 0) {
        throw new Error(`${label} brand mark has zero size`);
      }
      const loaded = await mark.evaluate((el) => (el as HTMLImageElement).naturalWidth);
      if (loaded === 0) throw new Error(`${label} brand mark did not load (naturalWidth 0)`);
    }
    return CHANNEL_LABELS.join(" / ");
  });

  // A seeded row's title is the thread title — Phase A never fills author_person_id and Slack has
  // no subject, so without this check A1 passes even when every row reads "(no title)".
  await check("A2b Inbox rows show the seeded thread titles", async () => {
    for (const title of ["#omnis-launch", "omnis launch sync"]) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    }
    return "#omnis-launch / omnis launch sync";
  });

  await check("A3 Inbox rows carry label chips", async () => {
    await expect(page.getByLabel("scope label: work").first()).toBeVisible();
    await expect(page.getByLabel("topic label: launch").first()).toBeVisible();
  });

  // U1/U2 shell chrome: the two fixed elements of the kinso reference (the left channel rail, the
  // top ask/search pill bar) are actually on screen — half of 01-inbox.png's "this looks like
  // kinso" claim is these two.
  await check("A2c kinso shell: channel rail tiles + ask/search bar", async () => {
    const rail = page.getByRole("navigation", { name: "Channels" });
    await expect(rail).toBeVisible();
    for (const tile of ["Inbox", "Slack", "Gmail", "Google Calendar", "Agent"]) {
      await expect(rail.getByRole("button", { name: tile, exact: true })).toBeVisible();
    }
    await expect(page.getByPlaceholder("Start typing to ask or search")).toBeVisible();
    return "rail: Inbox/Slack/Gmail/Google Calendar/Agent + ask bar";
  });

  // Row anatomy (U2): avatar, name, relative time and the one-line AI summary all present in one
  // row. A1/A2/A2b look only at counts, icons and titles, so all three pass with the summary line
  // missing entirely.
  await check("A2d a conversation row has avatar + name + relative time + summary", async () => {
    const row = rows.first();
    await expect(row.locator(".inbox-row__avatar")).toHaveCount(1);
    await expect(row.locator(".inbox-row__name")).not.toBeEmpty();
    const time = (await row.locator(".inbox-row__timestamp").textContent()) ?? "";
    // formatRelativeTime's output grammar: now / 3m / 2w / 4 Aug (never an absolute ISO stamp).
    if (!/^(now|\d+[mhdw]|\d{1,2} [A-Za-z]{3}( \d{4})?)$/.test(time.trim())) {
      throw new Error(`timestamp "${time}" is not a kinso relative time`);
    }
    const summary = (await row.locator(".inbox-row__summary").textContent()) ?? "";
    if (summary.trim().length === 0) throw new Error("row summary line is empty");
    return `time="${time.trim()}" summary="${summary.trim().slice(0, 40)}…"`;
  });
  await shot(page, "01-inbox.png");

  // Since U2 a row is a thread rather than an item, so "work and personal have different counts"
  // no longer holds (the seed has one work thread and one personal thread) — identity is checked
  // instead: the two filters' row sets are disjoint, and both are proper subsets of all.
  await check("A4 work/personal filter pills change the list", async () => {
    const names = async (): Promise<string[]> =>
      (await rows.locator(".inbox-row__name").allTextContents()).map((n) => n.trim()).sort();
    const all = await names();
    await page.getByRole("radio", { name: "work", exact: true }).click();
    await expect.poll(() => rows.count()).toBeLessThan(all.length);
    const work = await names();
    await page.getByRole("radio", { name: "personal", exact: true }).click();
    await expect.poll(async () => (await names()).join("|")).not.toBe(work.join("|"));
    const personal = await names();
    expect(work.length).toBeGreaterThan(0);
    expect(personal.length).toBeGreaterThan(0);
    expect(work.filter((n) => personal.includes(n))).toEqual([]);
    for (const name of [...work, ...personal]) expect(all).toContain(name);
    await page.getByRole("radio", { name: "all", exact: true }).click();
    return `all=${all.length} work=[${work.join(", ")}] personal=[${personal.join(", ")}]`;
  });

  // A rail tile is a filter too (U1: rail selection AND pill filter) — whether one click really
  // narrows the list.
  await check("A4b channel rail tile filters the list, Inbox tile restores it", async () => {
    const all = await rows.count();
    await page
      .getByRole("navigation", { name: "Channels" })
      .getByRole("button", { name: "Gmail" })
      .click();
    await expect.poll(() => rows.count()).toBeLessThan(all);
    const gmail = await rows.count();
    await page
      .getByRole("navigation", { name: "Channels" })
      .getByRole("button", { name: "Inbox" })
      .click();
    await expect.poll(() => rows.count()).toBe(all);
    return `all=${all} gmail=${gmail}`;
  });
  await page.getByRole("radio", { name: "work", exact: true }).click();
  await shot(page, "02-inbox-filter-work.png");
  await page.getByRole("radio", { name: "all", exact: true }).click();

  await check("A5 Thread screen renders seeded items with status badges", async () => {
    // The draft row has sent_at=now(), so it is at the top of the list — clickable without making
    // Virtuoso scroll.
    await rows.filter({ hasText: "Draft:" }).first().click();
    const detail = page.getByTestId("detail-pane");
    await expect(detail.locator(".status-badge").first()).toBeVisible({ timeout: 20_000 });
    const badges = await detail.locator(".status-badge").count();
    expect(badges).toBeGreaterThanOrEqual(2);
    await expect(detail.locator('.status-badge[data-status="draft"]')).toBeVisible();
    return `${badges} status badges`;
  });
  await shot(page, "03-thread.png");

  await check("A6 Agent Session screen shows turns and a ToolCallBadge", async () => {
    await rows.filter({ hasText: "✓ Turn completed" }).first().click();
    const detail = page.getByTestId("detail-pane");
    await expect(detail.locator(".tool-call-badge").first()).toBeVisible({ timeout: 20_000 });
    await expect(detail.locator(".agent-session-screen__turn").first()).toBeVisible();
    await expect(detail.locator(".agent-session-screen__system-log").first()).toBeVisible();
  });
  await shot(page, "04-agent-session.png");

  await check("A7 Approval card shows the pending approval", async () => {
    // US-D03 scopes the pane's approval stack to the open thread, and A6 left an agent session
    // open — a thread of its own, with no approval of its own, so its pane draws no card. That is
    // the shipped behaviour, asserted in approval-stack.test.tsx ("draws nothing for an open
    // thread that has no approval of its own"); this check was written before the scoping and had
    // been waiting on a card the design no longer draws there. The seeded approval lives on the
    // thread it was proposed against, so put that thread back in front of the pane first. The
    // assertion below is unchanged.
    await rows.filter({ hasText: "#omnis-launch" }).first().click();
    await expect(page.locator(".approval-card").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Reply to #omnis-launch?")).toBeVisible();
    const pending = await hubApprovals("pending");
    expect(pending.map((a) => a.id)).toContain(SEED.approvalId);
  });
  // Shooting the same full screen as 04 again would produce a byte-identical PNG (the approval card
  // is up in both frames) — crop to the card itself so the two files hold different information.
  await page
    .locator(".approval-card")
    .first()
    .screenshot({ path: join(EVIDENCE, "05-approval-card.png") });

  await check("A8 Approve → hub moves the approval to decided", async () => {
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await expect
      .poll(async () => (await hubApprovals("decided")).map((a) => a.id), { timeout: 20_000 })
      .toContain(SEED.approvalId);
    return "pending → decided";
  });

  // US-D01: ⌘K opens the ask bar's floating AI panel rather than a separate modal palette (see
  // App.tsx) — we decided not to surface the same action list in two places, so the surface this
  // check watches changed too. The command list appears inside the panel when you type in the bar,
  // not as the modal's "Search or command…".
  await check("A9 ⌘K opens the floating AI panel and types into the command list", async () => {
    await page.keyboard.press("Meta+k");
    const panel = page.getByRole("dialog", { name: "AI panel" });
    await expect(panel).toBeVisible();
    await page.keyboard.type("Inbox");
    await expect(panel.getByText("Go to Inbox")).toBeVisible();
    return "panel + cmdk list reachable by typing";
  });
  await shot(page, "06-command-palette.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "AI panel" })).toBeHidden();

  // US-A36: archiving is a local state transition that does not go through the approval gate — we
  // check both that it vanishes from the UI and that the hub really wrote threads.archived_at +
  // audit_log (watching the UI alone would fall for an optimistic update).
  await check(
    "A-archive archiving a row removes it from the list and restoring brings it back",
    async () => {
      await page.getByRole("radio", { name: "all", exact: true }).click();
      const before = await rows.count();
      const target = rows.first();
      const name = ((await target.locator(".inbox-row__name").textContent()) ?? "").trim();
      await target.hover();
      await target.getByRole("button", { name: "Archive", exact: true }).click();
      await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(before - 1);

      const archivedPill = page.getByRole("button", { name: "Archived", exact: true });
      await archivedPill.click();
      const archivedRow = rows.filter({ hasText: name }).first();
      await expect(archivedRow).toBeVisible({ timeout: 20_000 });
      await shot(page, "08-archived.png");

      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      try {
        const { count } = await one<{ count: string }>(
          pool,
          "SELECT count(*) AS count FROM threads WHERE archived_at IS NOT NULL",
        );
        expect(Number(count)).toBeGreaterThanOrEqual(1);
        await archivedRow.hover();
        await archivedRow.getByRole("button", { name: "Restore", exact: true }).click();
        await archivedPill.click(); // back to the Inbox view
        await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(before);
        const { actions } = await one<{ actions: string }>(
          pool,
          "SELECT string_agg(DISTINCT action, ',' ORDER BY action) AS actions FROM audit_log WHERE action LIKE 'thread.%archived'",
        );
        expect(actions).toBe("thread.archived,thread.unarchived");
      } finally {
        await pool.end();
      }
      return `"${name}" archived → restored (${before} rows), 2 audit_log actions recorded`;
    },
  );

  await check("G5 a new item reaches the UI in ≤2s", async () => {
    await page.getByRole("radio", { name: "all", exact: true }).click();
    const marker = `G5 latency probe ${Date.now()}`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      await ingestOneMore(pool, marker); // the same kernel IngestSink the hub uses
    } finally {
      await pool.end();
    }
    const ingestedAt = Date.now();
    // The marker is a message in the first Slack thread (seed.ts ingestOneMore), which is the thread
    // A7 now leaves open, so the text is in the DOM twice — the row's summary and the pane's message
    // body — and a page-wide getByText is ambiguous. This check is about the inbox list reaching the
    // new item, so it reads the row.
    await expect(rows.filter({ hasText: marker })).toBeVisible({ timeout: 20_000 });
    const ms = Date.now() - ingestedAt;
    expect(ms).toBeLessThanOrEqual(2000);
    return `${ms}ms ingest → on screen (target ≤2000ms)`;
  });
  await shot(page, "07-g5-live-item.png");

  const failed = results.filter((r) => !r.ok);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
});
