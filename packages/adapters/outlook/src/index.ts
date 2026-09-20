import type { Attachment, NormalizedItem } from "@omnis/protocol";

export const CHANNEL = "outlook" as const;

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}
interface GraphMessage {
  id?: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  "@removed"?: { reason?: string };
}

/** ponytail: 정규식 태그 제거만 한다 — 완전한 HTML→텍스트 변환이 필요해지면(표·리스트 서식 깨짐이
 *  체감되면) 그때 라이브러리로 승격한다. Gmail/Graph 둘 다 body를 그대로 저장하고 검색은
 *  `items.search_tsv`(plain 텍스트)가 하므로 v1은 이걸로 충분하다. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addr(a?: GraphAddress): { externalId: string; displayName: string } | null {
  const email = a?.emailAddress?.address;
  if (!email) return null;
  return { externalId: email, displayName: a?.emailAddress?.name || email };
}

export function normalize(raw: unknown): NormalizedItem[] {
  const m = raw as GraphMessage;
  // delta tombstone: 삭제된 메시지를 알리는 행이라 콘텐츠가 없다. items를 지우지 않는다(A3 §11) —
  // 그냥 아이템을 만들지 않을 뿐이다.
  if (m["@removed"] !== undefined) return [];
  if (!m.id || !m.conversationId) return [];

  const bodyText =
    m.body?.contentType === "html" ? stripHtml(m.body.content ?? "") : (m.body?.content ?? "");
  const participants = [
    addr(m.from),
    ...(m.toRecipients ?? []).map(addr),
    ...(m.ccRecipients ?? []).map(addr),
  ]
    .filter((p): p is { externalId: string; displayName: string } => p !== null)
    .filter((p, i, all) => all.findIndex((o) => o.externalId === p.externalId) === i);
  // 원본 receivedDateTime엔 밀리초가 없을 수 있다(`...20Z`) — NormalizedItem 계약은 항상
  // `.SSSZ` 형태를 기대하므로(다른 어댑터와 동일 포맷) Date를 한 번 왕복시켜 정규화한다.
  const sentAt = new Date(m.receivedDateTime ?? Date.now()).toISOString();
  const attachments: Attachment[] = []; // 다운로드는 /attachments 개별 호출(A1 §2.4) — Gmail과 동일 원칙

  return [
    {
      threadExternalId: m.conversationId,
      externalId: m.id,
      kind: "email",
      author: { kind: "person", id: m.from?.emailAddress?.address ?? "" },
      body: m.subject ? `Subject: ${m.subject}\n\n${bodyText}` : bodyText,
      attachments,
      sentAt,
      status: "received",
      sourceHash: m.internetMessageId || m.id,
      threadMeta: {
        externalId: m.conversationId,
        kind: "email",
        title: m.subject || null,
        participants,
        lastItemAt: sentAt,
        archivedAt: null,
      },
    },
  ];
}
