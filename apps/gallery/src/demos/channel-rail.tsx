import { ChannelRail, type RailScreen, type UiChannel } from "@omnis/ui";
import { useState } from "react";

/** 3 connected accounts. The "agent" tile is added by the component itself, so it isn't passed in.
 *  selected=null is the Inbox tile's active state — clicking actually moves the pressed state. */
const CHANNELS: UiChannel[] = ["slack", "gmail", "linkedin"];

export function ChannelRailDemo() {
  const [selected, setSelected] = useState<UiChannel | null>(null);
  // Both halves of the rail's navigation are real here, so the screen tiles move their own
  // aria-current the way the shell moves it — a demo that only looked right would be the
  // disabled-lookalike problem the tiles were built to fix.
  const [screen, setScreen] = useState<RailScreen>("inbox");
  return (
    <div style={{ height: 320, display: "flex" }}>
      <ChannelRail
        channels={CHANNELS}
        selected={selected}
        onSelect={setSelected}
        screen={screen}
        onScreenChange={setScreen}
      />
    </div>
  );
}
