import { one, query, tx } from "@omnis/db";
import type { PoolClient } from "@omnis/db";
import type {
  AdapterEvent,
  Channel,
  IngestSink,
  NormalizedItem,
  NormalizedThread,
  ThreadKind,
} from "@omnis/protocol";
import type { Pool } from "pg";
import { resolvePerson } from "./identity.js";
import type { Logger } from "./logger.js";

function isItem(e: NormalizedItem | AdapterEvent): e is NormalizedItem {
  return "threadExternalId" in e;
}

const ITEM_KIND_TO_THREAD_KIND: Record<NormalizedItem["kind"], ThreadKind> = {
  message: "group",
  email: "email",
  event: "calendar",
  agent_turn: "agent_session",
  tool_call: "agent_session",
  system: "system",
};

/** accounts.channel is immutable per account. Do not look it up for every message. */
async function channelOf(
  c: PoolClient,
  cache: Map<string, Channel>,
  accountId: string,
): Promise<Channel> {
  const hit = cache.get(accountId);
  if (hit !== undefined) return hit;
  const row = await one<{ channel: Channel }>(c, "SELECT channel FROM accounts WHERE id = $1", [
    accountId,
  ]);
  cache.set(accountId, row.channel);
  return row.channel;
}

/** Last resort for when an adapter sends the first item without threadMeta (root fix; this used to
 *  throw). Synthesizes the thread from what the item itself carries. NormalizedItem has neither a
 *  subject nor a channel name, so the title comes from the participants (= the author). If the
 *  adapter fills in threadMeta in normalize(), this function is never called at all. */
function deriveThreadMeta(e: NormalizedItem): NormalizedThread {
  // threads.participants (uuid[] of persons.id) is unused in Phase A (A3 §10) — the value here
  // feeds title synthesis, and becomes a persistence target in Phase B when identity resolution
  // lands.
  const participants =
    e.author.kind === "person" ? [{ externalId: e.author.id, displayName: e.author.id }] : [];
  return {
    externalId: e.threadExternalId,
    kind: ITEM_KIND_TO_THREAD_KIND[e.kind],
    title: participants.map((p) => p.displayName).join(", ") || null,
    participants,
    lastItemAt: e.sentAt,
    archivedAt: null,
  };
}

/** An incoming item never "overwrites" the thread. Adapters now attach threadMeta to every item,
 *  so this UPDATE runs for every single message — an unconditional assignment would break the
 *  following:
 *  - title: the first item that knows a title decides it. A trailing reply title ("Re: ...") must
 *    not rename the thread, and a null-subject message must not erase the name. The real rename
 *    paths (conversations.info sync, etc.) UPDATE explicitly in Phase B.
 *  - archived_at: one new message must not silently revive a thread the user archived. It is set
 *    only when the adapter claims archival (gcal cancelled), and null means "unknown", not
 *    "unarchived". */
async function upsertThread(
  c: PoolClient,
  accountId: string,
  m: NormalizedThread,
): Promise<string> {
  const row = await one<{ id: string }>(
    c,
    `INSERT INTO threads (account_id, external_id, kind, title, last_item_at, archived_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, external_id) DO UPDATE
         SET title = COALESCE(threads.title, EXCLUDED.title),
             last_item_at = GREATEST(threads.last_item_at, EXCLUDED.last_item_at),
             archived_at = COALESCE(EXCLUDED.archived_at, threads.archived_at)
       RETURNING id`,
    [accountId, m.externalId, m.kind, m.title, m.lastItemAt, m.archivedAt],
  );
  return row.id;
}

/** The only entry point adapters push into (contract §3.3 IngestSink).
 *  US-B03: fills author_person_id and threads.participants. author_is_me stays false for now
 *  because the kernel does not yet have the user's identity list (US-B34 onboarding fills it). */
export function createIngestSink(deps: { pool: Pool; logger: Logger }): IngestSink {
  const { pool, logger } = deps;
  const channelCache = new Map<string, Channel>();
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
        threadId = await upsertThread(c, accountId, e.threadMeta);
      } else {
        const rows = await query<{ id: string }>(
          c,
          "SELECT id FROM threads WHERE account_id = $1 AND external_id = $2",
          [accountId, e.threadExternalId],
        );
        threadId = rows[0]?.id ?? (await upsertThread(c, accountId, deriveThreadMeta(e)));
      }

      const agentId =
        e.author.kind === "agent"
          ? ((
              await query<{ id: string }>(c, "SELECT id FROM agent_runtimes WHERE id = $1", [
                e.author.id,
              ])
            )[0]?.id ?? null)
          : null;

      // US-B03: store the item even if resolution fails — a message missing from the inbox is
      // worse than a wrong author.
      let personId: string | null = null;
      if (e.author.kind === "person") {
        const channel = await channelOf(c, channelCache, accountId);
        const display =
          e.threadMeta?.participants.find((p) => p.externalId === e.author.id)?.displayName ??
          e.author.id;
        try {
          const r = await resolvePerson(c, channel, e.author.id, display, e.threadExternalId);
          personId = r.person_id;
        } catch (err) {
          logger.warn("person resolution failed", {
            accountId,
            channel,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await query(
        c,
        `INSERT INTO items (thread_id, account_id, external_id, kind, status, author_person_id,
                            author_agent_id, subject, body, body_html, attachments, sent_at, source_hash)
           VALUES ($1,$2,$3,$4,'received',$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
           ON CONFLICT (account_id, source_hash) WHERE source_hash IS NOT NULL DO NOTHING`,
        [
          threadId,
          accountId,
          e.externalId,
          e.kind,
          personId,
          agentId,
          null,
          e.body,
          e.bodyHtml ?? null,
          JSON.stringify(e.attachments),
          e.sentAt,
          e.sourceHash,
        ],
      );

      if (personId !== null) {
        await query(
          c,
          `UPDATE threads
              SET participants = ARRAY(SELECT DISTINCT unnest(participants || $2::uuid[]))
            WHERE id = $1`,
          [threadId, [personId]],
        );
      }

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
