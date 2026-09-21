import { Command } from "cmdk";
import { AtSign, ChevronDown, Paperclip } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ASK_MODELS,
  type AskModelId,
  askModelLabel,
  readAskModel,
  writeAskModel,
} from "../lib/ask-model.js";
import { useClosingSpring } from "../lib/motion.js";
import { AskPanel } from "./ask-panel.js";
import { GlassSurface } from "./glass-surface.js";

export interface PaletteAction {
  id: string;
  name: string;
  shortcut?: string;
  group: string;
  perform: () => void;
}

export function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteAction[];
  /** "dialog" (the default) is the existing ⌘K modal. "inline" is U1's kinso ask/search pill bar —
   *  since US-D01 this bar expands downward into the floating AI panel (AskPanel). The palette is
   *  never built twice. */
  mode?: "dialog" | "inline";
  placeholder?: string;
  /** US-D01: "Summarize this thread" only comes alive when a thread is selected (App.tsx's `open`). */
  threadSelected?: boolean;
  /** US-D01: threads.meta.summary — when it is null the panel says "No summary yet". */
  threadSummary?: string | null;
  /** US-D01: threads.title — the panel's context line. */
  threadTitle?: string | null;
}

/** A5 §2.3: kbar-pattern actions ({id,name,shortcut,perform}) grouped by their `group` and rendered
 *  into GlassSurface(slot="palette"). */
export function CommandPalette({
  open,
  onOpenChange,
  actions,
  mode = "dialog",
  placeholder,
  threadSelected = false,
  threadSummary = null,
  threadTitle = null,
}: CommandPaletteProps) {
  const groups = groupBy(actions, (a) => a.group);
  const resultList = (
    <Command.List>
      <Command.Empty>No results</Command.Empty>
      {Object.entries(groups).map(([group, items]) => (
        <Command.Group key={group} heading={group}>
          {items.map((action) => (
            <Command.Item
              key={action.id}
              onSelect={() => {
                action.perform();
                onOpenChange(false);
              }}
            >
              <span>{action.name}</span>
              {action.shortcut && <kbd>{action.shortcut}</kbd>}
            </Command.Item>
          ))}
        </Command.Group>
      ))}
    </Command.List>
  );

  if (mode === "inline") {
    return (
      <InlinePalette
        open={open}
        onOpenChange={onOpenChange}
        placeholder={placeholder ?? "Start typing to ask or search"}
        commands={resultList}
        threadSelected={threadSelected}
        threadSummary={threadSummary}
        threadTitle={threadTitle}
      />
    );
  }

  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="omnis command palette">
      <GlassSurface slot="palette">
        <Command.Input placeholder={placeholder ?? "Search or run a command…"} />
        {resultList}
      </GlassSurface>
    </Command.Dialog>
  );
}

/** The inline mode is a Command inside the document flow, not a Command.Dialog — the Escape and
 *  outside-click-to-close behaviour a modal gets for free has to be wired up here.
 *
 *  US-D01 shape: one Command root owns both the bar's input and the panel's command list. That is
 *  what keeps "type in the bar → the command list filters" true; moving the input into the panel
 *  would split cmdk's search state in two and break it silently. */
function InlinePalette({
  open,
  onOpenChange,
  placeholder,
  commands,
  threadSelected,
  threadSummary,
  threadTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  commands: ReactNode;
  threadSelected: boolean;
  threadSummary: string | null;
  threadTitle: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // cmdk's Input is controlled here because the @ button has to post an "@" into the input.
  // Search state is still owned by this one Command root (bar input = the panel command list's filter).
  const [query, setQuery] = useState("");
  const closing = useClosingSpring(open);
  // Nothing is focused when ⌘K opens it — you have to be able to type straight away (the palette's
  // basic promise), and the Escape/typing handlers only fire while focus is inside the Command root.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  return (
    <Command
      ref={ref}
      className="ask-bar"
      label="omnis ask/search"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onOpenChange(false);
        }
      }}
    >
      <GlassSurface slot="toolbar" className="ask-bar__pill">
        <span className="ask-bar__orb" aria-hidden="true" />
        <Command.Input
          ref={inputRef}
          placeholder={placeholder}
          value={query}
          // Focus coming back while it is already open (⌘K's own autofocus included) is not a state change.
          onFocus={() => {
            if (!open) onOpenChange(true);
          }}
          onValueChange={(value) => {
            setQuery(value);
            onOpenChange(true);
          }}
        />
        {/* Composer affordances that only appear once the bar is expanded. Closed, the bar is kinso
            exactly as it is in the reference (orb + placeholder). */}
        {open && (
          <>
            {query.includes("@") && <span className="ask-bar__chip">@ mention</span>}
            {/* Like the reference, @ is a permanent button — showing it only to someone who has
                already typed "@" teaches nothing. */}
            <button
              type="button"
              className="ask-bar__composer-button"
              aria-label="Add mention"
              onClick={() => {
                setQuery((q) => `${q}@`);
                inputRef.current?.focus();
              }}
            >
              <AtSign size={15} aria-hidden="true" />
            </button>
            {/* There is no upload path to attach to — disabled, with title="Phase B" (story fallback). */}
            <button
              type="button"
              className="ask-bar__composer-button"
              aria-label="Attach file"
              title="Phase B"
              disabled
            >
              <Paperclip size={15} aria-hidden="true" />
            </button>
            <ModelPicker />
          </>
        )}
      </GlassSurface>
      {(open || closing) && (
        <AskPanel
          commands={commands}
          threadSelected={threadSelected}
          threadTitle={threadTitle}
          summary={threadSummary}
          query={query}
          closing={closing}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Command>
  );
}

/** Closing has to run the same spring the opening does (brief: spring open/close), which means the
 *  panel has to stay in the DOM while it runs — CSS alone cannot animate an element that has already
 *  unmounted. US-D04 moved the hook itself to lib/motion.ts when US-D10's detail pane needed the
 *  same hold at a different length; the default there is this panel's PANEL_MS, so this call site
 *  reads as it always did. */

/** US-D01 model picker. There is no settings HTTP route, so it lives in localStorage only
 *  (lib/ask-model.ts). The menu is deliberately opaque — glass over glass kills the text
 *  (apple-design §12). The model dropdown in the reference (ref-glass-mail-ai-panel.webp) is
 *  clearly more opaque than the panel as well. */
function ModelPicker() {
  const [model, setModel] = useState<AskModelId>(readAskModel);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="ask-bar__model">
      <button
        type="button"
        className="ask-bar__model-toggle"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {askModelLabel(model)}
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {menuOpen && (
        // biome-ignore lint/a11y/useSemanticElements: popover menu, not a form fieldset.
        <div className="ask-bar__model-menu" role="group" aria-label="Model">
          {ASK_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={m.id === model}
              onClick={() => {
                setModel(m.id);
                writeAskModel(m.id);
                setMenuOpen(false);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
