import { one, query, tx } from "@omnis/db";
import type { Channel } from "@omnis/protocol";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "./logger.js";

// ponytail: N=3 연속 실패로 고정한다(A1 §1.5는 "5분 지속"을 기준으로 삼지만 이 함수는 폴링
// 호출 횟수 기준 범용 카운터다 — 채널별 폴링 주기가 다 다르므로 시간이 아니라 횟수로 센다).
// 너무 시끄럽거나 너무 둔하면 settings.notify.* 옆에 채널별 설정으로 승격한다(B-D2 kv 패턴).
export const ADAPTER_HEALTH_FAIL_THRESHOLD = 3;

const SYSTEM_ACCOUNT_EXTERNAL_ID = "omnis-system";
const SYSTEM_THREAD_EXTERNAL_ID = "adapter-health";

// ponytail: 프로세스 내 Map이다 — 허브 재시작 시 카운터가 리셋된다. accounts에 새 컬럼을 추가하지
// 않는 것(델타 §6 "accounts는 컬럼 변경 없음")과 맞바꾼 단순화다. 재시작 직후 반짝 재카운트되는
// 정도는 "연속 3회"의 오탐 허용 범위 안에 있다.
const consecutiveFailures = new Map<Channel, number>();

export function resetAdapterHealthCounters(): void {
  consecutiveFailures.clear();
}

export interface NtfyDeps {
  url?: string;
  topic?: string;
  fetchFn?: typeof fetch;
}

/** A6 §8: self-host ntfy, `curl -d "message" <url>/<topic>` 한 줄. url 미설정이면 조용히
 *  스킵한다 — 미니 기동 초기엔 ntfy가 아직 없을 수 있고, 시스템 Item 쪽 이중 노출은 항상 돈다. */
export async function sendNtfy(deps: NtfyDeps, message: string): Promise<void> {
  if (deps.url === undefined) return;
  const fetchFn = deps.fetchFn ?? fetch;
  await fetchFn(`${deps.url.replace(/\/$/, "")}/${deps.topic ?? "omnis-warning"}`, {
    method: "POST",
    body: message,
  });
}

async function ensureSystemThread(c: PoolClient): Promise<{ accountId: string; threadId: string }> {
  const account = await one<{ id: string }>(
    c,
    `INSERT INTO accounts (channel, external_id, display, state)
       VALUES ('system', $1, 'omnis system', 'active')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
       RETURNING id`,
    [SYSTEM_ACCOUNT_EXTERNAL_ID],
  );
  const thread = await one<{ id: string }>(
    c,
    `INSERT INTO threads (account_id, external_id, kind, title)
       VALUES ($1, $2, 'system', '어댑터 상태')
       ON CONFLICT (account_id, external_id) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
    [account.id, SYSTEM_THREAD_EXTERNAL_ID],
  );
  return { accountId: account.id, threadId: thread.id };
}

export interface AdapterHealthDeps {
  pool: Pool;
  logger: Logger;
  ntfy?: NtfyDeps;
}

/** A1 §1.5 + A6 §8 원칙의 범용 구현. ok=false를 연속 ADAPTER_HEALTH_FAIL_THRESHOLD회 받으면
 *  accounts.state='broken' + items(kind='system') + ntfy 이중 노출(A6 §8). ok=true는 카운터를
 *  리셋하고 broken이었던 계정을 active로 되돌린다. */
export async function recordAdapterHealth(
  deps: AdapterHealthDeps,
  channel: Channel,
  ok: boolean,
  error?: string,
): Promise<void> {
  const { pool, logger } = deps;
  if (ok) {
    consecutiveFailures.set(channel, 0);
    await query(
      pool,
      `UPDATE accounts SET state = 'active', last_health_at = now(), last_error = NULL
        WHERE channel = $1 AND state = 'broken'`,
      [channel],
    );
    return;
  }

  const n = (consecutiveFailures.get(channel) ?? 0) + 1;
  consecutiveFailures.set(channel, n);
  await query(
    pool,
    "UPDATE accounts SET last_health_at = now(), last_error = $2 WHERE channel = $1",
    [channel, error ?? null],
  );
  if (n < ADAPTER_HEALTH_FAIL_THRESHOLD) return;

  const message = `${channel} 어댑터 연결 끊김 (${n}회 연속 실패): ${error ?? "unknown"}`;
  await tx(pool, async (c) => {
    await query(c, `UPDATE accounts SET state = 'broken', last_error = $2 WHERE channel = $1`, [
      channel,
      error ?? null,
    ]);
    const { accountId, threadId } = await ensureSystemThread(c);
    await query(
      c,
      `INSERT INTO items (thread_id, account_id, kind, body, sent_at) VALUES ($1, $2, 'system', $3, now())`,
      [threadId, accountId, message],
    );
  });
  logger.error("adapter health threshold exceeded", { channel, consecutive: n, error });
  await sendNtfy(deps.ntfy ?? {}, `[omnis] ${message}`);
}
