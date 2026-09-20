import { OpaqueSurface, type UiChannel, type UiItemStatus } from "@omnis/ui";
import { InboxRow, type LabelChip, type RowAvatar } from "@omnis/ui/components/inbox-row";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import {
  type AgentRuntimeKind,
  type AgentSessionKinsoState,
  agentSessionKinsoState,
} from "@omnis/ui/lib/row-meta";
import { useQuery } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { useZeroClient } from "../zero-client.js";

export const FILTERS = ["all", "work", "personal", "agents", "needs-approval"] as const;
export type InboxFilter = (typeof FILTERS)[number];

/** 셸(App.tsx)이 어떤 화면을 열지 고르는 데 필요한 최소 정보. Thread와 AgentSession은 같은
 *  threads row를 보지만 kind='agent_session'일 때만 세션 화면이다(A5 §3.3). */
export interface OpenTarget {
  threadId: string;
  agentSession: boolean;
}

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

/** U2 행 제목: 사람 표시명 → 스레드 제목 → 채널 핸들(thread.external_id) → 플레이스홀더
 * (DESIGN-DIRECTION.md U2 명세 순서 그대로 — 이전 버전의 item.subject 폴백은 행이 item 단위였을 때의
 * 것으로, U2부터 행이 thread 단위가 되며 spec이 이 3단 체인으로 바뀌었다).
 * ponytail: personName은 마지막 item의 발신자만 본다 — 내가 마지막으로 답장한 스레드는 스레드
 * 제목으로 폴백한다. threads.participants까지 읽어 "상대방 이름"을 고르는 건 후속 범위. */
export function inboxRowTitle(row: {
  personName?: string | null;
  threadTitle?: string | null;
  channelHandle?: string | null;
}): string {
  return row.personName || row.threadTitle || row.channelHandle || "(제목 없음)";
}

function firstLine(body: string): string {
  const idx = body.indexOf("\n");
  return (idx === -1 ? body : body.slice(0, idx)).trim();
}

/** U2 요약: threads.meta.summary(B3가 채울 것) → subject → 마지막 item 본문 첫 줄. */
export function threadSummary(row: {
  metaSummary?: string | null;
  subject?: string | null;
  body: string;
}): string {
  return row.metaSummary || row.subject || firstLine(row.body);
}

export interface SortableInboxRow {
  hasPendingApproval: boolean;
  agentState: AgentSessionKinsoState | null;
}

/** U2: "blocked" agent session이거나 승인 대기가 있는 행을 맨 위로. 나머지는 원래 순서(최신순) 유지
 * — Array.prototype.sort는 stable(ES2019+, V8)이라 비교 키가 같은 행끼리는 입력 순서가 보존된다. */
export function sortInboxRows<T extends SortableInboxRow>(rows: T[]): T[] {
  const needsAttention = (r: SortableInboxRow) =>
    r.hasPendingApproval || r.agentState === "blocked";
  return [...rows].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
}

export function Inbox({
  onOpen,
  channelFilter = null,
}: {
  onOpen?: (target: OpenTarget) => void;
  /** U1 채널 레일 선택. null = 전체(Inbox 타일). pill 필터(work/personal/…)와 AND로 합쳐진다. */
  channelFilter?: UiChannel | null;
}) {
  const zero = useZeroClient();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 편차(계획 A26 step 7 대비, 인터페이스 계약 §7 zeroSchema 기준): zeroSchema(A21, packages/kernel/src/zero-schema.ts)는
  // Inbox/Thread가 실제로 쓰는 관계 3개(threads.items, items.thread, items.author)만 정의한다 —
  // items.labels 관계는 없다(라벨은 items가 아니라 thread_labels로 스레드에 붙는다, A5 §3.1 "라벨 칩 명세").
  // 채널·승인 배지·라벨은 관계가 아니라 각자 자기 테이블을 조회해 클라이언트에서 id로 조인한다.
  //
  // U2 편차: "thread 목록"은 zero.query.threads가 아니라 이 items 쿼리를 스레드 단위로 client-side
  // dedup해서 만든다. 이유: zeroSchema에 threads→items 관계는 있지만 그 관계에 orderBy+limit을 걸어
  // "스레드당 최신 item 1건"을 서버에 묻는 경로는 이 Zero 버전(1.9.0)에서 검증되지 않았다(zql AST의
  // Ordering 타입 주석이 "루트 쿼리 밖의 정렬은 아직 지원 안 함"이라고 못박아 리스크가 있다) — 반면
  // items를 sent_at desc로 받아 thread_id 첫 등장만 남기는 건 이미 동작이 증명된 쿼리 모양이라 그대로
  // 재사용한다. ponytail: 한 스레드에 top-N 안에서 메시지가 여러 개면 다른 스레드가 밀릴 수 있다(한도
  // 200으로 여유를 둠) — 진짜 "스레드별 최신 1건"이 필요해지면 threads.related("items", limit 1) 경로를
  // 검증하고 전환.
  const [items] = useQuery(
    zero.query.items
      .where("status", "!=", "archived")
      .orderBy("sent_at", "desc")
      .related("thread")
      .related("author")
      .limit(200),
  );
  const [accounts] = useQuery(zero.query.accounts);
  const [pendingApprovals] = useQuery(zero.query.pending_approvals.where("state", "=", "pending"));
  const [labels] = useQuery(zero.query.labels);
  const [threadLabels] = useQuery(zero.query.thread_labels);
  const [agentSessions] = useQuery(zero.query.agent_sessions);
  const [agentRuntimes] = useQuery(zero.query.agent_runtimes);

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
  const sessionByThread = useMemo(
    () => new Map(agentSessions.map((s) => [s.thread_id, s])),
    [agentSessions],
  );
  const runtimeById = useMemo(
    () => new Map(agentRuntimes.map((r) => [r.id, r.runtime as AgentRuntimeKind])),
    [agentRuntimes],
  );

  // U2: item 스트림을 thread 단위로 dedup(sent_at desc라 thread_id 첫 등장 = 최신 item).
  const threadRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{
      id: string;
      threadId: string;
      agentSession: boolean;
      scope: InboxQueryItem["scope"];
      authorKind: InboxQueryItem["authorKind"];
      hasPendingApproval: boolean;
      title: string;
      summary: string;
      isDraft: boolean;
      channel: UiChannel;
      timestamp: string;
      unread: boolean;
      labels: LabelChip[];
      avatar: RowAvatar;
      agentState: AgentSessionKinsoState | null;
    }> = [];
    for (const item of items) {
      if (seen.has(item.thread_id)) continue;
      seen.add(item.thread_id);
      const isAgentSession = item.thread?.kind === "agent_session";
      const session = sessionByThread.get(item.thread_id);
      const agentState = isAgentSession && session ? agentSessionKinsoState(session.state) : null;
      const runtime = session ? runtimeById.get(session.runtime_id) : undefined;
      const authorKind: InboxQueryItem["authorKind"] = isAgentSession
        ? "agent"
        : item.author_agent_id
          ? "agent"
          : item.author_person_id
            ? "person"
            : "system";
      const title = inboxRowTitle({
        personName: item.author?.display_name ?? null,
        threadTitle: item.thread?.title ?? null,
        channelHandle: item.thread?.external_id ?? null,
      });
      rows.push({
        id: item.thread_id,
        threadId: item.thread_id,
        agentSession: isAgentSession,
        scope: item.scope as InboxQueryItem["scope"],
        authorKind,
        hasPendingApproval: pendingThreadIds.has(item.thread_id),
        title,
        summary: threadSummary({
          metaSummary: (item.thread?.meta as { summary?: string } | null)?.summary ?? null,
          subject: item.subject ?? null,
          body: item.body,
        }),
        isDraft: (item.status as UiItemStatus) === "draft",
        channel: channelByAccount.get(item.account_id) ?? "system",
        timestamp: formatRelativeTime(item.sent_at),
        unread: (item.thread?.unread_count ?? 0) > 0,
        labels: chipsByThread.get(item.thread_id) ?? [],
        avatar:
          runtime !== undefined ? { kind: "runtime", runtime } : { kind: "initials", name: title },
        agentState,
      });
    }
    return rows;
  }, [items, pendingThreadIds, channelByAccount, chipsByThread, sessionByThread, runtimeById]);

  const channelFiltered = useMemo(
    () => (channelFilter ? threadRows.filter((r) => r.channel === channelFilter) : threadRows),
    [threadRows, channelFilter],
  );
  const pillFiltered = useMemo(
    () => filterInboxItems(channelFiltered, filter),
    [channelFiltered, filter],
  );
  const filtered = useMemo(() => sortInboxRows(pillFiltered), [pillFiltered]);

  return (
    <OpaqueSurface className="inbox-card">
      <div className="inbox-card__header">
        <h2 className="inbox-card__title">Inbox</h2>
        <div role="radiogroup" aria-label="Inbox 필터" className="inbox-card__pills">
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
      </div>
      <Virtuoso
        role="listbox"
        style={{ flex: "1 1 0", minHeight: 0 }}
        data={filtered}
        itemContent={(_, item) => (
          <InboxRow
            id={item.id}
            name={item.title}
            summary={item.summary}
            isDraft={item.isDraft}
            avatar={item.avatar}
            channel={item.channel}
            agentState={item.agentState}
            timestamp={item.timestamp}
            unread={item.unread}
            selected={item.id === selectedId}
            hasPendingApproval={item.hasPendingApproval}
            labels={item.labels}
            onSelect={(id) => {
              setSelectedId(id);
              onOpen?.({ threadId: item.threadId, agentSession: item.agentSession });
            }}
          />
        )}
      />
    </OpaqueSurface>
  );
}
