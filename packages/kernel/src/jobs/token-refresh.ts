import { query } from "@omnis/db";
import type { AuthRef, Channel } from "@omnis/protocol";
import type { Pool } from "pg";
import type { Logger } from "../logger.js";
import type { Scheduler } from "../scheduler.js";

export const TOKEN_REFRESH_JOB_NAME = "token_refresh";
export const TOKEN_REFRESH_CRON = "*/30 * * * *"; // 0006 seed (A3-owned infra job)
// ponytail: refresh everything 60 minutes before expiry. If channels turn out to need different
// expiry slack (Slack tokens never expire, etc.), split into per-channel windows then.
export const TOKEN_REFRESH_WINDOW_MINUTES = 60;

export type TokenRefresher = (auth: AuthRef) => Promise<void>;

export interface TokenRefreshDeps {
  pool: Pool;
  logger: Logger;
  // Adapters attached to this host inject these per channel (hub bootstrap, outside this plan).
  // Channels with no entry are skipped silently — a local-agent on another host owns that channel.
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
