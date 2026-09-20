// Phase A 종단 스모크의 UI 단. 스택은 tools/e2e/run.ts가 이미 띄워 놓았다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { Pool } from "../../packages/db/src/index.js";
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

/** 허브 HTTP는 데스크톱과 같은 127.0.0.1 경계다 — 승인 상태 확인은 여기로 한다(계약 §5). */
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

  await check("A1 Inbox lists every seeded item", async () => {
    // Zero의 초기 싱크는 점진적이다 — 시드가 만든 개수가 다 찰 때까지 기다린다.
    await expect.poll(() => rows.count(), { timeout: 30_000 }).toBe(SEED.itemCount);
    return `${SEED.itemCount} rows`;
  });

  // 접근성 이름만 보면 빈 div도 통과한다(실제로 그랬다 — 앞 커밋의 fix(desktop) 참고).
  // 보이는 글리프 텍스트까지 확인해야 "채널 아이콘이 있다"는 주장이 증거가 된다.
  const CHANNEL_GLYPHS: [string, string][] = [
    ["Slack 메시지", "SL"],
    ["Gmail 메시지", "GM"],
    ["Google Calendar 메시지", "GC"],
  ];
  await check("A2 Inbox rows show a visible channel icon for all three channels", async () => {
    for (const [label, glyph] of CHANNEL_GLYPHS) {
      await expect
        .poll(() => page.getByLabel(label).count(), { timeout: 15_000 })
        .toBeGreaterThan(0);
      const icon = page.getByLabel(label).first();
      await expect(icon).toBeVisible();
      await expect(icon).toHaveText(glyph);
    }
    return CHANNEL_GLYPHS.map(([, g]) => g).join(" / ");
  });

  // 시드 행의 제목은 스레드 제목이다 — Phase A는 author_person_id를 안 채우고 Slack에는
  // subject가 없어서, 이 검증이 없으면 모든 행이 "(제목 없음)"이어도 A1이 통과한다.
  await check("A2b Inbox rows show the seeded thread titles", async () => {
    for (const title of ["#omnis-launch", "omnis launch sync"]) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    }
    return "#omnis-launch / omnis launch sync";
  });

  await check("A3 Inbox rows carry label chips", async () => {
    await expect(page.getByLabel("scope 라벨: work").first()).toBeVisible();
    await expect(page.getByLabel("topic 라벨: launch").first()).toBeVisible();
  });
  await shot(page, "01-inbox.png");

  await check("A4 work/personal filter pills change the list", async () => {
    const all = await rows.count();
    await page.getByRole("radio", { name: "work", exact: true }).click();
    await expect.poll(() => rows.count()).toBeLessThan(all);
    const work = await rows.count();
    await page.getByRole("radio", { name: "personal", exact: true }).click();
    await expect.poll(() => rows.count()).not.toBe(work);
    const personal = await rows.count();
    await page.getByRole("radio", { name: "all", exact: true }).click();
    return `all=${all} work=${work} personal=${personal}`;
  });
  await page.getByRole("radio", { name: "work", exact: true }).click();
  await shot(page, "02-inbox-filter-work.png");
  await page.getByRole("radio", { name: "all", exact: true }).click();

  await check("A5 Thread screen renders seeded items with status badges", async () => {
    // 초안 행은 sent_at=now()라 목록 맨 위에 있다 — Virtuoso 스크롤 없이 바로 누를 수 있다.
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
    await rows.filter({ hasText: "✓ 턴 완료" }).first().click();
    const detail = page.getByTestId("detail-pane");
    await expect(detail.locator(".tool-call-badge").first()).toBeVisible({ timeout: 20_000 });
    await expect(detail.locator(".agent-session-screen__turn").first()).toBeVisible();
    await expect(detail.locator(".agent-session-screen__system-log").first()).toBeVisible();
  });
  await shot(page, "04-agent-session.png");

  await check("A7 Approval card shows the pending approval", async () => {
    await expect(page.locator(".approval-card").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("#omnis-launch에 답장을 보낼까요?")).toBeVisible();
    const pending = await hubApprovals("pending");
    expect(pending.map((a) => a.id)).toContain(SEED.approvalId);
  });
  // 04와 같은 전체 화면을 또 찍으면 바이트까지 같은 PNG가 나온다(승인 카드가 두 프레임에
  // 모두 떠 있다) — 카드 자체만 찍어 서로 다른 정보를 남긴다.
  await page
    .locator(".approval-card")
    .first()
    .screenshot({ path: join(EVIDENCE, "05-approval-card.png") });

  await check("A8 Approve → hub moves the approval to decided", async () => {
    await page.getByRole("button", { name: "승인", exact: true }).first().click();
    await expect
      .poll(async () => (await hubApprovals("decided")).map((a) => a.id), { timeout: 20_000 })
      .toContain(SEED.approvalId);
    return "pending → decided";
  });

  await check("A9 ⌘K opens the command palette", async () => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByPlaceholder("검색 또는 명령…")).toBeVisible();
  });
  await shot(page, "06-command-palette.png");
  await page.keyboard.press("Escape");

  await check("G5 a new item reaches the UI in ≤2s", async () => {
    await page.getByRole("radio", { name: "all", exact: true }).click();
    const marker = `G5 latency probe ${Date.now()}`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      await ingestOneMore(pool, marker); // 허브가 쓰는 것과 같은 커널 IngestSink
    } finally {
      await pool.end();
    }
    const ingestedAt = Date.now();
    await expect(page.getByText(marker)).toBeVisible({ timeout: 20_000 });
    const ms = Date.now() - ingestedAt;
    expect(ms).toBeLessThanOrEqual(2000);
    return `${ms}ms ingest → 화면 (목표 ≤2000ms)`;
  });
  await shot(page, "07-g5-live-item.png");

  const failed = results.filter((r) => !r.ok);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
});
