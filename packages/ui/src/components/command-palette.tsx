import { Command } from "cmdk";
import { AtSign, ChevronDown } from "lucide-react";
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

/** The body of the palette's second tab once there is something to answer: the commands the words
 *  match, then the hub's hits. Server order is not trusted — the search groups are rendered in
 *  SEARCH_GROUP_ORDER, and a group the hub did not send (or sent empty) is skipped rather than
 *  drawn as a bare header.
 *
 *  loop-r1-08 (L-16): the two used to be alternatives, so a query that matched a command could
 *  never also be a search and a query that matched nothing showed no commands at all. The commands
 *  come first because they are the rows that do something locally; `>` is how a user asks for them
 *  without the search (`search` is then undefined and no request is ever made). */
function QueryResultList({
  term,
  search,
  commands,
}: {
  /** The words the query is made of — the copy above the list quotes them back. A `>` is not one. */
  term: string;
  /** `undefined` for a commands-only query, where nothing was asked of the hub. */
  search: CommandPaletteSearch | undefined;
  /** The rows for the matching commands, in the caller's order. Rendered before the hub's hits. */
  commands: ReactNode[];
}) {
  const loading = search?.loading === true;
  const groups = search?.groups ?? [];
  const hits = groups.reduce((total, group) => total + group.results.length, 0);
  // "No results" has to mean the list is empty, and the commands are part of the list now: a query
  // that found no thread but did find "Go to Settings" is not a dead end.
  const empty = !loading && commands.length === 0 && hits === 0;
  return (
    <Command.List>
      {loading && commands.length === 0 && <div className="palette-search__state">Searching…</div>}
      {commands.length > 0 && <Command.Group heading="Commands">{commands}</Command.Group>}
      {SEARCH_GROUP_ORDER.map((kind) => {
        const group = groups.find((g) => g.kind === kind);
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
                  if (!result.deepLinkDisabled) search?.onSelectHit(result);
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
      {empty && (
        <div className="palette-search__state">
          {term === "" ? "No results" : `No results for ${term}`}
        </div>
      )}
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
  // loop-r1-08 (L-16): one grammar for the second tab. A leading `>` asks for the commands alone;
  // anything else is a search that also matches the commands against the same words, so typing
  // "go to" narrows the command list instead of leaving it as a museum piece.
  const trimmed = query.trim();
  const commandsOnly = trimmed.startsWith(">");
  const term = (commandsOnly ? trimmed.slice(1) : trimmed).trim();
  // A5 §2.5's action names are matched here rather than by cmdk for exactly the rows cmdk cannot
  // see: with a query the list also carries the hub's hits, so cmdk's filter is off and only this
  // decides which commands are on screen.
  const matchedActions =
    term === ""
      ? actions
      : actions.filter((a) => a.name.toLowerCase().includes(term.toLowerCase()));
  /** The list the second tab shows when a query is being typed. Absent a `search` prop the palette
   *  is action-only (the gallery, Phase A call sites) and this stays false however you type. */
  const searched = search !== undefined && !commandsOnly && term !== "";
  /** cmdk may not filter a list that was filtered here: the raw query is not what these rows are
   *  matched against — a `>` is grammar, and a hit the hub found by its body need not contain the
   *  words that found it. */
  const manualFilter = searched || commandsOnly;
  /** US-B27: the tab is named by what it shows. The hub's hits are all there is only when nothing
   *  in the command list answers the same words. */
  const searchActive = searched && !matchesAnyAction(term, actions);
  const onQueryChange = search?.onQueryChange;
  // A5 §2.5's 180ms debounce. The dependency is the callback, not the `search` object: a consumer
  // that builds that object inline hands over a new identity every render, which would restart the
  // timer each time and never fire.
  useEffect(() => {
    if (!open || !searched || onQueryChange === undefined) return;
    const timer = setTimeout(() => onQueryChange(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, searched, query, onQueryChange]);
  /** One row per command, shared by both lists below so the two cannot drift: the name, its
   *  shortcut in the `<kbd>` the row already ends with, and the palette's own close on select. */
  const commandItems = matchedActions.map((action) => (
    <Command.Item
      key={action.id}
      // The name is the row's identity. cmdk falls back to the rendered text, which folds the
      // shortcut in with the name — so "Go to Inbox" and "g i" would be one value, and cmdk's own
      // filter would match a row on its shortcut as readily as on its name.
      value={action.name}
      onSelect={() => {
        action.perform();
        onOpenChange(false);
      }}
    >
      <span>{action.name}</span>
      {action.shortcut && <kbd>{action.shortcut}</kbd>}
    </Command.Item>
  ));
  /** The grouped action list, for the surfaces cmdk still filters itself: the dialog, the gallery,
   *  and an inline palette opened onto the Commands tab with nothing typed. */
  const actionList = (
    <Command.List>
      <Command.Empty>No results</Command.Empty>
      {Object.entries(groups).map(([group, items]) => (
        <Command.Group key={group} heading={group}>
          {items.map((action) => (
            <Command.Item
              key={action.id}
              value={action.name}
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
    searched || commandsOnly ? (
      <QueryResultList term={term} search={searched ? search : undefined} commands={commandItems} />
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
        searchActive={searchActive}
        manualFilter={manualFilter}
        // loop-r1-08: what the panel offers when it has no suggestion for the context it is in —
        // the first four commands, so the tab is never a row of disabled buttons.
        recentActions={actions.slice(0, 4)}
        threadSelected={threadSelected}
        threadSummary={threadSummary}
        threadTitle={threadTitle}
      />
    );
  }

  return (
    // `shouldFilter` is off for a query this component answered itself: cmdk's client-side filter
    // would hide the hits whose text does not literally contain the words (a thread found by its
    // body, say) — or all of them, for a memory whose snippet is unrelated to the words that found
    // it — and it would hide every row of a `>` query, which starts with the one character no
    // command name contains.
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="omnis command palette"
      shouldFilter={!manualFilter}
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

/** The row an Enter press acts on at this moment: the one cmdk has highlighted, or — when the
 *  highlight was lost (see the Enter handler in InlinePalette) — the first row that has somewhere to
 *  go. Scoped to the palette's own root rather than the document, so a second palette, a test's
 *  neighbour or a stray `cmdk-item` elsewhere on the page is not what the key runs. */
function highlightedRow(root: HTMLElement | null): HTMLElement | null {
  if (root === null) return null;
  return (
    root.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]') ??
    root.querySelector<HTMLElement>('[cmdk-item]:not([aria-disabled="true"])')
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
  manualFilter,
  recentActions,
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
  /** US-B27: the hub's hits are all the list holds (the panel's tab says so). */
  searchActive: boolean;
  /** loop-r1-08: the list was built and filtered by CommandPalette, so cmdk must not filter it. */
  manualFilter: boolean;
  /** What the panel offers when the context has no suggestion of its own. */
  recentActions: PaletteAction[];
  threadSelected: boolean;
  threadSummary: string | null;
  threadTitle: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const narrow = useNarrowShell();
  const closing = useClosingSpring(open);
  /** loop-r2-04 (L2-13): a press on the bar is what opens the panel, and this is the flag that tells
   *  the press's focus from a focus nobody pressed for. Tab onto the bar used to open the panel,
   *  which then stayed up after the caret left and swallowed the clicks on the pills under it; so
   *  `onFocus` opens only when a press put the caret there, and clears the flag as it does. */
  const pressed = useRef(false);
  // Nothing is focused when ⌘K opens it — you have to be able to type straight away (the palette's
  // basic promise), and the Escape/typing handlers only fire while focus is inside the Command root.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  // loop-r1-08 (NC-12): ⌘K always opens empty. The query goes when the panel is *gone* rather than
  // the moment it starts leaving — the close spring holds it in the DOM for --dur-panel, and
  // swapping the list out from under a panel that is still on screen is a flash of the wrong
  // content at the one moment the user is watching it. Every close path lands here: a selected row,
  // Escape, an outside click.
  useEffect(() => {
    if (!open && !closing) onQueryChange("");
  }, [open, closing, onQueryChange]);
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
      // US-B27: same reason as the dialog — those rows are not cmdk's to filter (see `manualFilter`).
      shouldFilter={!manualFilter}
      // loop-r2-04 (L2-13): the panel goes when the caret does. It used to stay up with the focus
      // gone, which is the half of the bug a click could feel: an invisible panel over the pills
      // under the bar, swallowing every press that landed on it. React's `onBlur` is `focusout`, so
      // it bubbles and a move *within* the bar arrives here too — hence the containment test.
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        // Below 900 the drawer is portaled out of this subtree, so its own controls are not
        // contained by this element however much they belong to it.
        const inDrawer = next instanceof Element && next.closest("[data-vaul-drawer]") !== null;
        if (next !== null && (e.currentTarget.contains(next) || inDrawer)) return;
        // A tap on a non-focusable spot inside the drawer blurs with nowhere for the focus to go
        // (`null`), and the drawer at that tier is modal: it owns the press, so the caret leaving is
        // not the drawer closing.
        if (open && narrow && next === null) return;
        onOpenChange(false);
      }}
      onKeyDown={(e) => {
        // loop-r1-08: an IME owns Enter and Escape while it is composing — that Enter commits the
        // composition and is not a request to open a row, and that Escape is the IME's own "cancel".
        // cmdk 1.1.1 ignores both keys in that state (its root computes `e.nativeEvent.isComposing ||
        // e.keyCode === 229` before its key switch), but it runs this handler *first*, so without the
        // same guard the inline palette would act on keys the dialog never sees: the rows on screen
        // mid-composition are the debounced answer to the keystrokes before it, so the press opens
        // the previous query's row — a Korean name typed into the hub's search opens a thread.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") {
          e.preventDefault();
          onOpenChange(false);
          return;
        }
        // loop-r1-08 (L-15): Enter runs the highlighted row. cmdk's own Enter dispatches to
        // whatever holds `aria-selected="true"`, and that row is chosen by comparing a *value
        // string* it remembers against each row's `data-value` — which is written a layout effect
        // after the row registers. Two consequences, both measured on the live stack: a list whose
        // rows changed under a surviving value has no selected row at all (type "PoC", reopen, type
        // "Dana" — the one Dana row reads aria-selected="false"), and in that state cmdk's Enter has
        // nothing to dispatch to, so the press is silently swallowed. Reading the highlight off the
        // DOM, and falling back to the first row a press can act on, is what makes the key mean what
        // the picture says. A disabled row is skipped: it is a row with nowhere to go.
        if (e.key === "Enter") {
          const row = highlightedRow(ref.current);
          if (row !== null) {
            e.preventDefault();
            row.click();
          }
        }
      }}
    >
      <GlassSurface
        slot="toolbar"
        className="ask-bar__pill"
        // The press, wherever on the bar it lands, is what the input's focus is read against below.
        onPointerDown={() => {
          pressed.current = true;
        }}
      >
        <span className="ask-bar__orb" aria-hidden="true" />
        <Command.Input
          ref={inputRef}
          placeholder={placeholder}
          value={query}
          onFocus={() => {
            // Focus coming back while it is already open (⌘K's own autofocus included) is not a state
            // change, and a focus with no press behind it — Tab, or a programme moving the caret —
            // must not open the panel at all (L2-13). The flag is cleared either way: it belongs to
            // one press, not to the input.
            const wasPressed = pressed.current;
            pressed.current = false;
            if (wasPressed && !open) onOpenChange(true);
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
          recentActions={recentActions}
          threadSelected={threadSelected}
          threadTitle={threadTitle}
          summary={threadSummary}
          query={query}
          onQueryChange={onQueryChange}
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
  const toggleRef = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="ask-bar__model"
      // loop-r2-04 (NC2-12): one Escape closes one layer. With the menu open the press reached the
      // palette root *and* the shell, so a single Esc closed the menu, the panel, the typed text and
      // the open thread at once. `stopPropagation` is what takes it off the palette root, whose
      // handler is an ancestor in React's synthetic tree, and `preventDefault` marks the press as
      // dealt with. The shell's own listener is not in that tree — it is on `window` in the capture
      // phase, so it runs before both — and that is why it stands down for a target inside `.ask-bar`
      // instead (App.tsx). The handler hangs on the wrapper rather than on the menu because the press
      // that opens the menu leaves focus on the toggle, and that is where the key arrives.
      onKeyDown={(e) => {
        if (!menuOpen || e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
        toggleRef.current?.focus();
      }}
    >
      <button
        ref={toggleRef}
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
