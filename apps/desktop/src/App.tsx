import {
  type ApprovalCardInterrupt,
  ChannelRail,
  CommandPalette,
  type PaletteAction,
  type RailSelection,
  type UiChannel,
} from "@omnis/ui";
import { ZeroProvider, useQuery } from "@rocicorp/zero/react";
import { useEffect, useMemo, useState } from "react";
import { ApprovalCard } from "./components/ApprovalCard.js";
import { AgentSession } from "./screens/AgentSession.js";
import { Inbox, type OpenTarget } from "./screens/Inbox.js";
import { Thread } from "./screens/Thread.js";
import { initZero, useZeroClient } from "./zero-client.js";

// 모듈 스코프에서 만들면 App을 import만 해도 WebSocket이 열린다 — 첫 렌더까지 미룬다.
let zeroClient: ReturnType<typeof initZero> | undefined;
function getZero() {
  zeroClient ??= initZero();
  return zeroClient;
}

/** A5 §2.4의 키맵(useKeymap)은 수식키가 붙은 입력을 의도적으로 무시하므로 ⌘K는 셸이 직접 받는다. */
function useCommandPaletteKey(toggle: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}

export function App() {
  // ZeroProvider가 없으면 useQuery가 "useZero must be used within a ZeroProvider"로 죽는다.
  return (
    <ZeroProvider zero={getZero()}>
      <Shell />
    </ZeroProvider>
  );
}

function Shell() {
  const zero = useZeroClient();
  const [open, setOpen] = useState<OpenTarget | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [railChannel, setRailChannel] = useState<RailSelection>(null);
  useCommandPaletteKey(() => setPaletteOpen((v) => !v));

  // 승인은 Zero로 읽고(읽기 전용 경로) 결정만 허브 HTTP로 보낸다 — 계약 §5.
  const [approvals] = useQuery(zero.query.pending_approvals.where("state", "=", "pending"));
  const [accounts] = useQuery(zero.query.accounts);

  // U1 채널 레일: 연결된 계정의 채널을 중복 없이, 처음 등장한 순서대로.
  const connectedChannels = useMemo(() => {
    const seen = new Set<UiChannel>();
    const list: UiChannel[] = [];
    for (const a of accounts) {
      const channel = a.channel as UiChannel;
      if (!seen.has(channel)) {
        seen.add(channel);
        list.push(channel);
      }
    }
    return list;
  }, [accounts]);

  const actions: PaletteAction[] = [
    {
      id: "go-inbox",
      name: "Inbox로 이동",
      shortcut: "g i",
      group: "이동",
      perform: () => {
        setOpen(null);
        setRailChannel(null);
      },
    },
  ];

  // kinso 레퍼런스는 레일 + 메인 컬럼 둘뿐이다 — 상세 패널은 볼 게 생겼을 때만 세 번째 칼럼을 연다.
  // (빈 패널을 늘 띄워두면 Inbox 카드가 창의 1/3짜리 사이드바로 쪼그라든다.)
  const detail = open !== null || approvals.length > 0;

  return (
    <main
      data-testid="app-shell"
      className={detail ? "app-shell app-shell--with-detail" : "app-shell"}
    >
      <ChannelRail channels={connectedChannels} selected={railChannel} onSelect={setRailChannel} />
      <div className="app-shell__main">
        <CommandPalette mode="inline" open={askOpen} onOpenChange={setAskOpen} actions={actions} />
        <Inbox onOpen={setOpen} channelFilter={railChannel} />
      </div>
      {detail && (
        <section data-testid="detail-pane" className="app-shell__detail">
          {approvals.map((a) => (
            <ApprovalCard key={a.id} id={a.id} interrupt={a as unknown as ApprovalCardInterrupt} />
          ))}
          {open === null ? null : open.agentSession ? (
            <AgentSession sessionThreadId={open.threadId} />
          ) : (
            <Thread threadId={open.threadId} />
          )}
        </section>
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={actions} />
    </main>
  );
}
