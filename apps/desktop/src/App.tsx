import { type ApprovalCardInterrupt, CommandPalette, type PaletteAction } from "@omnis/ui";
import { ZeroProvider, useQuery } from "@rocicorp/zero/react";
import { useEffect, useState } from "react";
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
  useCommandPaletteKey(() => setPaletteOpen((v) => !v));

  // 승인은 Zero로 읽고(읽기 전용 경로) 결정만 허브 HTTP로 보낸다 — 계약 §5.
  const [approvals] = useQuery(zero.query.pending_approvals.where("state", "=", "pending"));

  const actions: PaletteAction[] = [
    {
      id: "go-inbox",
      name: "Inbox로 이동",
      shortcut: "g i",
      group: "이동",
      perform: () => setOpen(null),
    },
  ];

  return (
    <main data-testid="app-shell" className="app-shell">
      <Inbox onOpen={setOpen} />
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
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={actions} />
    </main>
  );
}
