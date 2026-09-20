import { GlassSurface } from "@omnis/ui";
import {
  InboxRow,
  type LabelChip,
  type UiChannel,
  type UiItemStatus,
} from "@omnis/ui/components/inbox-row";
import { useQuery } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { initZero } from "../zero-client.js";

export const FILTERS = ["all", "work", "personal", "agents", "needs-approval"] as const;
export type InboxFilter = (typeof FILTERS)[number];

export interface InboxQueryItem {
  id: string;
  scope: "work" | "personal" | "unknown";
  hasPendingApproval: boolean;
  authorKind: "person" | "agent" | "system";
}

/** A5 §2.1: 5개 필터 pill은 서로 배타(라디오)이며 items.status/labels.kind='scope' 조합의 뷰다. */
export function filterInboxItems<T extends InboxQueryItem>(items: T[], filter: InboxFilter): T[] {
  switch (filter) {
    case "all":
      return items;
    case "work":
      return items.filter((i) => i.scope === "work");
    case "personal":
      return items.filter((i) => i.scope === "personal");
    case "agents":
      return items.filter((i) => i.authorKind === "agent");
    case "needs-approval":
      return items.filter((i) => i.hasPendingApproval);
  }
}

const HHMM = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const zero = initZero();

export function Inbox() {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 편차(계획 A26 step 7 대비, 인터페이스 계약 §7 zeroSchema 기준): zeroSchema(A21, packages/kernel/src/zero-schema.ts)는
  // Inbox/Thread가 실제로 쓰는 관계 3개(threads.items, items.thread, items.author)만 정의한다 —
  // items.labels 관계는 없다(라벨은 items가 아니라 thread_labels로 스레드에 붙는다, A5 §3.1 "라벨 칩 명세").
  // 채널·승인 배지·라벨은 관계가 아니라 각자 자기 테이블을 조회해 클라이언트에서 id로 조인한다.
  const [items] = useQuery(
    zero.query.items
      .where("status", "!=", "archived")
      .orderBy("sent_at", "desc")
      .related("thread")
      .related("author")
      .limit(50),
  );
  const [accounts] = useQuery(zero.query.accounts);
  const [pendingApprovals] = useQuery(zero.query.pending_approvals.where("state", "=", "pending"));
  const [labels] = useQuery(zero.query.labels);
  const [threadLabels] = useQuery(zero.query.thread_labels);

  const channelByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.channel as UiChannel])),
    [accounts],
  );
  const pendingThreadIds = useMemo(
    () =>
      new Set(pendingApprovals.map((a) => a.thread_id).filter((id): id is string => Boolean(id))),
    [pendingApprovals],
  );
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const chipsByThread = useMemo(() => {
    const map = new Map<string, LabelChip[]>();
    for (const tl of threadLabels) {
      const label = labelById.get(tl.label_id);
      if (!label) continue;
      const chip: LabelChip = {
        kind: label.kind as LabelChip["kind"],
        name: label.name,
        color: label.color ?? null,
      };
      const existing = map.get(tl.thread_id);
      if (existing) existing.push(chip);
      else map.set(tl.thread_id, [chip]);
    }
    return map;
  }, [threadLabels, labelById]);

  const rows = useMemo(
    () =>
      items.map((item) => {
        const authorKind: InboxQueryItem["authorKind"] = item.author_agent_id
          ? "agent"
          : item.author_person_id
            ? "person"
            : "system";
        return {
          id: item.id,
          scope: item.scope as InboxQueryItem["scope"],
          authorKind,
          hasPendingApproval: pendingThreadIds.has(item.thread_id),
          title: item.author?.display_name ?? item.subject ?? "(제목 없음)",
          preview: item.body,
          channel: channelByAccount.get(item.account_id) ?? "system",
          timestamp: HHMM.format(new Date(item.sent_at)),
          status: item.status as UiItemStatus,
          unread: (item.thread?.unread_count ?? 0) > 0,
          labels: chipsByThread.get(item.thread_id) ?? [],
        };
      }),
    [items, pendingThreadIds, channelByAccount, chipsByThread],
  );

  const filtered = useMemo(() => filterInboxItems(rows, filter), [rows, filter]);

  return (
    <div className="inbox-screen">
      <GlassSurface slot="sidebar" className="inbox-screen__filters">
        <div role="radiogroup" aria-label="Inbox 필터">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: A5 §2.1 필터 pill — <input type="radio"> can't render a pill label+count.
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </GlassSurface>
      <Virtuoso
        role="listbox"
        style={{ height: "100%" }}
        data={filtered}
        itemContent={(_, item) => (
          <InboxRow
            id={item.id}
            title={item.title}
            preview={item.preview}
            channel={item.channel}
            timestamp={item.timestamp}
            status={item.status}
            unread={item.unread}
            selected={item.id === selectedId}
            hasPendingApproval={item.hasPendingApproval}
            labels={item.labels}
            onSelect={setSelectedId}
          />
        )}
      />
    </div>
  );
}
