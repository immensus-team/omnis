import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import { CHANNEL_LABEL } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { Button } from "./button.js";
import { ChannelGlyph } from "./channel-glyph.js";
import { CONFIRM_COPY, ConfirmPrompt } from "./confirm-prompt.js";
import { OpaqueSurface } from "./glass-surface.js";

export type ApprovalCardAction =
  | "send"
  | "delete"
  | "calendar_write"
  | "delegate"
  | "self_model_edit"
  | "memory_write";
export type ApprovalCardDecision = "accept" | "edit" | "respond" | "ignore";

/** Mirrors @omnis/protocol's HumanInterrupt (a package-boundary call — protocol is not imported). */
export interface ApprovalCardInterrupt {
  action: ApprovalCardAction;
  description: string;
  args?: Record<string, unknown>;
  config: {
    allow_accept: boolean;
    allow_edit: boolean;
    allow_respond: boolean;
    allow_ignore: boolean;
  };
}

/** Exported for the approval stack (US-D03): a collapsed one-line row leads with the same action
 *  word the expanded card's title uses, so a row and its card cannot disagree. */
export const ACTION_LABEL: Record<ApprovalCardAction, string> = {
  send: "Send",
  delete: "Delete",
  calendar_write: "Write to calendar",
  delegate: "Delegate",
  self_model_edit: "Edit profile",
  memory_write: "Write memory",
};

export interface ApprovalCardViewProps {
  interrupt: ApprovalCardInterrupt;
  onDecide: (decision: ApprovalCardDecision, decidedArgs?: Record<string, unknown>) => void;
  /** US-D03: the approval stack passes the elevation hook here rather than wrapping the card —
   *  a wrapper div would put the shadow outside the card's own radius. */
  className?: string;
  /** loop-r2-01: the human name of where the action goes — a thread title ("#omnis-launch"), a
   *  person ("Dana Lee"). The card never guesses one; a caller that does not know passes nothing,
   *  and the header drops the half it cannot say. */
  destination?: string | null;
  /** The stack's own risk field ('normal' | 'high'). The card draws the mark; it does not rank. */
  risk?: string;
}

/** loop-r2-01: `args` is the kernel's untyped JSON, so every read below is defensive. A value that
 *  is not the shape this card draws is treated as absent rather than rendered — a `body` that is an
 *  object or a `channel` that is a number must not reach the DOM as "[object Object]". */
function stringArg(args: Record<string, unknown> | undefined, key: string): string | null {
  const value = args?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** The channel an action goes out on, when it names one this app has a mark and a label for. An
 *  unknown key is not a mark and not a label, so the header simply does not carry one. */
function knownChannel(args: Record<string, unknown> | undefined): UiChannel | null {
  const channel = args?.channel;
  if (typeof channel !== "string" || !Object.hasOwn(CHANNEL_LABEL, channel)) return null;
  return channel as UiChannel;
}

/** loop-r2-01/NC2-05, L2-08, NC2-01: the card's first line answers "what does this send, and to
 *  where?", which the old "Send needs your approval" did not. Each half is dropped when it is not
 *  known rather than printed as a blank, and `send` reads as a reply because that is what it is. */
function headerText(
  interrupt: ApprovalCardInterrupt,
  destination: string | null,
  channel: UiChannel | null,
): string {
  const label = channel === null ? null : CHANNEL_LABEL[channel];
  if (interrupt.action === "send") {
    if (destination !== null && label !== null) return `Reply in ${destination} · ${label}`;
    if (destination !== null) return `Reply in ${destination}`;
    if (label !== null) return `Send · ${label}`;
    return "Send";
  }
  const action = ACTION_LABEL[interrupt.action];
  return destination === null ? action : `${action} · ${destination}`;
}

/** The three states the body block can be in. Swapping between them is instant (v3 §e: no motion
 *  for a layout change that is not a drag settling). */
type CardMode = "read" | "edit" | "respond";

export function ApprovalCardView({
  interrupt,
  onDecide,
  className,
  destination,
  risk,
}: ApprovalCardViewProps) {
  const { config } = interrupt;
  /** US-D09 §c.8: approving is the one decision here that goes out to the tool and cannot be taken
   *  back from this screen, so it asks first — and the prompt repeats the description rather than a
   *  pronoun, because the card behind it is dimmed and the question has to stand on its own.
   *  loop-r2-01: saving an edit asks the same question, so it is the same prompt with different
   *  copy rather than a second one. */
  const [confirming, setConfirming] = useState<"approve" | "edit" | null>(null);
  const [mode, setMode] = useState<CardMode>("read");
  /** The edit and respond buffers are the same field: only one of the two states is ever open. */
  const [draft, setDraft] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const respondRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const respondButtonRef = useRef<HTMLButtonElement>(null);
  /** Which button the read state owes focus to when the open state closes. */
  const returnFocus = useRef<CardMode>("read");

  const channel = knownChannel(interrupt.args);
  const channelLabel = channel === null ? null : CHANNEL_LABEL[channel];
  const messageBody = stringArg(interrupt.args, "body");
  const to = typeof destination === "string" && destination.trim() !== "" ? destination : null;

  // The editor opens on the message, or on the description when the action carries no body — an
  // empty box would ask the person to write the thing they are being asked to approve.
  const openEditor = (): void => {
    setDraft(messageBody ?? interrupt.description);
    setMode("edit");
  };
  const inEdit = mode === "edit";
  const inRespond = mode === "respond";
  const openRespond = (): void => {
    setDraft("");
    setMode("respond");
  };
  /** Cancel and Escape both land here: the buffer is dropped, the read state comes back, and the
   *  focus goes to the button that opened it. */
  const closeEditor = (): void => {
    returnFocus.current = mode;
    setDraft("");
    setMode("read");
  };

  /* One effect for the whole focus story, because the three states are one field changing: entering
     edit or respond focuses its control (the editor's caret at the end, so typing continues where
     the message left off), and leaving them gives the focus back. Nothing runs on the read state's
     first render — `returnFocus` starts there. */
  useEffect(() => {
    if (mode === "edit") {
      const editor = editorRef.current;
      if (editor === null) return;
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
      return;
    }
    if (mode === "respond") {
      respondRef.current?.focus();
      return;
    }
    const back = returnFocus.current;
    if (back === "read") return;
    returnFocus.current = "read";
    (back === "edit" ? editButtonRef : respondButtonRef).current?.focus();
  }, [mode]);

  /** The editor's and the reply field's keys. Escape inside either belongs to the field:
   *  `stopPropagation` keeps the shell's own Escape (App.tsx, on `window` in the capture phase) from
   *  reading the same press as "close the pane" — the two are not the same intent, and a cancel that
   *  also closes the conversation loses the place the person was reading.
   *
   *  The send chord differs because the two states differ: an edit leaves omnis for the tool, so it
   *  asks first and takes ⌘/Ctrl+Enter (Enter alone has to be able to break a line in a textarea);
   *  a response goes back to the agent on plain Enter, and shows no prompt because a reply is not
   *  the irreversible step an approval is. */
  const onFieldKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): void => {
    // loop-r1-08: an IME owns Enter and Escape while it is composing — that Enter commits the
    // composition and is not a request to send anything.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      closeEditor();
      return;
    }
    const sends = inEdit ? e.key === "Enter" && (e.metaKey || e.ctrlKey) : e.key === "Enter";
    if (!sends) return;
    e.preventDefault();
    e.stopPropagation();
    if (draft.trim() === "") return;
    if (inEdit) setConfirming("edit");
    else onDecide("respond", { response: draft });
  };

  return (
    <OpaqueSurface className={cn("approval-card", className)}>
      {/* loop-r2-01: the header is the card's whole question — which action, on which channel, to
          whom. The risk mark rides the same row (the stack already ranks by it) rather than taking a
          line of its own. */}
      <p className="approval-card__header">
        {channel !== null && <ChannelGlyph channel={channel} size={16} />}
        <span className="approval-card__header-text">{headerText(interrupt, to, channel)}</span>
        {risk === "high" && <span className="approval-stack__risk">High risk</span>}
      </p>
      <p className="approval-card__description">{interrupt.description}</p>
      {inEdit ? (
        <textarea
          ref={editorRef}
          className="approval-card__editor"
          aria-label="Edit message"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onFieldKeyDown}
        />
      ) : inRespond ? (
        <input
          ref={respondRef}
          className="approval-card__respond"
          aria-label="Reply to the agent"
          placeholder="Tell the agent what to do instead"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onFieldKeyDown}
        />
      ) : (
        messageBody !== null && (
          /* DESIGN-DIRECTION "full text": the card quotes the message it would send rather than
             summarising it. The clamp is a card-height guard, not an edit — the editor shows the
             whole body, so nothing here is hidden for good. */
          <blockquote className="approval-card__body" title={messageBody}>
            {messageBody}
          </blockquote>
        )
      )}
      <div className="approval-card__actions">
        {inEdit ? (
          <>
            <Button onClick={() => setConfirming("edit")} disabled={draft.trim() === ""}>
              Save & send
            </Button>
            <Button variant="ghost" onClick={closeEditor}>
              Cancel
            </Button>
          </>
        ) : inRespond ? (
          <>
            <Button
              onClick={() => onDecide("respond", { response: draft })}
              disabled={draft.trim() === ""}
            >
              Send to agent
            </Button>
            <Button variant="ghost" onClick={closeEditor}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {config.allow_accept && (
              <Button onClick={() => setConfirming("approve")}>Approve</Button>
            )}
            {/* loop-r1-02/L-26: one word, not "Edit & approve". At 320 and 390 a pane that is the
                window's width had no room for the longer label, so the button wrapped to two lines and
                pushed "Ignore" past the card's right edge. Which decision it is belongs to
                `onDecide("edit")`; the card's title already says the approval is pending.
                loop-r2-01: the decision is only named here — the click opens the editor, and nothing
                is sent until "Save & send" and then "Send". */}
            {config.allow_edit && (
              <Button ref={editButtonRef} variant="ghost" onClick={openEditor}>
                Edit
              </Button>
            )}
            {config.allow_respond && (
              <Button
                ref={respondButtonRef}
                variant="ghost"
                onClick={openRespond}
                title="Reply to the agent without approving"
                aria-description="Reply to the agent without approving"
              >
                Respond
              </Button>
            )}
            {config.allow_ignore && (
              <Button variant="ghost" onClick={() => onDecide("ignore", undefined)}>
                Ignore
              </Button>
            )}
          </>
        )}
      </div>
      {/* The one decision that leaves this screen for good is the one marked destructive, so its
          pill can leave the accent; the others are still recoverable by deciding again. */}
      <ConfirmPrompt
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        {...CONFIRM_COPY.approve(interrupt.description, {
          destination: to,
          channelLabel,
          // The edit's own confirm is about the text being saved, not the text being replaced.
          body: inEdit ? draft : messageBody,
        })}
        confirmLabel={inEdit ? "Send" : "Approve"}
        destructive={interrupt.action === "delete"}
        onConfirm={() => {
          if (inEdit) onDecide("edit", { ...interrupt.args, body: draft });
          else onDecide("accept", undefined);
        }}
      />
    </OpaqueSurface>
  );
}
