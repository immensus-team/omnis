import { CHANNEL_BRAND_ASSET } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";

/** U5 kinso polish: channel-rail.tsx(레일 타일)와 inbox-row.tsx(행 우측 아이콘)가 똑같이 필요한
 * "브랜드 마크" 렌더링을 한 곳에 둔다 — 두 파일에 로직을 복붙하면 다음에 채널 하나 늘 때마다 두
 * 군데를 같이 고쳐야 한다.
 * US-D02b: react-icons 단색 아이콘 + 브랜드 hex 틴트 + KakaoTalk 타일 배경을 전부 걷어내고
 * 실제 브랜드 PNG를 그대로 띄운다. PNG에 타일·둥근 모서리가 이미 들어 있어 배경 타일로 한 번 더
 * 감싸면 이중 프레임이 되고, 래스터 PNG에 CSS color를 입히는 건 아무 효과가 없다. */
export function ChannelGlyph({ channel, size = 16 }: { channel: UiChannel; size?: number }) {
  const { at1x, at2x } = CHANNEL_BRAND_ASSET[channel];
  return (
    <img
      src={at1x}
      srcSet={`${at1x} 1x, ${at2x} 2x`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      // Gmail(64×51)·Outlook(64×59)은 정사각이 아니다 — 정사각 슬롯에 그대로 밀어 넣으면
      // Gmail이 25% 늘어난다. 슬롯은 size×size로 고정한 채 마크만 안쪽에 맞춘다.
      style={{ objectFit: "contain" }}
    />
  );
}
