// Phase A 종단 스모크의 UI 단. 스택은 tools/e2e/run.ts가 이미 띄워 놓았다.
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

  await check(
    "A1 Inbox lists one row per seeded thread (U2: 행이 item이 아니라 thread 단위)",
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
      // Zero의 초기 싱크는 점진적이다 — 시드가 만든 스레드 수가 다 찰 때까지 기다린다.
      await expect.poll(() => rows.count(), { timeout: 30_000 }).toBe(expectedThreads);
      return `${expectedThreads} thread rows (item count was ${SEED.itemCount})`;
    },
  );

  // 접근성 이름만 보면 빈 div도 통과한다(실제로 그랬다 — 앞 커밋의 fix(desktop) 참고).
  // U2부터 채널 아이콘은 모노그램 텍스트가 아니라 실제 react-icons/si SVG다 — "보이는 무언가가
  // 있다"는 주장은 이제 svg 자식 노드 존재 + non-zero bounding box로 확인한다.
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

  // U1/U2 셸 크롬: kinso 레퍼런스의 두 고정 요소(왼쪽 채널 레일, 상단 ask/search 필바)가
  // 실제로 떠 있는지 본다 — 01-inbox.png가 "kinso처럼 보인다"는 주장의 절반이 이 둘이다.
  await check("A2c kinso shell: channel rail tiles + ask/search bar", async () => {
    const rail = page.getByRole("navigation", { name: "채널" });
    await expect(rail).toBeVisible();
    for (const tile of ["Inbox", "Slack", "Gmail", "Google Calendar", "Agent"]) {
      await expect(rail.getByRole("button", { name: tile, exact: true })).toBeVisible();
    }
    await expect(page.getByPlaceholder("Start typing to ask or search")).toBeVisible();
    return "rail: Inbox/Slack/Gmail/Google Calendar/Agent + ask bar";
  });

  // 행 해부(U2): 아바타 · 이름 · 상대시간 · AI 한 줄 요약이 한 행 안에 다 있는지.
  // A1/A2/A2b는 각각 개수·아이콘·제목만 보므로, 요약 줄이 통째로 빠져도 전부 통과한다.
  await check("A2d a conversation row has avatar + name + relative time + summary", async () => {
    const row = rows.first();
    await expect(row.locator(".inbox-row__avatar")).toHaveCount(1);
    await expect(row.locator(".inbox-row__name")).not.toBeEmpty();
    const time = (await row.locator(".inbox-row__timestamp").textContent()) ?? "";
    // formatRelativeTime의 출력 문법: now / 3m / 2w / 4 Aug (절대 ISO 타임스탬프가 아니다).
    if (!/^(now|\d+[mhdw]|\d{1,2} [A-Za-z]{3}( \d{4})?)$/.test(time.trim())) {
      throw new Error(`timestamp "${time}" is not a kinso relative time`);
    }
    const summary = (await row.locator(".inbox-row__summary").textContent()) ?? "";
    if (summary.trim().length === 0) throw new Error("row summary line is empty");
    return `time="${time.trim()}" summary="${summary.trim().slice(0, 40)}…"`;
  });
  await shot(page, "01-inbox.png");

  // U2부터 행이 item이 아니라 thread 단위라 "work와 personal의 개수가 다르다"는 더 이상
  // 보장되지 않는다(시드는 work 스레드 1개 · personal 스레드 1개다) — 개수 대신 신원을 본다:
  // 두 필터의 행 집합은 겹치지 않고, 둘 다 all의 진부분집합이다.
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

  // 레일 타일도 필터다(U1: 레일 선택 AND pill 필터) — 클릭 한 번이 실제로 목록을 좁히는지.
  await check("A4b channel rail tile filters the list, Inbox tile restores it", async () => {
    const all = await rows.count();
    await page
      .getByRole("navigation", { name: "채널" })
      .getByRole("button", { name: "Gmail" })
      .click();
    await expect.poll(() => rows.count()).toBeLessThan(all);
    const gmail = await rows.count();
    await page
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
    await rows.filter({ hasText: "✓ Turn completed" }).first().click();
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

  // US-A36: 보관은 승인 게이트를 타지 않는 로컬 상태 전이다 — UI에서 사라지는 것과 허브가
  // 실제로 threads.archived_at + audit_log를 쓴 것을 둘 다 본다(UI만 보면 낙관적 갱신에 속는다).
  await check("A-archive 행 보관 → 목록에서 사라지고, 되살리면 돌아온다", async () => {
    await page.getByRole("radio", { name: "all", exact: true }).click();
    const before = await rows.count();
    const target = rows.first();
    const name = ((await target.locator(".inbox-row__name").textContent()) ?? "").trim();
    await target.hover();
    await target.getByRole("button", { name: "보관", exact: true }).click();
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(before - 1);

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
      await archivedRow.getByRole("button", { name: "되살리기", exact: true }).click();
      await archivedPill.click(); // Inbox 뷰로 복귀
      await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(before);
      const { actions } = await one<{ actions: string }>(
        pool,
        "SELECT string_agg(DISTINCT action, ',' ORDER BY action) AS actions FROM audit_log WHERE action LIKE 'thread.%archived'",
      );
      expect(actions).toBe("thread.archived,thread.unarchived");
    } finally {
      await pool.end();
    }
    return `"${name}" archived → restored (${before} rows), audit_log 2종 기록`;
  });

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
