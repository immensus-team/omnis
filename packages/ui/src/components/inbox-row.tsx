import * as HoverCard from "@radix-ui/react-hover-card";
import { cn } from "../lib/cn.js";
import {
  type AgentRuntimeKind,
  type AgentSessionKinsoState,
  CHANNEL_LABEL,
  RUNTIME_ICON,
  RUNTIME_LABEL,
  RUNTIME_LETTER,
  initialsFromName,
  pastelFromName,
} from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { ChannelGlyph } from "./channel-glyph.js";
import { AgentStatusBadge } from "./status-badge.js";

export interface LabelChip {
  kind: "scope" | "topic" | "priority" | "person";
  name: string;
  color: string | null;
}

/** U2 아바타: 사람 사진(있으면) → 이니셜+파스텔 폴백, agent_session 행은 런타임 로고
 * (DESIGN-DIRECTION.md U2 — identities에 사진 필드가 아직 없어 "photo"는 데이터가 들어올 때를 위한 자리). */
export type RowAvatar =
  | { kind: "photo"; url: string; name: string }
  | { kind: "initials"; name: string }
  | { kind: "runtime"; runtime: AgentRuntimeKind };

export interface InboxRowProps {
  /** thread id — U2부터 행은 item이 아니라 thread 하나당 하나다. */
  id: string;
  /** 이름/제목(사람 표시명 → 스레드 제목 → 채널 핸들, Inbox.tsx의 inboxRowTitle). */
  name: string;
  /** 이미 포맷된 상대시간 문자열("3m"/"2w"/"4 Aug" — @omnis/ui/lib/relative-time). */
  timestamp: string;
  /** threads.meta.summary 우선, 없으면 subject/본문 첫 줄(Inbox.tsx의 threadSummary). */
  summary: string;
  /** 마지막 item이 draft 상태면 요약 앞에 "초안: "을 붙인다(A5 §3.1). */
  isDraft: boolean;
  avatar: RowAvatar;
  channel: UiChannel;
  /** null이 아니면 agent_session 행 — 우측 슬롯이 채널 아이콘 대신 상태 배지를 보여준다. */
  agentState: AgentSessionKinsoState | null;
  unread: boolean;
  selected: boolean;
  hasPendingApproval: boolean;
  labels: LabelChip[];
  onSelect: (id: string) => void;
  /** US-A36 행 hover 액션. 없으면 버튼을 그리지 않는다(A5 §3.1 "hover 시 우측에 아이콘 버튼"). */
  onArchive?: (id: string) => void;
  /** 보관된 행이면 액션이 "되살리기"가 된다(A5 §3.8). */
  archived?: boolean;
}

function pickChips(labels: LabelChip[]): { shown: LabelChip[]; more: number } {
  const scope = labels.find((l) => l.kind === "scope");
  const rest = labels.filter((l) => l !== scope);
  // A5 §3.1: 칩은 최대 2개. scope가 없으면 그 자리를 비우지 않고 나머지 라벨로 채운다.
  const shown = (scope ? [scope, ...rest] : rest).slice(0, 2);
  return { shown, more: labels.length - shown.length };
}

function RowAvatarView({ avatar }: { avatar: RowAvatar }) {
  if (avatar.kind === "runtime") {
    // U5: 실제 브랜드 마크가 있는 런타임(Claude/DeepSeek/…)은 그 로고, 없는 런타임(Hermes)은
    // 사람 아바타의 이니셜 폴백과 같은 발상으로 글자 한 글자(RUNTIME_LETTER)를 보여준다.
    const Icon = RUNTIME_ICON[avatar.runtime];
    return (
      <span
        className="inbox-row__avatar inbox-row__avatar--runtime"
        aria-label={`${RUNTIME_LABEL[avatar.runtime]} 세션`}
      >
        {Icon ? <Icon size={16} aria-hidden="true" /> : RUNTIME_LETTER[avatar.runtime]}
      </span>
    );
  }
  if (avatar.kind === "photo") {
    return (
      <span className="inbox-row__avatar" aria-label={avatar.name}>
        <img className="inbox-row__avatar-img" src={avatar.url} alt="" />
      </span>
    );
  }
  return (
    <span
      className="inbox-row__avatar"
      style={{ background: pastelFromName(avatar.name) }}
      aria-label={avatar.name}
    >
      {initialsFromName(avatar.name)}
    </span>
  );
}

export function InboxRow(props: InboxRowProps) {
  const { shown, more } = pickChips(props.labels);
  const summaryText = props.isDraft ? `초안: ${props.summary}` : props.summary;
  return (
    // US-D02: HoverCard.Trigger는 asChild라 이 행 div에 hover 핸들러만 얹는다 — 래퍼 엘리먼트가
    // 생기지 않고 행의 role="option"·클릭·키보드 동작은 그대로다(Radix Slot이 기존 props에 merge).
    // openDelay 400ms는 의도한 지연이다: 이 리스트는 행 높이가 낮아 포인터가 훑고 지나가기 쉽고,
    // 지연이 없으면 카드가 줄줄이 번쩍인다(hover intent). closeDelay는 짧게(100ms) 둬서
    // 행 사이를 옮겨 다닐 때는 카드가 따라오게 한다.
    <HoverCard.Root openDelay={400} closeDelay={100}>
      <HoverCard.Trigger asChild>
        {/* biome-ignore lint/a11y/useSemanticElements: A5 §3.1 listbox/option pattern — <option> is only valid inside <select> and can't hold this row's markup. */}
        <div
          role="option"
          tabIndex={0}
          aria-selected={props.selected}
          className={cn("inbox-row", props.selected && "inbox-row--selected")}
          onClick={() => props.onSelect(props.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onSelect(props.id);
            }
          }}
        >
          <RowAvatarView avatar={props.avatar} />
          <div className="inbox-row__meta">
            <span className="inbox-row__name" data-unread={props.unread}>
              {props.name}
            </span>
            {props.unread && <span className="inbox-row__unread-dot" aria-label="안읽음" />}
            <span className="inbox-row__timestamp">{props.timestamp}</span>
          </div>
          <div className="inbox-row__side">
            {props.agentState ? (
              <AgentStatusBadge state={props.agentState} />
            ) : (
              <span
                className="inbox-row__channel-icon"
                aria-label={`${CHANNEL_LABEL[props.channel]} 메시지`}
              >
                <ChannelGlyph channel={props.channel} size={16} />
              </span>
            )}
            {props.hasPendingApproval && (
              <span className="inbox-row__approval-dot" aria-label="승인 대기" />
            )}
            {props.onArchive && (
              <button
                type="button"
                className="inbox-row__action"
                // 행 전체가 클릭 타깃이라 버블링을 막지 않으면 보관과 동시에 스레드가 열린다.
                onClick={(e) => {
                  e.stopPropagation();
                  props.onArchive?.(props.id);
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {props.archived ? "되살리기" : "보관"}
              </button>
            )}
          </div>
          <div className="inbox-row__summary-line">
            <span className="inbox-row__summary" data-draft={props.isDraft}>
              {summaryText}
            </span>
            <div className="inbox-row__chips">
              {shown.map((chip) => (
                <span
                  key={`${chip.kind}:${chip.name}`}
                  className="inbox-row__chip"
                  aria-label={`${chip.kind} 라벨: ${chip.name}`}
                >
                  {chip.name}
                </span>
              ))}
              {more > 0 && (
                <span className="inbox-row__chip-more" aria-label={`라벨 ${more}개 더 보기`}>
                  +{more}
                </span>
              )}
            </div>
          </div>
        </div>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        {/* 떠 있는 패널이라 유리다(DESIGN-DIRECTION.md "Liquid Glass는 …플로팅 패널에만").
            밀도는 레퍼런스(ref-issue-tracker-density.webp 하단좌측 카드)를 따른다 — 제목 +
            키-값 몇 줄짜리 컴팩트 카드지 상세 패널이 아니다. */}
        <HoverCard.Content
          className="glass-surface row-hover-card"
          data-glass-slot="sheet"
          side="right"
          align="start"
          sideOffset={8}
        >
          <p className="row-hover-card__title">{props.name}</p>
          {/* ponytail: 아직 "참여자 목록" 데이터 모델이 없다 — 여기서 말하는 참여자는 행이 아는
              단 하나의 이름(props.name)이고, 그래서 제목과 같은 값이 한 번 더 나온다. 스레드가
              진짜 참여자 배열을 갖게 되면 이 한 줄만 갈아 끼우면 된다. */}
          <dl className="row-hover-card__meta">
            <div>
              <dt>참여자</dt>
              <dd>{props.name}</dd>
            </div>
            {props.labels.length > 0 && (
              <div>
                <dt>라벨</dt>
                <dd>{props.labels.map((l) => l.name).join(", ")}</dd>
              </div>
            )}
            <div>
              <dt>마지막 활동</dt>
              <dd>{props.timestamp}</dd>
            </div>
          </dl>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
