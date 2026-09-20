import { CHANNEL_COLOR, CHANNEL_ICON, CHANNEL_TILE_BG } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";

/** U5 kinso polish: channel-rail.tsx(레일 타일)와 inbox-row.tsx(행 우측 아이콘)가 똑같이 필요한
 * "브랜드 컬러 아이콘" 렌더링을 한 곳에 둔다 — 두 파일에 색 로직을 복붙하면 다음에 채널 하나
 * 늘 때마다 두 군데를 같이 고쳐야 한다. KakaoTalk만 배경 타일(CHANNEL_TILE_BG)이 붙는다. */
export function ChannelGlyph({ channel, size = 16 }: { channel: UiChannel; size?: number }) {
  const Icon = CHANNEL_ICON[channel];
  const tileBg = CHANNEL_TILE_BG[channel];
  if (tileBg) {
    return (
      <span className="channel-glyph channel-glyph--tiled" style={{ background: tileBg }}>
        <Icon size={size * 0.7} aria-hidden="true" style={{ color: CHANNEL_COLOR[channel] }} />
      </span>
    );
  }
  return <Icon size={size} aria-hidden="true" style={{ color: CHANNEL_COLOR[channel] }} />;
}
