// US-D02 스크린샷 캡처용 1회성 스크립트(커밋하지 않는다). e2e 스택을 그대로 올리고
// seed.ts 위에 "밀도"를 더한 뒤(승인 대기 여러 건 + 에이전트 세션 4상태) Playwright로 찍는다.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { Pool, one, query } from "../../packages/db/src/index.js";
import { createKernel, createLogger } from "../../packages/kernel/src/index.js";
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
    // 승인 대기 여러 건 — 전부 커널의 실제 propose 경로.
    const threads = await query<{ id: string; title: string | null }>(
      pool,
      "SELECT id, title FROM threads WHERE kind <> 'agent_session' ORDER BY created_at",
    );
    const asks = [
      "브라이트스톤 매매계약서 최신본을 공유할까요?",
      "금요일 14:00 디자인 리뷰를 캘린더에 넣을까요?",
      "청구서 재발행 요청에 '확인 후 회신드리겠습니다'로 답할까요?",
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

  // 에이전트 세션 4상태 — 시드가 만든 세션 하나 말고 세 개를 더 얹는다(스크린샷 픽스처).
  const runtime = await one<{ id: string }>(pool, "SELECT id FROM agent_runtimes LIMIT 1");
  const account = await one<{ id: string }>(
    pool,
    "SELECT id FROM accounts WHERE channel = 'slack' LIMIT 1",
  );
  const extra: [string, string, string, string][] = [
    [
      "running",
      "인박스 초안 3건 작성",
      "answers:draft",
      "받은 메일 3건 초안을 쓰는 중입니다 (2/3)",
    ],
    ["idle", "주간 리포트 수집", "report:weekly", "다음 실행까지 대기 중입니다"],
    ["ended", "라벨 규칙 정리", "labels:tidy", "중복 라벨 4개를 병합하고 끝냈습니다"],
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
  // 시드 세션은 "확인 필요"(waiting_approval)로 올려 blocked 그룹을 맨 위에 만든다.
  await query(
    pool,
    "UPDATE agent_sessions SET state = 'waiting_approval' WHERE session_key LIKE '%inbox-draft'",
  );
  // 호버 카드가 "행이 잘라 낸 것"을 실제로 갖도록: 긴 요약 + 칩 2개로 안 담기는 라벨 수.
  await query(
    pool,
    `UPDATE threads SET meta = jsonb_set(meta, '{summary}', to_jsonb($1::text)), unread_count = 2
       WHERE kind IN ('dm', 'group')`,
    [
      "브라이트스톤 리얼티 매매계약서 최신본을 공유해 달라는 요청입니다. 지난주 검토본 이후 특약 두 줄이 바뀌었고, 금요일 오전까지 회신이 필요하다고 합니다.",
    ],
  );
  await query(
    pool,
    `INSERT INTO labels (name, kind, color) VALUES ('계약', 'topic', '#f59e0b')
       ON CONFLICT (kind, name) DO NOTHING`,
  );
  await query(
    pool,
    `INSERT INTO thread_labels (thread_id, label_id, by)
       SELECT t.id, l.id, 'rule' FROM threads t, labels l
        WHERE l.name = '계약' AND t.kind IN ('dm', 'group')
        ON CONFLICT DO NOTHING`,
  );

  // 라벨 칩 필터를 실제로 쓸 수 있게 라벨을 몇 개 더 붙인다.
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

    // 1) needs-approval — 대기 그룹 헤더 + 승인 대기 행들 + 필터 칩 바
    await page.getByRole("radio", { name: "needs-approval" }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, "approvals-density.png") });

    // 2) agents — 상태 그룹 순서(확인 필요 → 작업 중 → 대기 → 완료)
    await page.getByRole("radio", { name: "agents" }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, "agents-density.png") });

    // 3) 필터 칩: 라벨 2개를 실제로 고른 뒤 칩 + 팝오버(✓)를 같이 담는다
    await page.getByRole("radio", { name: "all" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "+ 라벨" }).click();
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

    // 4) 행 호버 카드 — 요약이 긴 행 위에서 400ms 이상 머문다
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "라벨 필터 제거" }).click();
    await page.waitForTimeout(400);
    const row = page.locator(".inbox-row", { hasText: "#omnis-launch" }).first();
    await row.hover();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: join(OUT, "row-hover-card.png") });

    await browser.close();
    console.log("shots written to", OUT);
  } finally {
    closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
