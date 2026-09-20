import { ListChecks, PenLine, Sparkles, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn.js";
import { AuroraSurface } from "./aurora-surface.js";
import { GlassSurface } from "./glass-surface.js";

/** US-D01: the floating glass panel the ask bar expands into. It is the reference
 *  ref-glass-mail-ai-panel.webp's three suggested actions (Draft a reply / Summarize / Extract)
 *  plus the model picker, said in omnis's own words.
 *
 *  The composer (input + @ chip + attach + model) lives in the ask bar row above, not in the panel
 *  — the bar is already an input, and a second input inside the panel would split cmdk's search
 *  state in two (at which point "typing filters the command list" breaks silently). So "the
 *  expanded bar" = the bar row + the panel below it. */
export interface AskPanelProps {
  /** The "Commands" tab's contents (the cmdk list). Ownership stays with CommandPalette — the
   *  palette is never built twice. */
  commands: ReactNode;
  /** App.tsx's `open` (the selected thread). When it is null there is nothing to summarize. */
  threadSelected: boolean;
  /** threads.title — the context line saying what the panel is working on. */
  threadTitle?: string | null;
  /** threads.meta.summary. Null while there is no summary yet → "No summary yet". */
  summary: string | null;
  /** The ask bar's current input. When it is not empty the panel switches to the "Commands" tab —
   *  that closes off the dead end where typing filters the cmdk list while the screen still shows
   *  only suggestions. */
  query?: string;
  /** Set while the close spring is running (app.css .ask-panel--closing), i.e. still in the DOM. */
  closing?: boolean;
  onClose: () => void;
}

type Tab = "suggest" | "commands";

export function AskPanel({
  commands,
  threadSelected,
  threadTitle = null,
  summary,
  query = "",
  closing = false,
  onClose,
}: AskPanelProps) {
  // The default tab is derived from the input: empty means "Suggestions", mid-typing means
  // "Commands" (a leading ">" lands here too). Pressing a tab button leaves that choice as an
  // override until the next keystroke clears it.
  const [override, setOverride] = useState<Tab | null>(null);
  const [summaryShown, setSummaryShown] = useState(false);
  // The react.dev "adjust state when a prop changes" pattern: every keystroke releases the manual
  // choice (with a useEffect it would clear a frame late and the stale tab would flash once).
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setOverride(null);
  }
  const tab: Tab = override ?? (query.trim() === "" ? "suggest" : "commands");

  // US-D06 §4.1.2: the panel's glass now stands on the `dawn` aurora — reference image 1's soft
  // indigo ridge with its warm bloom. The wrapper owns position, radius, shadow and the entrance
  // spring; the glass inside owns padding, the height cap and the scroll. Two elements on purpose
  // (§2.7): `.aurora` and `.glass-surface` both set a background at (0,1,0), so one element carrying
  // both would either stop being glass or lose the vignette to the glass tint.
  // Aurora goes on fixed-size boxes only, and this one scrolls — hence the split rather than a
  // single element that both paints and scrolls.
  // The dialog role moves out to the wrapper with the panel's outer box: the wrapper is now the
  // panel's root element (it is what is positioned, sized and animated), and `.ask-panel--closing`
  // lands on it — so the element a test or a screen reader finds by role is still the element that
  // carries the panel's state. The two aurora layers inside are `aria-hidden`, so the accessible
  // name and the announced subtree are unchanged from the single-element version.
  return (
    <AuroraSurface
      variant="dawn"
      className={cn("ask-panel", closing && "ask-panel--closing")}
      // biome-ignore lint/a11y/useSemanticElements: AuroraSurface is a shared presentational wrapper (rail/toolbar/palette all use it) — a native <dialog> would need its own backdrop/blur styling duplicated here.
      role="dialog"
      aria-label="AI panel"
    >
      <GlassSurface slot="palette" className="ask-panel__glass">
        <div className="ask-panel__head">
          {/* biome-ignore lint/a11y/useSemanticElements: tab-like toggle, not a form fieldset. */}
          <div className="ask-panel__tabs" role="group" aria-label="Panel views">
            <button
              type="button"
              aria-pressed={tab === "suggest"}
              onClick={() => setOverride("suggest")}
            >
              Suggestions
            </button>
            <button
              type="button"
              aria-pressed={tab === "commands"}
              onClick={() => setOverride("commands")}
            >
              Commands
            </button>
          </div>
          <button type="button" className="ask-panel__close" aria-label="Close" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        {tab === "commands" ? (
          commands
        ) : (
          <>
            {/* Say what the panel is working on first — this is the reference's conversation area
                (leaving it an empty band reads as "a wide dropdown"). */}
            <div className="ask-panel__context">
              <p className="ask-panel__context-title">
                {threadSelected ? (threadTitle ?? "Untitled thread") : "No thread selected"}
              </p>
              <p
                className={cn(
                  "ask-panel__context-body",
                  (!summaryShown || summary === null) && "ask-panel__context-body--muted",
                )}
              >
                {summaryShown
                  ? (summary ?? "No summary yet")
                  : threadSelected
                    ? "The suggestions below run against this thread."
                    : "Suggestions come alive once you pick a thread."}
              </p>
            </div>
            <div className="ask-panel__actions">
              {/* US-D01 fallback: there is no route to attach drafts or todo extraction to —
                  disabled, with title="Phase B". Saying it cannot be pressed is more honest than
                  pretending it can. */}
              <button type="button" className="ask-panel__action" disabled title="Phase B">
                <PenLine size={15} aria-hidden="true" />
                Draft a reply
                <span className="ask-panel__tag" aria-hidden="true">
                  Phase B
                </span>
              </button>
              {/* Only this one is actually wired up — threads.meta.summary (filled by the T1
                  summarization loop). */}
              <button
                type="button"
                className="ask-panel__action"
                disabled={!threadSelected}
                {...(threadSelected ? {} : { title: "Select a thread" })}
                onClick={() => setSummaryShown(true)}
              >
                <Sparkles size={15} aria-hidden="true" />
                Summarize this thread
                {!threadSelected && (
                  <span className="ask-panel__tag" aria-hidden="true">
                    Thread required
                  </span>
                )}
              </button>
              <button type="button" className="ask-panel__action" disabled title="Phase B">
                <ListChecks size={15} aria-hidden="true" />
                Extract to-dos
                <span className="ask-panel__tag" aria-hidden="true">
                  Phase B
                </span>
              </button>
            </div>
          </>
        )}
      </GlassSurface>
    </AuroraSurface>
  );
}
