import { cn } from "../lib/cn.js";

// Task 4가 여기 로컬로 선언했던 UiChannel/UiItemStatus는 Task 5(US-A27)에서 ../types.ts로 옮겼다.
// Task 4의 apps/desktop/src/screens/Inbox.tsx가 이미 이 모듈 경로("@omnis/ui/components/inbox-row")에서
// 두 타입을 import하므로, 여기서 재export하지 않으면 그 import가 깨진다. 이 파일 안에서도 아래
// CHANNEL_LABEL/InboxRowProps가 두 타입을 쓰므로 import type으로 로컬 바인딩도 함께 가져온다
// (export type { X } from "mod" 단독으로는 re-export만 되고 로컬 스코프에 X가 들어오지 않는다).
import type { UiChannel, UiItemStatus } from "../types.js";
export type { UiChannel, UiItemStatus };

export interface LabelChip {
  kind: "scope" | "topic" | "priority" | "person";
  name: string;
  color: string | null;
}

export interface InboxRowProps {
  id: string;
  title: string;
  preview: string;
  channel: UiChannel;
  timestamp: string;
  status: UiItemStatus;
  unread: boolean;
  selected: boolean;
  hasPendingApproval: boolean;
  labels: LabelChip[];
  onSelect: (id: string) => void;
}

const CHANNEL_LABEL: Record<UiChannel, string> = {
  slack: "Slack",
  gmail: "Gmail",
  gcal: "Google Calendar",
  outlook: "Outlook",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  kakaotalk: "KakaoTalk",
  linkedin: "LinkedIn",
  agent: "Agent",
  system: "System",
};

function pickChips(labels: LabelChip[]): { shown: LabelChip[]; more: number } {
  const scope = labels.find((l) => l.kind === "scope");
  const rest = labels.filter((l) => l !== scope);
  // A5 §3.1: 칩은 최대 2개. scope가 없으면 그 자리를 비우지 않고 나머지 라벨로 채운다.
  const shown = (scope ? [scope, ...rest] : rest).slice(0, 2);
  return { shown, more: labels.length - shown.length };
}

export function InboxRow(props: InboxRowProps) {
  const { shown, more } = pickChips(props.labels);
  const previewText = props.status === "draft" ? `초안: ${props.preview}` : props.preview;
  return (
    // biome-ignore lint/a11y/useSemanticElements: A5 §3.1 listbox/option pattern — <option> is only valid inside <select> and can't hold this row's markup.
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
      <div className="inbox-row__meta">
        <span className="inbox-row__title">{props.title}</span>
        <span className="inbox-row__timestamp">{props.timestamp}</span>
      </div>
      <div className="inbox-row__preview" data-draft={props.status === "draft"}>
        {previewText}
      </div>
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
      <div className="inbox-row__channel" aria-label={`${CHANNEL_LABEL[props.channel]} 메시지`}>
        {props.unread && <span className="inbox-row__unread" aria-label="안읽음" />}
        {props.hasPendingApproval && <span className="inbox-row__approval-dot" />}
      </div>
    </div>
  );
}
