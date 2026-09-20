import { ChevronDown, Inbox as InboxGlyph, Settings, User } from "lucide-react";
import { cn } from "../lib/cn.js";
import { CHANNEL_LABEL } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { ChannelGlyph } from "./channel-glyph.js";
import { GlassSurface } from "./glass-surface.js";

// U2: 브랜드 아이콘 맵(CHANNEL_ICON)과 한글 라벨(CHANNEL_LABEL)은 이제 lib/row-meta.ts 공용이다
// (inbox-row.tsx도 U2에서 같은 아이콘이 필요해져 여기 두면 순환 import가 생긴다). U5: 실제 색은
// ChannelGlyph(channel-glyph.tsx)가 CHANNEL_COLOR에서 입힌다 — inbox-row.tsx와 공유.

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
      {/* US-D01: 플레이트는 불투명 흰색이었고, 그래서 "캔버스 위에 얹힌 판"으로만 읽혔다.
          이제 진짜 유리다(blur + saturate + 틴트 + 안쪽 하이라이트 + 소프트 섀도 = .glass-surface).
          안쪽 타일은 그대로 위에 남는다 — 유리 위에서도 브랜드 색 아이콘은 읽힌다. */}
      <GlassSurface slot="sidebar" className="channel-rail__plate">
        {tiles.map((channel) => (
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
            <ChannelGlyph channel={channel} size={18} />
          </button>
        ))}
        {/* ponytail: 더보기 chevron은 kinso 레일의 시각 요소일 뿐 — 채널이 늘어나 접어야 할 때까지
            동작 없음(오버플로 메뉴는 그 시점에 추가). */}
        <button type="button" className="channel-rail__more" aria-label="더 보기">
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </GlassSurface>
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
