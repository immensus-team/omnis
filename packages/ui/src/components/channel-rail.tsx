import { ChevronDown, Inbox as InboxGlyph, Settings, Sparkles, User } from "lucide-react";
import type { ElementType } from "react";
import { FaLinkedin, FaSlack } from "react-icons/fa6";
import { PiMicrosoftOutlookLogo } from "react-icons/pi";
import { SiGmail, SiGooglecalendar, SiKakaotalk, SiTelegram, SiWhatsapp } from "react-icons/si";
import { cn } from "../lib/cn.js";
import type { UiChannel } from "../types.js";
import { CHANNEL_LABEL } from "./inbox-row.js";

/** U1: kinso 좌측 레일의 브랜드 마크. simple-icons(react-icons/si)에 Slack/LinkedIn/Outlook 로고가
 *  없어(상표 정책으로 빠짐) fa6/pi에서 채운다 — "직접 만들지 않는다" 원칙은 세트 하나로 못 지킨다.
 *  ElementType(제네릭 없이): lucide와 react-icons가 각자 다른 propTypes 제네릭을 선언해
 *  props를 좁혀 통일하면 exactOptionalPropertyTypes가 구조적으로 튕긴다. */
const CHANNEL_ICON: Record<UiChannel, ElementType> = {
  gmail: SiGmail,
  slack: FaSlack,
  linkedin: FaLinkedin,
  whatsapp: SiWhatsapp,
  telegram: SiTelegram,
  kakaotalk: SiKakaotalk,
  outlook: PiMicrosoftOutlookLogo,
  gcal: SiGooglecalendar,
  agent: Sparkles,
  system: Sparkles,
};

/** null = "Inbox" 타일(전체 보기). Agents 타일도 다른 채널 타일과 같은 필터 문법
 *  (레일 선택 = channelFilter)을 쓰되, 계정 연결 여부와 무관한 레일 고정 요소다. */
export type RailSelection = UiChannel | null;

export interface ChannelRailProps {
  /** 연결된 채널(계정) 목록, 중복 제거된 상태로 표시 순서대로. */
  channels: UiChannel[];
  selected: RailSelection;
  onSelect: (selection: RailSelection) => void;
}

export function ChannelRail({ channels, selected, onSelect }: ChannelRailProps) {
  // Agents는 연결된 계정이 아니라 레일 고정 타일이다 — agent 계정이 있으면 그 자리를 그대로 쓴다.
  const tiles = channels.includes("agent") ? channels : [...channels, "agent" as const];
  return (
    <nav className="channel-rail" aria-label="채널">
      <button
        type="button"
        className={cn("channel-rail__tile", "channel-rail__tile--inbox")}
        aria-pressed={selected === null}
        aria-label="Inbox"
        onClick={() => onSelect(null)}
      >
        <InboxGlyph size={18} aria-hidden="true" />
      </button>
      <div className="channel-rail__plate">
        {tiles.map((channel) => {
          const Icon = CHANNEL_ICON[channel];
          return (
            <button
              key={channel}
              type="button"
              className={cn(
                "channel-rail__tile",
                selected === channel && "channel-rail__tile--active",
              )}
              aria-pressed={selected === channel}
              aria-label={CHANNEL_LABEL[channel]}
              onClick={() => onSelect(channel)}
            >
              <Icon size={18} aria-hidden="true" />
            </button>
          );
        })}
        {/* ponytail: 더보기 chevron은 kinso 레일의 시각 요소일 뿐 — 채널이 늘어나 접어야 할 때까지
            동작 없음(오버플로 메뉴는 그 시점에 추가). */}
        <button type="button" className="channel-rail__more" aria-label="더 보기">
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="channel-rail__spacer" />
      {/* ponytail: 아바타는 아직 프로필 화면이 없어 장식용 자리표시자. Settings 화면이 생기면 둘 다 연결. */}
      <button type="button" className="channel-rail__tile channel-rail__avatar" aria-label="계정">
        <User size={16} aria-hidden="true" />
      </button>
      <button type="button" className="channel-rail__icon-button" aria-label="설정">
        <Settings size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}
