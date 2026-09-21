import { CHANNEL_BRAND_ASSET } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";

/** U5 kinso polish: one place to render a brand mark, which channel-rail.tsx (rail tiles) and
 * inbox-row.tsx (the row's right-hand mark) both need — copied into two files, every new channel
 * would mean editing both.
 * US-D02b: the monochrome react-icons glyph, the brand-hex tint and the KakaoTalk tile background
 * are all gone; the real brand PNG is shown as-is. The PNGs already carry their own tiles and
 * rounded corners, so wrapping one in a background tile double-frames it, and a CSS colour on a
 * raster PNG does nothing at all. */
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
      // An <img> is natively draggable, and Chromium starts an HTML5 image drag once the pointer
      // passes a few px — which cancels the pointer sequence underneath it. Every caller here is a
      // drag surface now (the rail's reorder in D7, the row's swipe in D8), and the glyph covers
      // most of the tile's area, so the native drag has to go: without this, a press on the mark
      // loses its capture on the first move and the gesture never starts. `-webkit-user-drag`
      // would be a rail-only patch for a bug that belongs to the image.
      draggable={false}
      // Gmail (64x51) and Outlook (64x59) are not square — dropped straight into a square slot,
      // Gmail stretches by 25%. The slot stays size x size and the mark fits inside it.
      style={{ objectFit: "contain" }}
    />
  );
}
