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
  const [askOpen, setAskOpen] = useState(false);
  const [railChannel, setRailChannel] = useState<RailSelection>(null);
  // US-D01 결정: ⌘K는 별도 모달 팔레트가 아니라 ask 바의 플로팅 AI 패널을 연다. 같은 액션 목록을
  // 두 표면(모달 + 패널)에 각각 띄우면 어느 쪽이 진짜인지 알 수 없다 — 하나로 모은다.
  // CommandPalette mode="dialog" 자체는 @omnis/ui에 남아 있고 테스트도 그대로다(셸이 안 쓴다).
  useCommandPaletteKey(() => setAskOpen((v) => !v));

  // 승인은 Zero로 읽고(읽기 전용 경로) 결정만 허브 HTTP로 보낸다 — 계약 §5.
  const [approvals] = useQuery(zero.query.pending_approvals.where("state", "=", "pending"));
  const [accounts] = useQuery(zero.query.accounts);

  // US-D01: 선택된 스레드의 AI 요약(threads.meta.summary — T1 요약 루프가 채운다, packages/agents).
  // 새 백엔드 호출이 필요 없다: Thread.tsx가 archived_at을 읽는 것과 같은 쿼리 모양이다.
  // 선택이 없으면 빈 문자열로 질의한다(빈 결과) — 훅 개수를 조건부로 바꿀 수 없어서다.
  const [selectedThreadRows] = useQuery(zero.query.threads.where("id", "=", open?.threadId ?? ""));
  const selectedThread = (
    selectedThreadRows as unknown as {
      title?: string | null;
      meta?: { summary?: string } | null;
    }[]
  )[0];
  const selectedThreadSummary = selectedThread?.meta?.summary ?? null;
  const selectedThreadTitle = selectedThread?.title ?? null;

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
        <CommandPalette
          mode="inline"
          open={askOpen}
          onOpenChange={setAskOpen}
          actions={actions}
          threadSelected={open !== null}
          threadSummary={selectedThreadSummary}
          threadTitle={selectedThreadTitle}
        />
        <Inbox
          onOpen={setOpen}
          channelFilter={railChannel}
          onChannelFilterChange={setRailChannel}
        />
      </div>
      {/* US-D02b: 상세 패널은 폭과 무관하게 시트 유리를 달고 나온다 — 좁은 셸(≤1279.98px)에서는
          이게 실제 모습이고(리스트 위에 뜬 유리 시트), 넓은 셸에서는 app.css의
          `@container shell (min-width: 1280px)`가 유리를 벗겨 지금의 불투명 칼럼으로 되돌린다.
          폭에 따라 JS가 분기하지 않으면 고칠 곳이 한 군데뿐이다. */}
      {detail && (
        <section
          data-testid="detail-pane"
          className="app-shell__detail glass-surface"
          data-glass-slot="sheet"
        >
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
    </main>
  );
}
