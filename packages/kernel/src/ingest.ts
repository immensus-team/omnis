import { one, query, tx } from "@omnis/db";
import type { PoolClient } from "@omnis/db";
import type {
  AdapterEvent,
  IngestSink,
  NormalizedItem,
  NormalizedThread,
  ThreadKind,
} from "@omnis/protocol";
import type { Pool } from "pg";
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

/** 어댑터가 threadMeta 없이 첫 아이템을 보냈을 때의 최후 수단(root fix, 이전엔 여기서 throw했다) —
 *  아이템 자체가 들고 있는 정보만으로 스레드를 합성한다. NormalizedItem에는 subject도 채널명도
 *  없으니 제목은 참가자(= 작성자)에서 뽑는다. 어댑터가 normalize()에서 threadMeta를 채우면
 *  이 함수는 아예 호출되지 않는다. */
function deriveThreadMeta(e: NormalizedItem): NormalizedThread {
  // threads.participants(persons.id의 uuid[])는 Phase A에서 쓰지 않는다(A3 §10) — 여기 값은
  // 제목 합성에 쓰이고, 신원 해석이 들어오는 Phase B에서 그대로 영속화 대상이 된다.
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

/** 들어오는 아이템은 스레드를 "덮어쓰지" 않는다. 어댑터가 이제 모든 아이템에 threadMeta를
 *  싣기 때문에 이 UPDATE는 메시지 한 통마다 돈다 — 무조건 대입이면 다음이 깨진다.
 *  - title: 제목을 처음 아는 아이템이 정한다. 뒤따르는 답장 제목("Re: ...")이 스레드 이름을
 *    바꾸거나, 제목 없는(null) 메시지가 이름을 지워서는 안 된다. 진짜 rename 경로
 *    (conversations.info 싱크 등)는 Phase B에서 명시적으로 UPDATE한다.
 *  - archived_at: 사용자가 보관한 스레드를 새 메시지 한 통이 조용히 되살리면 안 된다.
 *    어댑터가 보관을 주장할 때만(gcal cancelled) 채워지고, null은 "해제"가 아니라 "모름"이다. */
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
        threadId = await upsertThread(c, accountId, e.threadMeta);
      } else {
        const rows = await query<{ id: string }>(
          c,
          "SELECT id FROM threads WHERE account_id = $1 AND external_id = $2",
          [accountId, e.threadExternalId],
        );
        threadId = rows[0]?.id ?? (await upsertThread(c, accountId, deriveThreadMeta(e)));
      }

      // author_agent_id만 해석한다. person은 Phase B(A3 §10).
      const agentId =
        e.author.kind === "agent"
          ? ((
              await query<{ id: string }>(c, "SELECT id FROM agent_runtimes WHERE id = $1", [
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
