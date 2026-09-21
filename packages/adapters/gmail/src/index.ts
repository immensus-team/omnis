import {
  type Adapter,
  AdapterError,
  type AdapterEvent,
  type AuthRef,
  type Capabilities,
  type Health,
  type NormalizedItem,
  type Outbound,
  type SendResult,
  type ThreadRef,
} from "@omnis/protocol";
import { google } from "googleapis";
import type { gmail_v1, pubsub_v1 } from "googleapis";
import { readKeychainSecret } from "./keychain.js";

export const CHANNEL = "gmail" as const;

// googleapis@161's own dependency (`^10.2.0`) resolves to a different
// google-auth-library copy than its transitive dep via googleapis-common
// (pinned exactly at 10.5.0) — the package re-exports `OAuth2Client`
// from the former, but `google.auth.OAuth2` constructs from the latter, so
// the two nominal types don't structurally unify under strict mode.
// Deriving the type from the constructor we actually call keeps both usages
// pointed at the same class identity (deviation from plan step 6, which
// assumed a plain `google-auth-library` devDependency import would line up).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const CAPABILITIES: Capabilities = {
  read: true,
  write: true,
  realtime: true,
  history: true,
  media: true,
  markRead: true,
  typing: false,
  archive: true,
  delete: false,
};

export interface GmailAdapterDeps {
  oauthClientId: string;
  oauthClientSecret: string;
  oauthClient?: OAuth2Client;
  gmailClient?: gmail_v1.Gmail;
  pubsubClient?: pubsub_v1.Pubsub;
  pubsubSubscription?: string;
  sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
  now?: () => Date;
}

export function createGmailAdapter(deps: GmailAdapterDeps): Adapter {
  const now = deps.now ?? (() => new Date());
  let oauth: OAuth2Client | undefined;
  let status: Health["status"] = "down";
  let lastEventAt: string | null = null;
  let lastError: Health["lastError"];

  return {
    id: "gmail",
    channel: CHANNEL,
    capabilities: () => CAPABILITIES,

    async connect(auth: AuthRef): Promise<void> {
      const refreshToken = await readKeychainSecret(auth.keychainService, CHANNEL);
      oauth =
        deps.oauthClient ?? new google.auth.OAuth2(deps.oauthClientId, deps.oauthClientSecret);
      oauth.setCredentials({ refresh_token: refreshToken });
      try {
        await oauth.getAccessToken();
      } catch (cause) {
        status = "down";
        throw new AdapterError(
          "auth_revoked",
          CHANNEL,
          "Gmail refresh token rejected",
          undefined,
          cause,
        );
      }
      status = "healthy";
      lastEventAt = now().toISOString();
    },

    async disconnect(): Promise<void> {
      status = "down";
    },

    async *backfill(since?: Date): AsyncIterable<NormalizedItem> {
      const gmail =
        deps.gmailClient ?? google.gmail({ version: "v1", ...(oauth ? { auth: oauth } : {}) });
      const q = since ? `after:${Math.floor(since.getTime() / 1000)}` : undefined;
      let pageToken: string | undefined;
      do {
        let list: { data: { messages?: { id?: string | null }[]; nextPageToken?: string | null } };
        try {
          list = await gmail.users.messages.list({
            userId: "me",
            q,
            pageToken,
            maxResults: 100,
          } as never);
        } catch (cause) {
          throw mapApiError(cause);
        }
        for (const ref of list.data.messages ?? []) {
          if (!ref.id) continue;
          let full: { data: unknown };
          try {
            full = await gmail.users.messages.get({
              userId: "me",
              id: ref.id,
              format: "full",
            } as never);
          } catch (cause) {
            throw mapApiError(cause);
          }
          for (const item of normalize(full.data)) yield item;
        }
        pageToken = list.data.nextPageToken ?? undefined;
      } while (pageToken);
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      const gmail =
        deps.gmailClient ?? google.gmail({ version: "v1", ...(oauth ? { auth: oauth } : {}) });
      const pubsub =
        deps.pubsubClient ?? google.pubsub({ version: "v1", ...(oauth ? { auth: oauth } : {}) });
      const subscription = deps.pubsubSubscription;
      if (!subscription)
        throw new AdapterError("fatal_protocol", CHANNEL, "pubsubSubscription not configured");

      async function* pull(): AsyncGenerator<NormalizedItem | AdapterEvent> {
        for (;;) {
          const res = await pubsub.projects.subscriptions.pull({
            subscription,
            requestBody: { maxMessages: 10 },
          } as never);
          const messages =
            (res as { data?: { receivedMessages?: { ackId?: string }[] } }).data
              ?.receivedMessages ?? [];
          for (const received of messages) {
            const list = await gmail.users.messages.list({ userId: "me", maxResults: 10 } as never);
            for (const ref of (list as { data: { messages?: { id?: string }[] } }).data.messages ??
              []) {
              if (!ref.id) continue;
              const full = await gmail.users.messages.get({
                userId: "me",
                id: ref.id,
                format: "full",
              } as never);
              for (const item of normalize((full as { data: unknown }).data)) yield item;
            }
            if (received.ackId) {
              await pubsub.projects.subscriptions.acknowledge({
                subscription,
                requestBody: { ackIds: [received.ackId] },
              } as never);
            }
          }
        }
      }
      return pull();
    },

    // Until the approval gate (US-A07) exists, the real messages.send is never called.
    async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
      const sink =
        deps.sink ??
        (async (): Promise<SendResult> => ({
          externalId: `mock-${now().getTime()}`,
          sentAt: now().toISOString(),
        }));
      return sink(thread, draft);
    },

    async markRead(thread: ThreadRef): Promise<void> {
      const gmail =
        deps.gmailClient ?? google.gmail({ version: "v1", ...(oauth ? { auth: oauth } : {}) });
      try {
        await gmail.users.messages.modify({
          userId: "me",
          id: thread.externalId,
          requestBody: { removeLabelIds: ["UNREAD"] },
        } as never);
      } catch (cause) {
        throw mapApiError(cause);
      }
    },

    async archive(thread: ThreadRef): Promise<void> {
      const gmail =
        deps.gmailClient ?? google.gmail({ version: "v1", ...(oauth ? { auth: oauth } : {}) });
      try {
        await gmail.users.messages.modify({
          userId: "me",
          id: thread.externalId,
          requestBody: { removeLabelIds: ["INBOX"] },
        } as never);
      } catch (cause) {
        throw mapApiError(cause);
      }
    },

    async health(): Promise<Health> {
      return {
        channel: CHANNEL,
        accountExternalId: "",
        status,
        lastEventAt,
        ...(lastError ? { lastError } : {}),
      };
    },
  };
}

function decodeGmailBody(data: string | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

/** Splits an RFC 5322 address list item by item. A comma inside quotes ("Lee, Dana" <dana@example.com>) is
 *  not a separator. */
function splitAddressList(headerValue: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < headerValue.length; i += 1) {
    const ch = headerValue[i];
    if (ch === '"' && headerValue[i - 1] !== "\\") quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(headerValue.slice(start, i));
      start = i + 1;
    }
  }
  out.push(headerValue.slice(start));
  return out;
}

// "Name <a@b.com>, Name2 <c@d.com>" → one ParticipantRef per address, in order, deduped.
// externalId uses only the mailbox address — if the same person became a different identity whenever
// the display name changed, Phase B's person resolution (A3 §10) would split one person into several.
function parseAddressList(headerValue: string): { externalId: string; displayName: string }[] {
  const seen = new Set<string>();
  const out: { externalId: string; displayName: string }[] = [];
  for (const raw of splitAddressList(headerValue)) {
    const entry = raw.trim();
    if (!entry) continue;
    const angled = /^(.*)<([^>]*)>\s*$/.exec(entry);
    const address = (angled?.[2] ?? entry).trim();
    const displayName = angled?.[1]?.trim().replace(/^"|"$/g, "") || address;
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push({ externalId: address, displayName });
  }
  return out;
}

/** Mail with a broken Date header (spam, gateway relays) is common. If toISOString() throws a
 *  RangeError, the whole backfill stream calling normalize() dies over that one message, so fall
 *  back to the internalDate (epoch ms) Gmail always sends with it, and to now() if that is missing. */
function parseSentAt(dateHeader: string, internalDate: string | undefined): string {
  const parsed = [
    dateHeader ? new Date(dateHeader) : null,
    internalDate ? new Date(Number(internalDate)) : null,
  ].find((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  return (parsed ?? new Date()).toISOString();
}

export function normalize(raw: unknown): NormalizedItem[] {
  const r = raw as {
    id?: string;
    threadId?: string;
    internalDate?: string;
    payload?: { headers?: { name?: string; value?: string }[]; body?: { data?: string } };
  };
  if (!r.id || !r.threadId) return [];
  const headers = r.payload?.headers ?? [];
  const header = (name: string) => headers.find((h) => h.name === name)?.value ?? "";

  const subject = header("Subject");
  const from = header("From");
  const messageId = header("Message-Id");
  const bodyText = decodeGmailBody(r.payload?.body?.data);
  const sentAt = parseSentAt(header("Date"), r.internalDate);

  const participants = [
    ...parseAddressList(from),
    ...parseAddressList(header("To")),
    ...parseAddressList(header("Cc")),
  ].filter((p, i, all) => all.findIndex((other) => other.externalId === p.externalId) === i);

  return [
    {
      threadExternalId: r.threadId,
      externalId: r.id,
      kind: "email",
      // The sender's mailbox address, not the raw `From` header. `author.id` is a person's external
      // identity for the whole ingest path: kernel/ingest.ts resolves it with resolvePerson and
      // takes the display name off the participants entry whose externalId matches it. Hand it
      // "Dana Lee <dana@example.com>" and the lookup misses on both counts — the person is created
      // under the header as their identity, named after the header, and the inbox row then prints
      // that name in its bold first-line slot ("Dana Lee <dana@example.com>", initials "D<").
      author: { kind: "person", id: parseAddressList(from)[0]?.externalId ?? "" },
      body: subject ? `Subject: ${subject}\n\n${bodyText}` : bodyText,
      attachments: [],
      sentAt,
      status: "received",
      sourceHash: messageId || r.id,
      threadMeta: {
        externalId: r.threadId,
        kind: "email",
        title: subject || null,
        participants,
        lastItemAt: sentAt,
        archivedAt: null,
      },
    },
  ];
}

export function mapApiError(cause: unknown): AdapterError {
  const err = cause as { code?: number };
  if (err.code === 429)
    return new AdapterError(
      "retryable_rate_limit",
      CHANNEL,
      "Gmail API rate limited",
      60_000,
      cause,
    );
  if (err.code === 401)
    return new AdapterError("auth_expired", CHANNEL, "Gmail API auth expired", undefined, cause);
  return new AdapterError("retryable_network", CHANNEL, "Gmail API call failed", undefined, cause);
}
