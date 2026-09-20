// The UI half of the Phase A end-to-end smoke. tools/e2e/run.ts has already brought the stack up.
//
// NOTE ON KOREAN STRINGS BELOW (glossed exception): Playwright locators here match text the app
// actually renders, and the desktop UI is still Korean because packages/ui/src/i18n/ko.ts is the
// active locale. Each such locator is marked `// ui-copy: still Korean in packages/ui`. They must
// move together with the UI-shard translation, never before it, or this smoke breaks silently.
// Everything else in this file — check names, notes, seed-derived text — is English.
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

/** Hub HTTP sits on the same 127.0.0.1 boundary as the desktop app — approval state is read here (contract §5). */
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
    "A1 Inbox lists one row per seeded thread (U2: rows are per thread, not per item)",
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
      // Zero's initial sync is incremental — wait until the seeded thread count is fully replicated.
      await expect.poll(() => rows.count(), { timeout: 30_000 }).toBe(expectedThreads);
      return `${expectedThreads} thread rows (item count was ${SEED.itemCount})`;
    },
  );

  // Checking the accessible name alone lets an empty div pass (that actually happened — see the
  // fix(desktop) commit). Since U2 the channel icons are real react-icons/si SVGs rather than
  // monogram text, so "there is something visible" is now confirmed by an svg child node plus a
  // non-zero bounding box.
  // ui-copy: still Korean in packages/ui (channel icon aria-labels).
  const CHANNEL_LABELS = ["Slack 메시지", "Gmail 메시지", "Google Calendar 메시지"];
  await check("A2 Inbox rows show a visible channel icon for all three channels", async () => {
    for (const label of CHANNEL_LABELS) {
      await expect
        .poll(() => page.getByLabel(label).count(), { timeout: 15_000 })
        .toBeGreaterThan(0);
      const icon = page.getByLabel(label).first();
      await expect(icon).toBeVisible();
      const svg = icon.locator("svg");
      await expect(svg).toHaveCount(1);
      const box = await svg.boundingBox();
      if (!box || box.width === 0 || box.height === 0) {
        throw new Error(`${label} icon svg has zero size`);
      }
    }
    return CHANNEL_LABELS.join(" / ");
  });

  // A seeded row's title is the thread title — Phase A leaves author_person_id unfilled and Slack
  // has no subject, so without this check A1 would still pass when every row reads "(no title)".
  await check("A2b Inbox rows show the seeded thread titles", async () => {
    for (const title of ["#omnis-launch", "omnis launch sync"]) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    }
    return "#omnis-launch / omnis launch sync";
  });

  await check("A3 Inbox rows carry label chips", async () => {
    // ui-copy: still Korean in packages/ui (label chip aria-labels).
    await expect(page.getByLabel("scope 라벨: work").first()).toBeVisible();
    await expect(page.getByLabel("topic 라벨: launch").first()).toBeVisible();
  });

  // U1/U2 shell chrome: confirm the two fixed elements of the kinso reference (the left channel
  // rail and the top ask/search bar) are really rendered — they are half of what the
  // "looks like kinso" claim in 01-inbox.png rests on.
  await check("A2c kinso shell: channel rail tiles + ask/search bar", async () => {
    // ui-copy: still Korean in packages/ui (channel rail nav aria-label).
    const rail = page.getByRole("navigation", { name: "채널" });
    await expect(rail).toBeVisible();
    for (const tile of ["Inbox", "Slack", "Gmail", "Google Calendar", "Agent"]) {
      await expect(rail.getByRole("button", { name: tile, exact: true })).toBeVisible();
    }
    await expect(page.getByPlaceholder("Start typing to ask or search")).toBeVisible();
    return "rail: Inbox/Slack/Gmail/Google Calendar/Agent + ask bar";
  });

  // Row anatomy (U2): whether avatar, name, relative time and the AI one-line summary are all
  // present in a single row. A1/A2/A2b only check count, icons and title respectively, so they
  // would all still pass with the summary line missing entirely.
  await check("A2d a conversation row has avatar + name + relative time + summary", async () => {
    const row = rows.first();
    await expect(row.locator(".inbox-row__avatar")).toHaveCount(1);
    await expect(row.locator(".inbox-row__name")).not.toBeEmpty();
    const time = (await row.locator(".inbox-row__timestamp").textContent()) ?? "";
    // The output grammar of formatRelativeTime: now / 3m / 2w / 4 Aug (never an absolute ISO timestamp).
    if (!/^(now|\d+[mhdw]|\d{1,2} [A-Za-z]{3}( \d{4})?)$/.test(time.trim())) {
      throw new Error(`timestamp "${time}" is not a kinso relative time`);
    }
    const summary = (await row.locator(".inbox-row__summary").textContent()) ?? "";
    if (summary.trim().length === 0) throw new Error("row summary line is empty");
    return `time="${time.trim()}" summary="${summary.trim().slice(0, 40)}…"`;
  });
  await shot(page, "01-inbox.png");

  // Since U2 rows are per thread rather than per item, "work and personal have different counts"
  // is no longer guaranteed (the seed has one work thread and one personal thread) — so check
  // identity instead of counts: the two filters' row sets do not overlap and both are proper
  // subsets of all.
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

  // The rail tiles are filters too (U1: rail selection AND pill filter) — check that one click actually narrows the list.
  await check("A4b channel rail tile filters the list, Inbox tile restores it", async () => {
    const all = await rows.count();
    await page
      // ui-copy: still Korean in packages/ui (channel rail nav aria-label).
      .getByRole("navigation", { name: "채널" })
      .getByRole("button", { name: "Gmail" })
      .click();
    await expect.poll(() => rows.count()).toBeLessThan(all);
    const gmail = await rows.count();
    await page
      // ui-copy: still Korean in packages/ui (channel rail nav aria-label).
      .getByRole("navigation", { name: "채널" })
      .getByRole("button", { name: "Inbox" })
      .click();
    await expect.poll(() => rows.count()).toBe(all);
    return `all=${all} gmail=${gmail}`;
  });
  await page.getByRole("radio", { name: "work", exact: true }).click();
  await shot(page, "02-inbox-filter-work.png");
  await page.getByRole("radio", { name: "all", exact: true }).click();

  await check("A5 Thread screen renders seeded items with status badges", async () => {
    // The draft row has sent_at=now(), so it sits at the top of the list — clickable without
    // scrolling Virtuoso.
    // ui-copy: "초안:" prefix is still Korean in packages/ui (i18n draftPrefix).
    await rows.filter({ hasText: "초안:" }).first().click();
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
    await expect(page.locator(".approval-card").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Reply to #omnis-launch?")).toBeVisible();
    const pending = await hubApprovals("pending");
    expect(pending.map((a) => a.id)).toContain(SEED.approvalId);
  });
  // Taking the same full screen as 04 again would produce a byte-identical PNG (the approval card
  // shows in both frames) — shoot just the card so the two images carry different information.
  await page
    .locator(".approval-card")
    .first()
    .screenshot({ path: join(EVIDENCE, "05-approval-card.png") });

  await check("A8 Approve → hub moves the approval to decided", async () => {
    // ui-copy: the approve button label is still Korean in packages/ui.
    await page.getByRole("button", { name: "승인", exact: true }).first().click();
    await expect
      .poll(async () => (await hubApprovals("decided")).map((a) => a.id), { timeout: 20_000 })
      .toContain(SEED.approvalId);
    return "pending → decided";
  });

  await check("A9 ⌘K opens the command palette", async () => {
    await page.keyboard.press("Meta+k");
    // ui-copy: the palette placeholder is still Korean in packages/ui.
    await expect(page.getByPlaceholder("검색 또는 명령…")).toBeVisible();
  });
  await shot(page, "06-command-palette.png");
  await page.keyboard.press("Escape");

  // US-A36: archiving is a local state transition that does not go through an approval gate —
  // check both that it disappears from the UI and that the hub really wrote threads.archived_at +
  // audit_log (watching the UI alone would be fooled by an optimistic update).
  await check(
    "A-archive archive a row → it leaves the list and returns when restored",
    async () => {
      await page.getByRole("radio", { name: "all", exact: true }).click();
      const before = await rows.count();
      const target = rows.first();
      const name = ((await target.locator(".inbox-row__name").textContent()) ?? "").trim();
      await target.hover();
      // ui-copy: the archive button label is still Korean in packages/ui.
      await target.getByRole("button", { name: "보관", exact: true }).click();
      await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(before - 1);

      // ui-copy: the archived pill label is still Korean in packages/ui.
      const archivedPill = page.getByRole("button", { name: "보관됨", exact: true });
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
        // ui-copy: the restore button label is still Korean in packages/ui.
        await archivedRow.getByRole("button", { name: "되살리기", exact: true }).click();
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
    await expect(page.getByText(marker)).toBeVisible({ timeout: 20_000 });
    const ms = Date.now() - ingestedAt;
    expect(ms).toBeLessThanOrEqual(2000);
    return `${ms}ms ingest → screen (target ≤2000ms)`;
  });
  await shot(page, "07-g5-live-item.png");

  const failed = results.filter((r) => !r.ok);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
});
