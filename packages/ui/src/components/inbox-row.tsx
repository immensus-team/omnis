import { cn } from "../lib/cn.js";

/** protocol Channel enum의 리터럴을 미러링(패키지 경계 판정 참고 — @omnis/protocol import 안 함). */
export type UiChannel =
  | "slack"
  | "gmail"
  | "gcal"
  | "outlook"
  | "telegram"
  | "whatsapp"
  | "kakaotalk"
  | "linkedin"
  | "agent"
  | "system";
export type UiItemStatus =
  | "received"
  | "read"
  | "draft"
  | "approved"
  | "sent"
  | "failed"
  | "archived";

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
  const shown = [scope, rest[0]].filter((l): l is LabelChip => Boolean(l)).slice(0, 2);
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
            key={chip.kind}
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
