// A1 §2.9: LinkedIn's message capture is a resident Playwright Chromium profile that is logged in
// once by hand (2FA included) and kept alive on the Mac mini — no credentials of ours, only the
// profile's session cookies. This file is the contract between the adapter and that page: the in-page
// extractor's JSON shapes (`RawConversation`/`RawMessage`) and the one failure a UI change produces.
//
// The page itself is injected, so every test here runs on fixtures with no browser. `SelectorMissingError`
// is what the real page raises when a selector stops matching; it is the expected breakage (A1 §2.9:
// selector updates ship as manual deploys, no auto-recovery).

/** A conversation as the messaging-inbox rows describe it. `unread` is the only field the poll acts on:
 *  only unread threads are opened, which is what keeps the capture from looking like bulk browsing. */
export interface RawConversation {
  conversationId: string;
  title: string;
  participants: RawParticipant[];
  lastActivityAt: string;
  unread: boolean;
}

export interface RawParticipant {
  name: string;
  profileUrl: string;
}

/** One message row inside an opened conversation. `ordinal` is the row's position in the DOM, which is
 *  what makes it a stable identity across re-renders — see `sourceHash`. */
export interface RawMessage {
  conversationId: string;
  ordinal: number;
  senderName: string;
  senderProfileUrl: string;
  isMe: boolean;
  text: string;
  sentAt: string;
  attachments: RawAttachment[];
}

export interface RawAttachment {
  kind: "image" | "file";
  url: string;
}

/** The slice of the Playwright page the adapter actually uses. Anything satisfying this works — the
 *  fixture tests, a real `Page` wrapper, or a recorded session. */
export interface LinkedInPageLike {
  pollInbox(): Promise<RawConversation[]>;
  openThread(conversationId: string): Promise<RawMessage[]>;
  /** Types into the message box and clicks send. The adapter itself never calls this: write-back is
   *  approval-only (A1 §2.9), so the approval execution path wraps it into the `sink` it injects. */
  sendText(conversationId: string, text: string): Promise<{ sentAt: string }>;
}

/** The extractor's JSON for one opened conversation. `conversation` carries the thread context the
 *  inbox row had (title, participants); `normalize()` reads `messages` and nothing else is required. */
export interface ExtractedThread {
  conversation?: RawConversation;
  messages: RawMessage[];
}

/** The extractor's failure envelope — the same shape with no messages (`{ error: ... }` from the
 *  `dom_*_response.json` fixtures). `normalize()` yields nothing for it; `mapError()` classifies it. */
export interface ExtractedError {
  error: unknown;
}

/** A LinkedIn UI update stopped a selector from matching. Not transient, and not fixable by a retry —
 *  the adapter reports `degraded` and keeps polling on its normal schedule while a human ships a fix. */
export class SelectorMissingError extends Error {
  constructor(readonly selector = "unknown") {
    super(`LinkedIn selector not found: ${selector}`);
    this.name = "SelectorMissingError";
  }
}
