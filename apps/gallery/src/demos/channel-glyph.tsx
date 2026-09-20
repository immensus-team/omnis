import type { UiChannel } from "@omnis/ui";
import { ChannelGlyph } from "@omnis/ui/components/channel-glyph";
import { CHANNEL_LABEL } from "@omnis/ui/lib/row-meta";

/** ChannelGlyph is not re-exported from the package root — subpath export only.
 *  Exhaustive array typed `UiChannel[]`, so adding a channel to types.ts breaks typecheck here. */
const CHANNELS: UiChannel[] = [
  "slack",
  "gmail",
  "gcal",
  "outlook",
  "telegram",
  "whatsapp",
  "kakaotalk",
  "linkedin",
  "agent",
  "system",
];

export function ChannelGlyphDemo() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      {CHANNELS.map((channel) => (
        <div
          key={channel}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            width: 72,
          }}
        >
          <ChannelGlyph channel={channel} size={24} />
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", textAlign: "center" }}>
            {CHANNEL_LABEL[channel]}
          </span>
        </div>
      ))}
    </div>
  );
}
