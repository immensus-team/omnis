// A1 §2.9: LinkedIn's parallel signal. A notification email from LinkedIn gives "new message arrived"
// almost for free — it reuses the Gmail pipeline instead of a second login — but it carries only a
// preview, never the conversation. The Playwright adapter (US-C10) is what reads real messages.
//
// The notification's exact body structure was UNVERIFIED when this was written (spike A1-⑧ did not
// have a sample yet), which is why every fixture here is marked synthetic-from-docs and task 26
// re-pins them against a real message. The parse rules below are deliberately narrow: a missed
// notification costs one delayed ping, while a false positive puts a wrong person and a wrong thread
// in the inbox.
import type { NormalizedItem } from "@omnis/protocol";

/** Only LinkedIn's own mail servers may produce a LinkedIn signal. `author.id` is the Gmail adapter's
 *  mailbox address; the trailing `>?$` also covers a raw `Name <addr>` form, so a header that reaches
 *  this point unstripped still matches. */
export const LINKEDIN_SENDER = /@(?:e\.)?linkedin\.com>?$/i;

/** Namespaces the derived item's id and source hash. Both keep the Gmail item's own key as their
 *  tail, so the two rows stay traceable to each other; the hub keys `meta.partial` off this prefix
 *  (the item is a "new message arrived" ping, not the message). */
export const LINKEDIN_EMAIL_PREFIX = "li-email:";
/** Thread key prefix when the conversation id is known (`li:<conversation id>`). */
export const LINKEDIN_THREAD_PREFIX = "li:";

/** How much of the notification's preview the derived body carries (A1 §2.9: preview only). */
export const PREVIEW_MAX_CHARS = 300;

/** An invite or an alert is not a message, and both reuse LinkedIn's sender addresses and profile
 *  links. Matched against the subject only: scanning the quoted preview would drop genuine messages
 *  that happen to mention "hiring". */
const NOT_A_MESSAGE = [
  /invitation|invited you to connect|wants to connect|would like to connect|connection request/i,
  /job alert|new jobs|jobs for you|job opportunities|recommended jobs|job recommendations|apply now|\bhiring\b/i,
];

/** The subject forms a message notification uses. The name group is the sender's display name — the
 *  only place the notification states it, since the From header is LinkedIn itself. */
const SUBJECT_FORMS = [
  /^(?<name>.+?)\s+(?:sent you a message|replied to your message)\s*$/i,
  /^(?:you have )?a? ?new message from\s+(?<name>.+?)\s*$/i,
];

/** The same two phrases, read off the body for mails whose subject does not state them. */
const BODY_FORMS = [
  /(?:^|\n)[^\S\n]*(?<name>[^\n]{1,80}?)\s+(?:sent you a message|replied to your message)\b/i,
  /(?:^|\n)[^\S\n]*(?:you have )?a? ?new message from\s+(?<name>[^\n]{1,80}?)[^\S\n]*(?:\n|$)/i,
];

/** Gmail's normalize() prepends "Subject: …" to the body (packages/adapters/gmail/src/index.ts). */
const SUBJECT_LINE = /^Subject:[^\S\n]*(.*)$/im;
/** `https://www.linkedin.com/messaging/thread/2-YWJjMTIz/`, also under `/comm/`. */
const THREAD_LINK = /\/messaging\/thread\/([^/?#\s"'<>]+)/;
/** A profile link, on the canonical host or a regional one. */
const PROFILE_LINK = /https?:\/\/(?:[a-z]{2,4}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/i;
/** LinkedIn quotes the message in straight or curly quotes. */
const QUOTED = /["“]([\s\S]{1,600}?)["”]/;

/** The subject, from both places it can appear: Gmail's `threadMeta.title` and the "Subject:" line its
 *  normalize() prepends to the body. A real notification has the same text in both, but a single
 *  source is not enough to reject on — an invite whose title is missing would otherwise be read off
 *  the body line alone and slip through. */
function subjectLines(item: NormalizedItem): string[] {
  const title = item.threadMeta?.title;
  const line = SUBJECT_LINE.exec(item.body)?.[1];
  return [title, line]
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .map((s) => s.trim());
}

/** Body text without the "Subject:" line, so phrase and preview scanning never reads the subject as
 *  a body line (an invite's subject is not a message preview). */
function bodyText(body: string): string {
  return body.replace(/^Subject:[^\S\n]*[^\n]*(?:\r?\n)?/i, "");
}

function nameFrom(subject: string): string | null {
  for (const re of SUBJECT_FORMS) {
    const name = re.exec(subject)?.groups?.name?.trim();
    if (name !== undefined && name !== "") return name;
  }
  return null;
}

function nameFromBody(text: string): string | null {
  for (const re of BODY_FORMS) {
    const name = re.exec(text)?.groups?.name?.trim();
    if (name !== undefined && name !== "") return name;
  }
  return null;
}

/** The quoted message text, collapsed to one line and capped. Anything not inside quotes is the
 *  notification's own boilerplate ("View message: …") and must never be mistaken for the message. */
function previewOf(text: string): string {
  const quoted = QUOTED.exec(text)?.[1] ?? "";
  return quoted.replace(/\s+/g, " ").trim().slice(0, PREVIEW_MAX_CHARS);
}

/** The sender's profile. Regional hosts are folded onto www.linkedin.com: the kernel resolves persons
 *  by author.id, so `uk.linkedin.com/in/x` and `www.linkedin.com/in/x` must not become two people. */
function profileOf(body: string): { url: string; slug: string } | null {
  const slug = PROFILE_LINK.exec(body)?.[1];
  if (slug === undefined) return null;
  return { url: `https://www.linkedin.com/in/${slug}`, slug };
}

/** A LinkedIn notification email → the `linkedin` item it announces, or null when the mail is not a
 *  message notification (an invite, an alert, or not LinkedIn's mail at all). */
export function parseNotificationEmail(item: NormalizedItem): NormalizedItem | null {
  if (item.kind !== "email") return null;
  if (!LINKEDIN_SENDER.test(item.author.id.trim())) return null;

  const subjects = subjectLines(item);
  if (subjects.some((subject) => NOT_A_MESSAGE.some((re) => re.test(subject)))) return null;

  const text = bodyText(item.body);
  let senderName: string | null = null;
  for (const subject of subjects) senderName ??= nameFrom(subject);
  senderName ??= nameFromBody(text);
  if (senderName === null) return null;

  const profile = profileOf(item.body);
  if (profile === null) return null;

  const conversationId = THREAD_LINK.exec(item.body)?.[1];
  // No conversation link means no id to key the thread by, but the sender still identifies it: one
  // thread per person, which is how the notification reads. US-C10 replaces this thread with the
  // real conversation id once the DOM path has seen the conversation.
  const threadExternalId =
    conversationId === undefined
      ? `${LINKEDIN_EMAIL_PREFIX}${profile.slug}`
      : `${LINKEDIN_THREAD_PREFIX}${conversationId}`;

  return {
    threadExternalId,
    externalId: `${LINKEDIN_EMAIL_PREFIX}${item.externalId}`,
    kind: "message",
    author: { kind: "person", id: profile.url },
    body: previewOf(text),
    attachments: [],
    sentAt: item.sentAt,
    status: "received",
    sourceHash: `${LINKEDIN_EMAIL_PREFIX}${item.sourceHash}`,
    threadMeta: {
      externalId: threadExternalId,
      kind: "dm",
      title: senderName,
      participants: [{ externalId: profile.url, displayName: senderName }],
      lastItemAt: item.sentAt,
      archivedAt: null,
    },
  };
}
