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
  // 상태당 2건 이상 — 그룹 카운트가 전부 1이면 "밀도 시스템"이 아니라 헤더 네 줄만 보인다.
  const extra: [string, string, string, string][] = [
    [
      "running",
      "인박스 초안 3건 작성",
      "answers:draft",
      "받은 메일 3건 초안을 쓰는 중입니다 (2/3)",
    ],
    ["running", "계약서 diff 요약", "contract:diff", "특약 2개 변경점을 비교하는 중입니다"],
    ["waiting_approval", "청구서 재발행 회신", "billing:reissue", "회신 문구 승인을 기다립니다"],
    ["idle", "주간 리포트 수집", "report:weekly", "다음 실행까지 대기 중입니다"],
    ["idle", "캘린더 충돌 감시", "calendar:watch", "다음 점검까지 대기 중입니다"],
    ["ended", "라벨 규칙 정리", "labels:tidy", "중복 라벨 4개를 병합하고 끝냈습니다"],
    ["ended", "스팸 필터 학습", "spam:train", "오탐 6건을 반영하고 끝냈습니다"],
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

    // 1) needs-approval — the pending count inside the tab pill, the pending-approval rows and
    //    the filter chip bar. It used to be filed as "approvals-density", but this view has
    //    neither status pills nor group headers (view 2 below is the one that has both), so it is
    //    named after the screen: needs-approval.png.
    await page.getByRole("radio", { name: /^needs-approval/ }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, "needs-approval.png") });

    // 2) agents — 상태 그룹 순서(확인 필요 → 작업 중 → 대기 → 완료)
    await page.getByRole("radio", { name: "agents" }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, "agents-density.png") });

    // 3) 필터 칩: 라벨 2개를 실제로 고른 뒤 칩 + 팝오버(✓)를 같이 담는다
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

    // 4) 행 호버 카드 — 요약이 긴 행 위에서 400ms 이상 머문다
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Remove Label filter" }).click();
    await page.waitForTimeout(400);
    const row = page.locator(".inbox-row", { hasText: "#omnis-launch" }).first();
    await row.hover();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: join(OUT, "row-hover-card.png") });

    // 도달 가능한 최소 폭(src-tauri/tauri.conf.json minWidth 1024)에서 레이아웃이 버텨야 한다.
    // 페이지 가로 스크롤만 재는 건 증거가 못 된다: 행 안에서 grid 아이템 둘이 같은 칸을 차지해
    // 겹쳐도 scrollWidth는 그대로 0이다(US-D02 3회차에 실제로 그렇게 통과했다 — 라벨 칩 위에
    // 채널 글리프·승인 점이 겹쳐 그려지는데도 "overflow 0px"였다). 그래서 폭마다 두 가지를 잰다:
    // (1) 페이지 가로 스크롤, (2) 렌더된 모든 행에서 .inbox-row__chips와 .inbox-row__side의
    //     실제 bounding box가 겹치지 않는지.
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(400);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const collisions = await page.evaluate(() => {
        const hits: string[] = [];
        for (const row of document.querySelectorAll(".inbox-row")) {
          const chips = row.querySelector(".inbox-row__chips");
          const side = row.querySelector(".inbox-row__side");
          if (!chips || !side) continue;
          const a = chips.getBoundingClientRect();
          const b = side.getBoundingClientRect();
          // 빈 칩 컨테이너(width 0)는 아무와도 겹칠 수 없다 — 교집합이 양수일 때만 잡는다.
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
        `width ${width}: overflow ${over}px, ${rows}개 행 중 칩/우측슬롯 겹침 ${collisions.length}건`,
      );
      if (over > 0) throw new Error(`가로 스크롤 발생: ${width}px에서 ${over}px`);
      if (collisions.length > 0)
        throw new Error(`행 안에서 칩과 우측 슬롯이 겹침: ${width}px에서 ${collisions.join(", ")}`);
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
