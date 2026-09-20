import { query } from "@omnis/db";
import type { AuthRef, Channel } from "@omnis/protocol";
import type { Pool } from "pg";
import type { Logger } from "../logger.js";
import type { Scheduler } from "../scheduler.js";

export const TOKEN_REFRESH_JOB_NAME = "token_refresh";
export const TOKEN_REFRESH_CRON = "*/30 * * * *"; // 0006 seed와 동일(A3 소유 인프라 잡)
// ponytail: 만료 60분 전 일괄 갱신. 채널별로 실제 만료 여유가 다르면(Slack 토큰 무기한 등)
// 그때 채널별 창으로 세분화한다.
export const TOKEN_REFRESH_WINDOW_MINUTES = 60;

export type TokenRefresher = (auth: AuthRef) => Promise<void>;

export interface TokenRefreshDeps {
  pool: Pool;
  logger: Logger;
  // 이 호스트에 붙어 있는 어댑터가 채널별로 주입한다(허브 부트스트랩 소관, 이 플랜 밖).
  // 없는 채널은 조용히 스킵한다 — 다른 호스트의 local-agent가 그 채널을 담당한다.
  refreshers: Partial<Record<Channel, TokenRefresher>>;
  windowMinutes?: number;
}

interface DueSecretRow {
  channel: string;
  account_external_id: string;
  auth_ref: string;
}

export function registerTokenRefreshJob(scheduler: Scheduler, deps: TokenRefreshDeps): void {
  const windowMinutes = deps.windowMinutes ?? TOKEN_REFRESH_WINDOW_MINUTES;
  scheduler.register(TOKEN_REFRESH_JOB_NAME, TOKEN_REFRESH_CRON, async () => {
    const due = await query<DueSecretRow>(
      deps.pool,
      `SELECT a.channel, a.external_id AS account_external_id, s.auth_ref
         FROM account_secrets s JOIN accounts a ON a.id = s.account_id
        WHERE s.expires_at IS NOT NULL AND s.expires_at < now() + ($1 || ' minutes')::interval`,
      [windowMinutes],
    );
    for (const row of due) {
      const refresher = deps.refreshers[row.channel as Channel];
      if (refresher === undefined) continue;
      try {
        await refresher({
          channel: row.channel as Channel,
          accountExternalId: row.account_external_id,
          keychainService: row.auth_ref,
          keychainAccount: row.account_external_id,
        });
      } catch (e) {
        deps.logger.error("token refresh failed", {
          channel: row.channel,
          account: row.account_external_id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });
}
