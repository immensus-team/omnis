import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Inbox as InboxGlyph, Settings, User } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn.js";
import { CHANNEL_LABEL } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { ChannelGlyph } from "./channel-glyph.js";
import { GlassSurface } from "./glass-surface.js";

// U2: the channel labels (CHANNEL_LABEL) live in lib/row-meta.ts — shared with inbox-row.tsx
// (keeping them here made a circular import). US-D02b: the mark itself is ChannelGlyph's job
// (lib/row-meta.ts CHANNEL_BRAND_ASSET), so both files render it the same way.

/** null = "Inbox" 타일(전체 보기). Agents 타일도 다른 채널 타일과 같은 필터 문법
 *  (레일 선택 = channelFilter)을 쓰되, 계정 연결 여부와 무관한 레일 고정 요소다. */
export type RailSelection = UiChannel | null;

export interface ChannelRailProps {
  /** 연결된 채널(계정) 목록, 중복 제거된 상태로 표시 순서대로. */
  channels: UiChannel[];
  selected: RailSelection;
  onSelect: (selection: RailSelection) => void;
}

/** US-D02b: 레일이 하단 바로 접히는 좁은 셸의 브레이크포인트. app.css의
 *  `@container shell (max-width: 899.98px)`와 **같은 숫자여야 한다** — React는 CSS 컨테이너
 *  쿼리의 결과를 읽을 수 없어서(창 폭도, 셸 박스 폭도 아니다) 같은 값을 두 곳에 적는다.
 *  이 슬라이스에서는 리터럴을 CSS와 TS가 공유하지 않는다: 값을 바꿀 땐 두 파일을 같이 본다. */
const NARROW_RAIL_QUERY = "(max-width: 899.98px)";

/** 하단 바에 서는 `tiles` 개수 상한 — Inbox 타일은 별도라 여기 안 센다. */
const NARROW_RAIL_TILE_LIMIT = 4;

/** matchMedia는 jsdom에 없다 — 없으면 넓은 셸로 떨어진다(command-palette.tsx의 panelExitMs와
 *  같은 방어). 넓은 티어는 지금까지의 레일 그대로라 테스트가 보는 것도 그쪽이고, 좁은 티어는
 *  CSS 컨테이너 쿼리와 실브라우저가 본다. */
function mediaQuery(query: string): MediaQueryList | null {
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

function useNarrowRail(): boolean {
  const [narrow, setNarrow] = useState(() => mediaQuery(NARROW_RAIL_QUERY)?.matches ?? false);
  useEffect(() => {
    const mq = mediaQuery(NARROW_RAIL_QUERY);
    if (!mq) return;
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function ChannelRail({ channels, selected, onSelect }: ChannelRailProps) {
  // Agents는 연결된 계정이 아니라 레일 고정 타일이다 — agent 계정이 있으면 그 자리를 그대로 쓴다.
  const tiles = channels.includes("agent") ? channels : [...channels, "agent" as const];
  const narrow = useNarrowRail();
  // 좁은 셸: 바에는 타일 4개까지만. 나머지 타일과 아바타/설정은 More 팝오버로 내려간다 —
  // 320px 바에 타일을 계속 밀어 넣으면 마지막 타일이 화면 밖으로 나간다(가로 스크롤 금지).
  const barTiles = narrow ? tiles.slice(0, NARROW_RAIL_TILE_LIMIT) : tiles;

  return (
    <nav className="channel-rail" aria-label="Channels">
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
          안쪽 타일은 그대로 위에 남는다 — 유리 위에서도 브랜드 색 아이콘은 읽힌다.
          US-D02b: 좁은 셸에서는 이 플레이트가 하단 바를 채우는 한 줄로 눕고(app.css), 유리는
          바 자신이 가져간다 — 유리 위에 유리를 겹치지 않으려고 여기서는 벗긴다. */}
      <GlassSurface slot="sidebar" className="channel-rail__plate">
        {barTiles.map((channel) => (
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
        {narrow ? (
          <RailOverflowPopover
            tiles={tiles.slice(NARROW_RAIL_TILE_LIMIT)}
            selected={selected}
            onSelect={onSelect}
          />
        ) : (
          // ponytail: 넓은 셸에서 더보기 chevron은 kinso 레일의 시각 요소일 뿐 — 접을 게 없으니
          // 동작도 없다(오버플로 메뉴는 바가 좁아지는 티어에만 붙는다).
          <button type="button" className="channel-rail__more" aria-label="More">
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}
      </GlassSurface>
      {narrow ? null : (
        <>
          <div className="channel-rail__spacer" />
          {/* ponytail: 아바타는 아직 프로필 화면이 없어 장식용 자리표시자. Settings 화면이 생기면
              둘 다 연결(좁은 셸에서는 아래 팝오버 안 같은 자리표시자 행이 그 역할을 한다). */}
          <button
            type="button"
            className="channel-rail__tile channel-rail__avatar"
            aria-label="Account"
          >
            <User size={16} aria-hidden="true" />
          </button>
          <button type="button" className="channel-rail__icon-button" aria-label="Settings">
            <Settings size={16} aria-hidden="true" />
          </button>
        </>
      )}
    </nav>
  );
}

/** 좁은 셸 전용 More 팝오버: 바에 못 선 타일들 + 아바타/설정. 44px 바 타일과 달리 여기는
 *  글자를 놓을 자리가 있어 아이콘 옆에 라벨을 붙인다(무슨 타일인지 아이콘만으론 알 수 없다).
 *  Radix Popover 문법은 filter-chip-bar.tsx의 AddFilterPopover와 같은 한 벌이다 — 떠 있는 패널을
 *  만드는 두 번째 방법을 이 저장소에 만들지 않는다. */
function RailOverflowPopover({
  tiles,
  selected,
  onSelect,
}: {
  tiles: UiChannel[];
  selected: RailSelection;
  onSelect: (selection: RailSelection) => void;
}) {
  // 채널을 고르면 닫는다(AddFilterPopover는 다중 선택이라 열어 두지만 여긴 하나 고르면 끝이다).
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="channel-rail__more" aria-label="More" title="More">
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="glass-surface channel-rail__popover"
          data-glass-slot="palette"
          side="top"
          align="center"
          sideOffset={8}
        >
          {tiles.map((channel) => (
            <button
              key={channel}
              type="button"
              className="channel-rail__popover-row"
              aria-pressed={selected === channel}
              onClick={() => {
                onSelect(channel);
                setOpen(false);
              }}
            >
              <ChannelGlyph channel={channel} size={18} />
              <span>{CHANNEL_LABEL[channel]}</span>
            </button>
          ))}
          {/* 넓은 셸에서 바닥에 서던 둘 — 여기서도 아직 화면이 없어 자리표시자다. */}
          <button type="button" className="channel-rail__popover-row">
            <User size={18} aria-hidden="true" />
            <span>Account</span>
          </button>
          <button type="button" className="channel-rail__popover-row">
            <Settings size={18} aria-hidden="true" />
            <span>Settings</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
