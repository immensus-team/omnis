import {
  type FilterChip,
  FilterChipBar,
  OpaqueSurface,
  type UiChannel,
  type UiItemStatus,
} from "@omnis/ui";
import { groupBy } from "@omnis/ui/components/command-palette";
import { GroupHeader } from "@omnis/ui/components/group-header";
import { InboxRow, type LabelChip, type RowAvatar } from "@omnis/ui/components/inbox-row";
import { type AgentPillState, AgentStatusPill } from "@omnis/ui/components/status-pill";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import {
  type AgentRuntimeKind,
  type AgentSessionKinsoState,
  CHANNEL_LABEL,
  agentSessionKinsoState,
} from "@omnis/ui/lib/row-meta";
import { useQuery } from "@rocicorp/zero/react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { setThreadArchived } from "../api/threads.js";
import { useKeymap } from "../hooks/use-keymap.js";
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
    // 이 탭은 아카이브가 아니라 내 액션 큐다 — 지금 내 결정을 기다리는 건만 남는다. 결정·만료된
    // 건까지 남기면 탭이 영원히 비워지지 않는다(라이프사이클은 그 자체로 뷰가 필요한 얘기고,
    // 아직 그런 뷰가 없다).
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

/** Gmail 어댑터는 subject를 본문 맨 앞에 "Subject: …\n\n"으로 합성해 넣는다 —
 * NormalizedItem에 subject 필드가 없어서다(packages/adapters/gmail/src/index.ts). 행 요약에
 * 메일 헤더 텍스트를 그대로 내보낼 이유는 없으니 벗겨 낸다. */
function stripSubjectHeader(body: string): string {
  if (!body.startsWith("Subject: ")) return body;
  const blank = body.indexOf("\n\n");
  return blank === -1 ? "" : body.slice(blank + 2);
}

/** U2 요약: threads.meta.summary(B3가 채울 것) → subject → 마지막 item 본문 첫 줄.
 * 단 행 제목과 같은 문자열은 건너뛴다. Gmail/gcal은 thread.title을 subject/summary에서 만들고
 * (gcal은 body까지 같은 문자열이다) Phase A는 author_person_id를 안 채워 행 제목도 thread.title로
 * 떨어진다 — 그대로 두면 한 행에 같은 말이 두 줄 찍힌다. 남은 후보가 제목뿐이면 요약 줄을
 * 비운다(그리드 2행이 0높이로 접혀 한 줄짜리 행이 된다). B3 요약이 붙으면 이 경로는 사라진다. */
export function threadSummary(row: {
  metaSummary?: string | null;
  subject?: string | null;
  body: string;
  title?: string | null;
}): string {
  if (row.metaSummary) return row.metaSummary;
  for (const candidate of [row.subject, firstLine(stripSubjectHeader(row.body))]) {
    if (candidate && candidate !== row.title) return candidate;
  }
  return "";
}

export interface ArchivableRow {
  threadId: string;
  /** threads.archived_at (ms). null이면 인박스에 남는다(A5 §3.1의 기본 쿼리). */
  archivedAt: number | null;
}

/** US-A36: Inbox는 보관된 스레드를 빼고, Archived 뷰는 보관된 것만 보관 시각 역순으로 보여준다.
 *  `pending`은 HTTP 왕복 + Zero 복제가 도착하기 전까지의 낙관적 오버라이드(id → 보관 여부)다. */
export function applyArchiveView<T extends ArchivableRow>(
  rows: T[],
  view: "inbox" | "archived",
  pending: Record<string, boolean>,
): T[] {
  const isArchived = (r: T): boolean => pending[r.threadId] ?? r.archivedAt !== null;
  if (view === "inbox") return rows.filter((r) => !isArchived(r));
  return rows
    .filter(isArchived)
    .sort(
      (a, b) =>
        (b.archivedAt ?? Number.MAX_SAFE_INTEGER) - (a.archivedAt ?? Number.MAX_SAFE_INTEGER),
    );
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

/** blocked(내 응답 필요)가 맨 위 — DESIGN-DIRECTION.md의 herdr 상태 모델 순서 그대로. */
const AGENT_GROUP_ORDER: AgentPillState[] = ["blocked", "working", "idle", "done", "failed"];

/** agent_session이 아닌 agent-authored 행(agentState===null, 예: agent가 보낸 Slack 메시지)은
 * 그룹 헤더로 묶을 상태가 없다 — 별도 마지막 섹션으로 그대로(원래 순서) 붙인다. */
export function groupByAgentState<T extends { agentState: AgentPillState | null }>(
  rows: T[],
): { groups: Array<{ state: AgentPillState; rows: T[] }>; ungrouped: T[] } {
  const grouped = rows.filter((r) => r.agentState !== null) as Array<
    T & { agentState: AgentPillState }
  >;
  const ungrouped = rows.filter((r) => r.agentState === null);
  const groups = groupBy(grouped, (r) => r.agentState);
  return {
    groups: AGENT_GROUP_ORDER.flatMap((s) => {
      const rows = groups[s];
      return rows?.length ? [{ state: s, rows }] : [];
    }),
    ungrouped,
  };
}

/** U2 행 하나. threadRows 메모가 만들고, 그룹핑 평탄화(FlatItem)가 다시 참조한다. */
interface ThreadRow extends InboxQueryItem, ArchivableRow, SortableInboxRow {
  threadId: string;
  agentSession: boolean;
  title: string;
  summary: string;
  isDraft: boolean;
  channel: UiChannel;
  timestamp: string;
  unread: boolean;
  unreadCount: number;
  labels: LabelChip[];
  avatar: RowAvatar;
}

/** Virtuoso는 평평한 배열만 받는다 — 그룹 헤더와 행을 한 스트림으로 접은 것. */
type FlatItem =
  | { kind: "header"; key: string; count: number; pill: ReactNode }
  | { kind: "row"; row: ThreadRow };

export function Inbox({
  onOpen,
  channelFilter = null,
  onChannelFilterChange,
}: {
  onOpen?: (target: OpenTarget) => void;
  /** U1 채널 레일 선택. null = 전체(Inbox 타일). pill 필터(work/personal/…)와 AND로 합쳐진다. */
  channelFilter?: UiChannel | null;
  /** US-D02: 채널 칩의 ×가 레일 선택을 되돌리는 경로. 안 넘기면 채널 칩 자체를 안 그린다
   *  (아무 일도 안 하는 ×는 없는 것만 못하다). */
  onChannelFilterChange?: (c: UiChannel | null) => void;
}) {
  const zero = useZeroClient();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"inbox" | "archived">("inbox");
  // 낙관적 오버라이드: 허브 왕복 + Zero 복제가 도착하기 전까지 행이 그 자리에 남아 있지 않게 한다.
  const [pendingArchive, setPendingArchive] = useState<Record<string, boolean>>({});
  // US-D02: 라벨 칩 필터. 빈 Set = 라벨 조건 없음(AND로 다른 필터들과 합쳐진다).
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(new Set());

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
  // 이름 그대로 "대기 중"만 받는다. 라이프사이클 전체를 복제하면 클라이언트 쪽 승인 테이블이
  // 상한 없이 자라는데, 인박스가 실제로 묻는 건 "지금 내 결정을 기다리는 게 뭐냐" 하나다.
  const [pendingApprovals] = useQuery(
    zero.query.pending_approvals
      .where("state", "=", "pending")
      .orderBy("created_at", "desc")
      .limit(200),
  );
  const [labels] = useQuery(zero.query.labels);
  const [threadLabels] = useQuery(zero.query.thread_labels);
  const [agentSessions] = useQuery(zero.query.agent_sessions);
  const [agentRuntimes] = useQuery(zero.query.agent_runtimes);

  const channelByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.channel as UiChannel])),
    [accounts],
  );
  // 스레드당 승인 한 건(가장 최근 것). 쿼리가 created_at desc라 첫 등장이 곧 최신이다.
  const approvalByThread = useMemo(() => {
    const best = new Map<string, (typeof pendingApprovals)[number]>();
    for (const approval of pendingApprovals) {
      if (!approval.thread_id) continue;
      if (!best.has(approval.thread_id)) best.set(approval.thread_id, approval);
    }
    return best;
  }, [pendingApprovals]);
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
    const rows: ThreadRow[] = [];
    for (const item of items) {
      if (seen.has(item.thread_id)) continue;
      seen.add(item.thread_id);
      const isAgentSession = item.thread?.kind === "agent_session";
      const session = sessionByThread.get(item.thread_id);
      const agentState = isAgentSession && session ? agentSessionKinsoState(session.state) : null;
      // 쿼리가 state='pending'만 받으므로(위 pending_approvals) 존재 = 내 결정 대기다.
      const hasPendingApproval = approvalByThread.has(item.thread_id);
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
        hasPendingApproval,
        title,
        summary: threadSummary({
          metaSummary: (item.thread?.meta as { summary?: string } | null)?.summary ?? null,
          subject: item.subject ?? null,
          body: item.body,
          title,
        }),
        isDraft: (item.status as UiItemStatus) === "draft",
        channel: channelByAccount.get(item.account_id) ?? "system",
        timestamp: formatRelativeTime(item.sent_at),
        unread: (item.thread?.unread_count ?? 0) > 0,
        unreadCount: item.thread?.unread_count ?? 0,
        labels: chipsByThread.get(item.thread_id) ?? [],
        avatar:
          runtime !== undefined ? { kind: "runtime", runtime } : { kind: "initials", name: title },
        agentState,
        archivedAt: item.thread?.archived_at ?? null,
      });
    }
    return rows;
  }, [items, approvalByThread, channelByAccount, chipsByThread, sessionByThread, runtimeById]);

  // 서버 상태가 오버라이드를 따라잡으면 오버라이드를 버린다 — 그래야 이후의 자동 보관(A4 §9)이나
  // 다른 기기에서 한 되살리기가 이 화면에서 무시되지 않는다.
  useEffect(() => {
    setPendingArchive((prev) => {
      const settled = threadRows.filter((r) => prev[r.threadId] === (r.archivedAt !== null));
      if (settled.length === 0) return prev;
      const next = { ...prev };
      for (const r of settled) delete next[r.threadId];
      return next;
    });
  }, [threadRows]);

  const toggleArchive = useCallback((threadId: string, archived: boolean) => {
    setPendingArchive((p) => ({ ...p, [threadId]: archived }));
    setThreadArchived(threadId, archived).catch((e: unknown) => {
      // 허브가 거절하면 낙관적 상태를 되돌린다 — 화면이 서버보다 앞서 거짓말하지 않는다.
      setPendingArchive((p) => {
        const next = { ...p };
        delete next[threadId];
        return next;
      });
      console.error("archive failed", e);
    });
  }, []);

  useKeymap(
    useCallback(
      (action: string) => {
        if (selectedId === null) return;
        if (action === "archive") toggleArchive(selectedId, true);
        if (action === "unarchive") toggleArchive(selectedId, false);
      },
      [selectedId, toggleArchive],
    ),
  );

  const channelFiltered = useMemo(
    () => (channelFilter ? threadRows.filter((r) => r.channel === channelFilter) : threadRows),
    [threadRows, channelFilter],
  );
  const pillFiltered = useMemo(
    () => filterInboxItems(channelFiltered, filter),
    [channelFiltered, filter],
  );
  // US-D02 라벨 칩: 스레드에 붙은 thread_labels 중 하나라도 고른 라벨이면 통과. 라벨을 하나도
  // 안 골랐으면 이 단계는 통째로 사라진다(빈 Set으로 거르면 전부 탈락한다 — 그게 기본값 함정).
  const labelFiltered = useMemo(() => {
    if (selectedLabelIds.size === 0) return pillFiltered;
    const matching = new Set<string>();
    for (const tl of threadLabels) {
      if (selectedLabelIds.has(tl.label_id)) matching.add(tl.thread_id);
    }
    return pillFiltered.filter((r) => matching.has(r.threadId));
  }, [pillFiltered, threadLabels, selectedLabelIds]);
  const viewFiltered = useMemo(
    () => applyArchiveView(labelFiltered, view, pendingArchive),
    [labelFiltered, view, pendingArchive],
  );
  // Archived는 "보관 시각 역순"이 정렬 기준이다 — needs-attention을 위로 끌어올리지 않는다.
  const filtered = useMemo(
    () => (view === "archived" ? viewFiltered : sortInboxRows(viewFiltered)),
    [viewFiltered, view],
  );

  // US-D02 필터 칩. 칩 문구는 여기서 완성해 넘긴다(FilterChipBar는 "채널/라벨"을 모른다).
  const chips: FilterChip[] = [];
  if (channelFilter && onChannelFilterChange) {
    chips.push({
      id: "channel",
      field: "채널",
      value: CHANNEL_LABEL[channelFilter],
      onRemove: () => onChannelFilterChange(null),
    });
  }
  if (selectedLabelIds.size > 0) {
    chips.push({
      id: "labels",
      field: "라벨",
      // 레퍼런스의 필터 DSL도 값이 하나면 수량사를 접는다("Channel is Slack") —
      // "1개 중 하나"는 사람이 쓰지 않는 말이라 채널 칩과 같이 이름만 남긴다.
      value:
        selectedLabelIds.size === 1
          ? (labels.find((l) => selectedLabelIds.has(l.id))?.name ?? "1개")
          : `${selectedLabelIds.size}개 중 하나`,
      onRemove: () => setSelectedLabelIds(new Set()),
    });
  }
  const addOptions = {
    fieldLabel: "라벨",
    options: labels.map((l) => ({ id: l.id, label: l.name })),
    selectedIds: [...selectedLabelIds],
    onToggle: (id: string) =>
      setSelectedLabelIds((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  };

  // US-D02: 그룹핑은 agents 뷰에서만. needs-approval은 pending만 쿼리해서(위 pending_approvals
  // `.where(state,pending)`) 그룹이 언제나 "대기" 하나뿐이고, 그러면 헤더 띠는 방금 고른 탭
  // 이름을 한 번 더 말할 뿐 정보를 싣지 못한다 — 숫자만 탭 pill로 접었다(아래 pendingCount).
  // Archived도 평평하게 둔다(보관 시각 역순이라는 자체 정렬 축 위에 상태 그룹을 얹으면 싸운다).
  const grouped = view === "inbox" && filter === "agents";
  const listItems = useMemo<FlatItem[]>(() => {
    if (!grouped) return filtered.map((row) => ({ kind: "row", row }));
    // agents: 세션 상태가 없는 행(agent가 보낸 Slack 메시지 등)은 헤더 없이 맨 뒤에 붙인다.
    const { groups, ungrouped } = groupByAgentState(filtered);
    return [
      ...groups.flatMap((g) => [
        {
          kind: "header" as const,
          key: `agent-${g.state}`,
          count: g.rows.length,
          pill: <AgentStatusPill state={g.state} />,
        },
        ...g.rows.map((row) => ({ kind: "row" as const, row })),
      ]),
      ...ungrouped.map((row) => ({ kind: "row" as const, row })),
    ];
  }, [filtered, grouped]);

  // needs-approval 탭의 카운트. 탭이 선택돼 있든 아니든 같은 수라야 의미가 있으므로 pill 필터
  // **이전** 단계(labelFiltered)에서 센다. 0이면 아예 안 그린다 — 큐가 비었다는 건 배지가 아니라
  // 빈 리스트가 말한다.
  const pendingCount = useMemo(
    () =>
      applyArchiveView(labelFiltered, view, pendingArchive).filter((r) => r.hasPendingApproval)
        .length,
    [labelFiltered, view, pendingArchive],
  );

  return (
    <OpaqueSurface className="inbox-card">
      <div className="inbox-card__header">
        <h2 className="inbox-card__title">{view === "archived" ? "Archived" : "Inbox"}</h2>
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
              {f === "needs-approval" && pendingCount > 0 && (
                <span className="inbox-card__pill-count">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
        {/* US-A36: 보관함 pill. 필터 pill(라디오)과 달리 토글이라 radiogroup 밖에 둔다. */}
        <button
          type="button"
          className="inbox-card__archived-pill"
          aria-pressed={view === "archived"}
          onClick={() => setView((v) => (v === "archived" ? "inbox" : "archived"))}
        >
          보관됨
        </button>
      </div>
      {/* 라벨이 하나도 없는 워크스페이스에선 아무것도 못 누르는 빈 바를 그리지 않는다. */}
      {(chips.length > 0 || labels.length > 0) && (
        <FilterChipBar chips={chips} addOptions={addOptions} />
      )}
      <Virtuoso
        role="listbox"
        style={{ flex: "1 1 0", minHeight: 0 }}
        data={listItems}
        itemContent={(_, item) =>
          item.kind === "header" ? (
            <GroupHeader pill={item.pill} count={item.count} />
          ) : (
            <InboxRow
              id={item.row.id}
              name={item.row.title}
              summary={item.row.summary}
              isDraft={item.row.isDraft}
              avatar={item.row.avatar}
              channel={item.row.channel}
              // 그룹 헤더가 바로 위에서 상태를 말할 때 행이 같은 말을 다시 하지 않는다
              // (ref-issue-tracker-density.webp도 상태어는 헤더에만 둔다). 다만 세션이라는
              // 사실 자체는 지우지 않는다 — agentState를 null로 덮으면 런타임 세션 행이
              // 채널 글리프로 떨어져 "Slack 메시지"를 자칭했다(3회차 거절 사유).
              agentState={item.row.agentState}
              groupedByState={grouped}
              timestamp={item.row.timestamp}
              unread={item.row.unread}
              unreadCount={item.row.unreadCount}
              selected={item.row.id === selectedId}
              // needs-approval 탭에서는 모든 행이 승인 대기다 — 탭이 이미 말한 걸 행마다
              // 점으로 되풀이하면 점이 아무것도 구분하지 못한다(그룹 헤더 아래 상태 배지를
              // 뺀 것과 같은 규칙: 위가 말한 상태를 아래가 반복하지 않는다).
              hasPendingApproval={filter !== "needs-approval" && item.row.hasPendingApproval}
              labels={item.row.labels}
              archived={view === "archived"}
              onArchive={(id) => toggleArchive(id, view !== "archived")}
              onSelect={(id) => {
                setSelectedId(id);
                onOpen?.({ threadId: item.row.threadId, agentSession: item.row.agentSession });
              }}
            />
          )
        }
      />
    </OpaqueSurface>
  );
}
