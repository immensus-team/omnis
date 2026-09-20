import { DraftCard, StatusBadge } from "@omnis/ui";
import type { UiItemStatus } from "@omnis/ui";
import { useQuery } from "@rocicorp/zero/react";
import { setThreadArchived } from "../api/threads.js";
import { useZeroClient } from "../zero-client.js";

export interface ThreadQueryItem {
  id: string;
  status: UiItemStatus;
  body: string;
}

/** A5 §3.2: DraftCard는 status='draft'인 Item이 있을 때만 나타난다. */
export function findDraftItem<T extends ThreadQueryItem>(items: T[]): T | undefined {
  return items.find((i) => i.status === "draft");
}

export function Thread({ threadId }: { threadId: string }) {
  const zero = useZeroClient();
  // 편차(계획 step 9 대비, packages/kernel/src/zero-schema.ts 기준): items 컬럼은
  // camelCase `sentAt`이 아니라 snake_case `sent_at`이다(Task 4의 Inbox.tsx가 이미
  // 같은 이유로 `sent_at`을 쓴다) — 계획의 `orderBy("sentAt", ...)` 예시를 실제 스키마에 맞춘다.
  const [items] = useQuery(
    zero.query.items.where("thread_id", "=", threadId).orderBy("sent_at", "asc").related("author"),
  );
  const typedItems = items as unknown as ThreadQueryItem[];
  const draft = findDraftItem(typedItems);
  // A5 §3.8: 보관된 스레드는 헤더 아래 인라인 배너로 상태와 되살리기를 노출한다.
  const [threads] = useQuery(zero.query.threads.where("id", "=", threadId));
  const archived =
    (threads as unknown as { archived_at?: number | null }[])[0]?.archived_at ?? null;

  return (
    <div className="thread-screen">
      {archived !== null && (
        <div className="thread-screen__archived-banner">
          <span>보관됨</span>
          <button type="button" onClick={() => void setThreadArchived(threadId, false)}>
            되살리기
          </button>
        </div>
      )}
      {typedItems.map((item) => (
        <div key={item.id} className="thread-screen__item">
          <StatusBadge status={item.status} />
          <p>{item.body}</p>
        </div>
      ))}
      {draft && (
        <DraftCard
          body={draft.body}
          rationale="메모리·과거 스레드"
          onEditAndSend={() => {
            /* Composer wiring은 스토리 범위 밖(YAGNI) */
          }}
          onDiscard={() => zero.mutate.items.update({ id: draft.id, status: "archived" })}
          onRegenerate={() => {
            /* propose_draft 재요청은 packages/agents 몫, 이 화면은 트리거만 노출 */
          }}
        />
      )}
    </div>
  );
}
