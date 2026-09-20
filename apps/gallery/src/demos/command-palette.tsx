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

/** The two instances each hold their own open state — closing one leaves the other untouched.
 *  inline defaults to open=true so the static screenshot captures content. dialog is a fixed
 *  overlay that would cover the whole gallery if it defaulted open, so it's opened via a button. */
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
