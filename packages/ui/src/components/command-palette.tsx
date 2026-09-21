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
import { useNarrowShell } from "../lib/media-query.js";
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

/** A5 §2.5: the four search groups, in the order the palette renders them whatever order the hub
 *  sent them in (people → threads → items → memories). */
export type UiSearchGroupKind = "people" | "threads" | "items" | "memories";

export interface UiSearchHit {
  kind: "person" | "thread" | "item" | "memory";
  id: string;
  title: string;
  snippet: string;
  /** A5 §2.5: a memory with no `deep_link` has nowhere to go, so its row is not clickable. */
  deepLinkDisabled: boolean;
  /** A5 §2.5's memory badge (inbox / calendar / file / drive / github / self). Null everywhere
   *  else — and null on an older memory row that carries no source. */
  sourceKind: string | null;
}

export interface UiSearchGroup {
  kind: UiSearchGroupKind;
  label: string;
  results: UiSearchHit[];
}

/** US-B27: what the palette needs to run in search mode. The consumer owns the request (the hub
 *  client and its debounce live outside @omnis/ui, which depends on React only) — the palette owns
 *  the mode decision, the group order and the copy. */
export interface CommandPaletteSearch {
  groups: UiSearchGroup[];
  loading: boolean;
  onQueryChange: (q: string) => void;
  onSelectHit: (hit: UiSearchHit) => void;
}

const SEARCH_GROUP_ORDER: UiSearchGroupKind[] = ["people", "threads", "items", "memories"];
/** A5 §2.5: how long the palette waits after the last keystroke before it asks for results. */
export const SEARCH_DEBOUNCE_MS = 180;

/** A5 §2.5: an empty input is always action mode; otherwise it is action mode if any registered
 *  action name matches as a substring. Nothing matches → search mode. */
export function matchesAnyAction(query: string, actions: PaletteAction[]): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return actions.some((a) => a.name.toLowerCase().includes(q));
}

/** US-B27: the search-results body of the palette. Server order is not trusted — the groups are
 *  rendered in SEARCH_GROUP_ORDER, and a group the hub did not send (or sent empty) is skipped
 *  rather than drawn as a bare header. */
function SearchResultList({ query, search }: { query: string; search: CommandPaletteSearch }) {
  const empty = !search.loading && search.groups.every((g) => g.results.length === 0);
  return (
    <Command.List>
      {search.loading && <div className="palette-search__state">Searching…</div>}
      {empty && <div className="palette-search__state">{`No results for ${query.trim()}`}</div>}
      {SEARCH_GROUP_ORDER.map((kind) => {
        const group = search.groups.find((g) => g.kind === kind);
        if (!group || group.results.length === 0) return null;
        return (
          <Command.Group key={kind} heading={group.label}>
            {group.results.map((result) => (
              <Command.Item
                key={`${result.kind}:${result.id}`}
                // cmdk identifies an item by `value` and falls back to the row's rendered text, so
                // two hits that share a title would share one identity: both would read as selected,
                // and Enter/arrow keys would resolve to the first of them (querySelector by
                // aria-selected) and open the wrong hit. The synthetic value is never filtered on —
                // search rows are the hub's answer, so shouldFilter is off in this mode.
                value={`${result.kind}:${result.id}`}
                className="palette-search__hit"
                disabled={result.deepLinkDisabled}
                onSelect={() => {
                  if (!result.deepLinkDisabled) search.onSelectHit(result);
                }}
              >
                {/* A5 §2.5's memory badge — where this memory came from (inbox/calendar/file/…). */}
                {result.sourceKind !== null && (
                  <span className="palette-search__source">{result.sourceKind}</span>
                )}
                <span className="palette-search__title">{result.title}</span>
                {result.snippet !== "" && result.snippet !== result.title && (
                  <span className="palette-search__snippet">{result.snippet}</span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        );
      })}
    </Command.List>
  );
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
  /** US-B27: when present, a query that matches no action switches the palette to search results.
   *  Absent (Phase A call sites, the gallery), the palette is action-only exactly as before. */
  search?: CommandPaletteSearch;
  /** US-D01: "Summarize this thread" only comes alive when a thread is selected (App.tsx's `open`). */
  threadSelected?: boolean;
  /** US-D01: threads.meta.summary — when it is null the panel says "No summary yet". */
  threadSummary?: string | null;
  /** US-D01: threads.title — the panel's context line. */
  threadTitle?: string | null;
}

/** A5 §2.3: kbar-pattern actions ({id,name,shortcut,perform}) grouped by their `group` and rendered
 *  into GlassSurface(slot="palette").
 *
 *  US-B27: the input's query is owned here rather than inside InlinePalette, because the
 *  action-vs-search decision (`matchesAnyAction`) and the search debounce belong to the palette —
 *  whichever surface it is rendered on. */
export function CommandPalette({
  open,
  onOpenChange,
  actions,
  mode = "dialog",
  placeholder,
  threadSelected = false,
  threadSummary = null,
  threadTitle = null,
  search,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const groups = groupBy(actions, (a) => a.group);
  const showSearch = search !== undefined && !matchesAnyAction(query, actions);
  const onQueryChange = search?.onQueryChange;
  // A5 §2.5's 180ms debounce. Only a query that actually puts the palette in search mode is worth a
  // round trip — a query that matches an action is answered from the action list. The dependency is
  // the callback, not the `search` object: a consumer that builds that object inline hands over a
  // new identity every render, which would restart the timer each time and never fire.
  useEffect(() => {
    if (!open || !showSearch || onQueryChange === undefined) return;
    const timer = setTimeout(() => onQueryChange(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, showSearch, query, onQueryChange]);
  const actionList = (
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
  const resultList =
    showSearch && search !== undefined ? (
      <SearchResultList query={query} search={search} />
    ) : (
      actionList
    );

  if (mode === "inline") {
    return (
      <InlinePalette
        open={open}
        onOpenChange={onOpenChange}
        placeholder={placeholder ?? "Start typing to ask or search"}
        commands={resultList}
        query={query}
        onQueryChange={setQuery}
        searchActive={showSearch}
        threadSelected={threadSelected}
        threadSummary={threadSummary}
        threadTitle={threadTitle}
      />
    );
  }

  return (
    // `shouldFilter` is off in search mode: those rows are already the hub's answer to this query,
    // and cmdk's client-side filter would hide the ones whose text does not literally contain it
    // (a thread found by its body, say) — or all of them, for a memory whose snippet is unrelated
    // to the words that found it.
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="omnis command palette"
      shouldFilter={!showSearch}
    >
      <GlassSurface slot="palette">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={placeholder ?? "Search or run a command…"}
        />
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
  query,
  onQueryChange,
  searchActive,
  threadSelected,
  threadSummary,
  threadTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  commands: ReactNode;
  /** US-B27: owned by CommandPalette — the action-vs-search decision is made there. */
  query: string;
  onQueryChange: (query: string) => void;
  /** US-B27: the list below is search results, not the action list (the panel's tab says so). */
  searchActive: boolean;
  threadSelected: boolean;
  threadSummary: string | null;
  threadTitle: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const narrow = useNarrowShell();
  const closing = useClosingSpring(open);
  // Nothing is focused when ⌘K opens it — you have to be able to type straight away (the palette's
  // basic promise), and the Escape/typing handlers only fire while focus is inside the Command root.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      // Below 900px the panel is a drawer and `vaul` portals it out of this subtree, so "inside the
      // bar" is no longer "inside the element that opened it" — a press on the drawer's own tabs
      // would arrive here as a press outside the bar and close the panel it is standing in. The
      // drawer is modal: while one is up it owns the pointer, and nothing under it is an
      // outside-press for this bar's purposes.
      if (e.target instanceof Element && e.target.closest("[data-vaul-drawer]") !== null) return;
      onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  return (
    <Command
      ref={ref}
      className="ask-bar"
      label="omnis ask/search"
      // US-B27: same reason as the dialog — search rows are the hub's answer, not cmdk's filter input.
      shouldFilter={!searchActive}
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
            onQueryChange(value);
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
                onQueryChange(`${query}@`);
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
      {/* Two tiers, two lifecycles. Above 900px the panel is a card the bar owns: it is mounted for
          exactly as long as it should be up, plus the length of its close spring (`closing`), which
          is how a CSS exit animation gets to run on an element React would otherwise have removed.
          Below 900px it is a drawer and `vaul` owns both ends of it — so it stays mounted and the
          drawer's own open/close is the whole of the animation, which is what makes the narrow exit
          the same 500ms travel the filters sheet has instead of a 240ms hold and a cut. */}
      {(narrow || open || closing) && (
        <AskPanel
          open={open}
          commands={commands}
          threadSelected={threadSelected}
          threadTitle={threadTitle}
          summary={threadSummary}
          query={query}
          searchActive={searchActive}
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
