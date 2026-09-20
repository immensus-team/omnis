import { ChannelRail, type UiChannel } from "@omnis/ui";
import { useState } from "react";

/** 3 connected accounts. The "agent" tile is added by the component itself, so it isn't passed in.
 *  selected=null is the Inbox tile's active state — clicking actually moves the pressed state. */
const CHANNELS: UiChannel[] = ["slack", "gmail", "linkedin"];

export function ChannelRailDemo() {
  const [selected, setSelected] = useState<UiChannel | null>(null);
  return (
    <div style={{ height: 320, display: "flex" }}>
      <ChannelRail channels={CHANNELS} selected={selected} onSelect={setSelected} />
    </div>
  );
}
