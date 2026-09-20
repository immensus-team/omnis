import { one, query, tx } from "@omnis/db";
import type { AdapterEvent, IngestSink, NormalizedItem } from "@omnis/protocol";
import type { Pool } from "pg";
import type { Logger } from "./logger.js";

function isItem(e: NormalizedItem | AdapterEvent): e is NormalizedItem {
  return "threadExternalId" in e;
}

/** 어댑터가 밀어넣는 유일한 입구(계약 §3.3 IngestSink).
 *  Phase A는 thread/item upsert까지만 한다 — person 신원 해석(A3 §10)은 Phase A 스토리가 아니므로
 *  author_person_id를 채우지 않는다. 어댑터가 person author를 줘도 NULL로 남는다. */
export function createIngestSink(deps: { pool: Pool; logger: Logger }): IngestSink {
  const { pool, logger } = deps;
  return async (accountId, e) => {
    if (!isItem(e)) {
      await query(
        pool,
        `INSERT INTO events (kind, actor, target_table, target_id, payload)
         VALUES ($1, 'system', 'accounts', $2, $3::jsonb)`,
        [`adapter.${e.kind}`, accountId, JSON.stringify(e)],
      );
      return;
    }

    await tx(pool, async (c) => {
      let threadId: string;
      if (e.threadMeta !== undefined) {
        const m = e.threadMeta;
        const row = await one<{ id: string }>(
          c,
          `INSERT INTO threads (account_id, external_id, kind, title, last_item_at, archived_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account_id, external_id) DO UPDATE
               SET title = EXCLUDED.title,
                   last_item_at = GREATEST(threads.last_item_at, EXCLUDED.last_item_at),
                   archived_at = EXCLUDED.archived_at
             RETURNING id`,
          [accountId, m.externalId, m.kind, m.title, m.lastItemAt, m.archivedAt],
        );
        threadId = row.id;
      } else {
        const rows = await query<{ id: string }>(
          c,
          `SELECT id FROM threads WHERE account_id = $1 AND external_id = $2`,
          [accountId, e.threadExternalId],
        );
        const row = rows[0];
        if (row === undefined) {
          throw new Error(
            `unknown thread ${e.threadExternalId} for account ${accountId}: adapter must send threadMeta on first sight`,
          );
        }
        threadId = row.id;
      }

      // author_agent_id만 해석한다. person은 Phase B(A3 §10).
      const agentId =
        e.author.kind === "agent"
          ? ((
              await query<{ id: string }>(c, `SELECT id FROM agent_runtimes WHERE id = $1`, [
                e.author.id,
              ])
            )[0]?.id ?? null)
          : null;

      await query(
        c,
        `INSERT INTO items (thread_id, account_id, external_id, kind, status, author_agent_id,
                            subject, body, body_html, attachments, sent_at, source_hash)
           VALUES ($1,$2,$3,$4,'received',$5,$6,$7,$8,$9::jsonb,$10,$11)
           ON CONFLICT (account_id, source_hash) WHERE source_hash IS NOT NULL DO NOTHING`,
        [
          threadId,
          accountId,
          e.externalId,
          e.kind,
          agentId,
          null,
          e.body,
          e.bodyHtml ?? null,
          JSON.stringify(e.attachments),
          e.sentAt,
          e.sourceHash,
        ],
      );

      await query(
        c,
        `UPDATE threads SET last_item_at = GREATEST(COALESCE(last_item_at, $2::timestamptz), $2::timestamptz)
          WHERE id = $1`,
        [threadId, e.sentAt],
      );
    });
    logger.debug("ingested", { accountId, externalId: e.externalId });
  };
}
