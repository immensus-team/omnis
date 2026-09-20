import { ChannelRail, type UiChannel } from "@omnis/ui";
import { useState } from "react";

/** 연결된 계정 3개. "agent" 타일은 컴포넌트가 스스로 붙이므로 넘기지 않는다.
 *  selected=null이 Inbox 타일 active 상태 — 클릭하면 pressed가 실제로 옮겨간다. */
const CHANNELS: UiChannel[] = ["slack", "gmail", "linkedin"];

export function ChannelRailDemo() {
  const [selected, setSelected] = useState<UiChannel | null>(null);
  return (
    <div style={{ height: 320, display: "flex" }}>
      <ChannelRail channels={CHANNELS} selected={selected} onSelect={setSelected} />
    </div>
  );
}
