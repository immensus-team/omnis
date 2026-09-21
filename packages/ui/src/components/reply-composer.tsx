import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { CHANNEL_LABEL } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { Button } from "./button.js";
import { ChannelGlyph } from "./channel-glyph.js";
import { ConfirmPrompt } from "./confirm-prompt.js";
import { OpaqueSurface } from "./glass-surface.js";

export interface ReplyComposerProps {
  /** The human name of where the reply goes — the thread's title, the string the pane's own header
   *  prints. Required: the whole point of the component is that a reply says where it is going
   *  (L2-01, NC2-03), and a composer that could be opened without one would be the old button back. */
  destination: string;
  /** The account's channel, or null when the thread's account is not one this app has a mark for.
   *  Null drops the channel half of the line rather than printing a hole. */
  channel: UiChannel | null;
  /** Opens with text already in the box. The composer is a blank reply everywhere it is used today;
   *  the prop is what "Edit & send" would hand it if that entry is ever built. */
  initialBody?: string;
  /** Resolves when the proposal landed. Rejecting keeps the text and shows the inline error — the
   *  person's sentence is the one thing this screen must not lose to a failed request. */
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
  /** Defaults to true: the composer is opened by a key (`r`) as often as by a click, so the caret
   *  has to be in the box for the person to start typing. */
  autoFocus?: boolean;
}

/** loop-r2-03: the inline reply composer. It sits at the end of the conversation, on the opaque body
 *  — the reply is content, not chrome, so it is an `OpaqueSurface` (v3 §e guard 4) — and it
 *  **proposes** rather than sends: "Send for approval" raises the `send` approval the thread's own
 *  card then carries, which is the same gate every other `send` in the product goes through.
 *
 *  The card it becomes is `ApprovalCardView`'s, not this component's: the flow draws the approval
 *  when Zero replicates it, so this box is one step and then it is gone. */
export function ReplyComposer({
  destination,
  channel,
  initialBody = "",
  onSubmit,
  onCancel,
  autoFocus = true,
}: ReplyComposerProps) {
  const [draft, setDraft] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Escape with text in the box asks first. A blank box can just go — there is nothing to lose. */
  const [discarding, setDiscarding] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);

  const channelLabel = channel === null ? null : CHANNEL_LABEL[channel];
  // The same sentence the approval card's header uses for a `send` ("Reply in … · …"), so the box
  // that raises the approval and the card that carries it name the destination identically.
  const where =
    channelLabel === null ? `Reply in ${destination}` : `Reply in ${destination} · ${channelLabel}`;

  const send = (): void => {
    if (sending || draft.trim() === "") return;
    setSending(true);
    setFailed(false);
    // The hub trims too, so the string handed up here is the string the approval row ends up
    // holding — which is what lets the screen find the card again by its body.
    onSubmit(draft.trim())
      .catch(() => {
        // The text stays in the box: the draft is local state and this component is still mounted,
        // which is exactly the state a retry needs.
        setFailed(true);
      })
      .finally(() => {
        setSending(false);
      });
  };

  /** Escape belongs to the box, not to the shell: `stopPropagation` keeps the pane from closing on
   *  the same press. A cancel that also threw away the conversation behind it would lose the place
   *  the person was reading. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // An IME owns Enter and Escape while it is composing (loop-r1-08): that Enter commits the
    // composition and is not a request to send anything.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      if (draft.trim() === "") onCancel();
      else setDiscarding(true);
      return;
    }
    // ⌘/Ctrl+Enter, not Enter: a reply is prose, and Enter has to be able to break a line.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      send();
    }
  };

  return (
    <OpaqueSurface className="reply-composer">
      <p className="reply-composer__header">
        {channel !== null && <ChannelGlyph channel={channel} size={14} />}
        <span className="reply-composer__header-text">{where}</span>
      </p>
      <textarea
        ref={box}
        className="reply-composer__editor"
        aria-label="Reply"
        placeholder="Write a reply…"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {failed && (
        <p className="reply-composer__error" role="alert">
          Couldn't send for approval. Try again.
        </p>
      )}
      <div className="reply-composer__actions">
        <Button onClick={send} disabled={sending || draft.trim() === ""}>
          {sending ? "Sending…" : "Send for approval"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {/* A hint, not a control: the same chord the key handler above reads. Hidden under
            `(pointer: coarse)` in app.css — a phone has no ⌘ key, and telling a thumb about one is
            noise. */}
        <span className="reply-composer__hint">
          <kbd>⌘</kbd>
          <kbd>↵</kbd> to send
        </span>
      </div>
      <ConfirmPrompt
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard this reply?"
        confirmLabel="Discard"
        destructive
        onConfirm={onCancel}
      />
    </OpaqueSurface>
  );
}
