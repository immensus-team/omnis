import { CommandPalette, type PaletteAction } from "@omnis/ui";
import { useState } from "react";

const ACTIONS: PaletteAction[] = [
  { id: "archive", name: "Archive thread", shortcut: "E", group: "Inbox", perform: () => {} },
  { id: "read", name: "Mark as read", shortcut: "U", group: "Inbox", perform: () => {} },
  { id: "snooze", name: "Snooze until tomorrow", group: "Inbox", perform: () => {} },
  { id: "new-draft", name: "New draft", shortcut: "C", group: "Compose", perform: () => {} },
  { id: "send", name: "Send", shortcut: "⌘↵", group: "Compose", perform: () => {} },
  { id: "discard", name: "Discard draft", group: "Compose", perform: () => {} },
];

/** 두 인스턴스가 각자 open 상태를 갖는다 — 한쪽을 닫아도 다른 쪽은 그대로다.
 *  inline은 기본 open=true라 정적 스크린샷에도 내용이 잡힌다. dialog는 고정 오버레이라
 *  기본 열림이면 갤러리 전체를 덮으므로 버튼으로 연다. */
export function CommandPaletteDemo() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inlineOpen, setInlineOpen] = useState(true);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <section>
        <h3>dialog mode</h3>
        <button type="button" onClick={() => setDialogOpen(true)}>
          Open ⌘K dialog
        </button>
        <CommandPalette open={dialogOpen} onOpenChange={setDialogOpen} actions={ACTIONS} />
      </section>
      <section>
        <h3>inline mode</h3>
        <CommandPalette
          mode="inline"
          open={inlineOpen}
          onOpenChange={setInlineOpen}
          actions={ACTIONS}
        />
      </section>
    </div>
  );
}
