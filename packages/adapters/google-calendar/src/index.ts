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
import type { calendar_v3 } from "googleapis";
import { readKeychainSecret } from "./keychain.js";

export const CHANNEL = "gcal" as const;

// Same googleapis@161 dual-google-auth-library issue as the Gmail adapter
// (packages/adapters/gmail/src/index.ts) — derive the type from the
// constructor we actually call instead of importing `google-auth-library`
// directly, so both usages point at the same class identity (deviation from
// plan step 1/4, which assumed a plain `google-auth-library` devDependency
// import would line up).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const CAPABILITIES: Capabilities = {
  read: true,
  write: true,
  realtime: false,
  history: true,
  media: false,
  markRead: false,
  typing: false,
  archive: false,
  delete: false,
};

export interface GoogleCalendarAdapterDeps {
  oauthClientId: string;
  oauthClientSecret: string;
  oauthClient?: OAuth2Client;
  calendarClient?: calendar_v3.Calendar;
  pollIntervalMs?: number;
  sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
  now?: () => Date;
}

export function createGoogleCalendarAdapter(deps: GoogleCalendarAdapterDeps): Adapter {
  const now = deps.now ?? (() => new Date());
  let oauth: OAuth2Client | undefined;
  let status: Health["status"] = "down";
  let lastEventAt: string | null = null;

  return {
    id: "google-calendar",
    channel: CHANNEL,
    capabilities: () => CAPABILITIES,

    async connect(auth: AuthRef): Promise<void> {
      // A1 §2.3: Calendar는 Gmail과 같은 Cloud 프로젝트/client를 쓰므로
      // auth.keychainService는 호출자가 omnis.gmail.<email>을 그대로 넘긴다(재사용).
      const refreshToken = await readKeychainSecret(
        auth.keychainService,
        auth.keychainAccount,
        CHANNEL,
      );
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
          "Calendar refresh token rejected",
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

    async *backfill(): AsyncIterable<NormalizedItem> {
      const calendar =
        deps.calendarClient ??
        google.calendar({ version: "v3", ...(oauth ? { auth: oauth } : {}) });
      const quarterStart = new Date(now().getFullYear(), Math.floor(now().getMonth() / 3) * 3, 1);
      const timeMax = new Date(now().getTime() + 90 * 24 * 60 * 60 * 1000);
      let pageToken: string | undefined;
      do {
        // deviation (plan step 4): googleapis' actual events.list() response
        // types nextPageToken as `string | null` (Schema$Events), not the
        // plan's `string | undefined` — same shape mismatch already worked
        // around for nextSyncToken in subscribe() above.
        let res: { data: { items?: unknown[]; nextPageToken?: string | null } };
        try {
          res = await calendar.events.list({
            calendarId: "primary",
            singleEvents: true,
            pageToken,
            timeMin: quarterStart.toISOString(),
            timeMax: timeMax.toISOString(),
          } as never);
        } catch (cause) {
          throw new AdapterError(
            "retryable_network",
            CHANNEL,
            "events.list backfill failed",
            undefined,
            cause,
          );
        }
        for (const raw of res.data.items ?? []) {
          for (const item of normalize(raw)) yield item;
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      const calendar =
        deps.calendarClient ??
        google.calendar({ version: "v3", ...(oauth ? { auth: oauth } : {}) });
      const intervalMs = deps.pollIntervalMs ?? 120_000;

      async function* poll(): AsyncGenerator<NormalizedItem | AdapterEvent> {
        let syncToken: string | undefined;
        for (;;) {
          let res: { data: { items?: unknown[]; nextSyncToken?: string | null } };
          try {
            res = await calendar.events.list({
              calendarId: "primary",
              syncToken,
              singleEvents: true,
              ...(syncToken ? {} : { timeMin: new Date().toISOString() }),
            } as never);
          } catch (cause) {
            const err = cause as { code?: number };
            if (err.code === 410) {
              syncToken = undefined;
              continue;
            }
            throw new AdapterError(
              "retryable_network",
              CHANNEL,
              "events.list failed",
              undefined,
              cause,
            );
          }
          for (const raw of res.data.items ?? []) {
            for (const item of normalize(raw)) yield item;
          }
          syncToken = res.data.nextSyncToken ?? undefined;
          if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
        }
      }
      return poll();
    },

    // 승인 게이트(US-A07) 전까지 events.insert/update는 절대 호출하지 않는다(A1 §2.3 "항상 pending_approvals를 거쳐").
    async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
      const sink =
        deps.sink ??
        (async (): Promise<SendResult> => ({
          externalId: `mock-${now().getTime()}`,
          sentAt: now().toISOString(),
        }));
      return sink(thread, draft);
    },

    async health(): Promise<Health> {
      return { channel: CHANNEL, accountExternalId: "", status, lastEventAt };
    },
  };
}

interface GCalEvent {
  id?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { email?: string; displayName?: string }[];
}

export function normalize(raw: unknown): NormalizedItem[] {
  const e = raw as GCalEvent;
  if (!e.id || !e.start?.dateTime) return [];
  return [
    {
      threadExternalId: e.id,
      externalId: e.id,
      kind: "event",
      author: { kind: "system", id: "" },
      body: e.summary ?? "",
      attachments: [],
      sentAt: e.start.dateTime,
      status: "received",
      sourceHash: e.id,
      threadMeta: {
        externalId: e.id,
        kind: "calendar",
        title: e.summary ?? null,
        participants: (e.attendees ?? []).map((a) => ({
          externalId: a.email ?? "",
          displayName: a.displayName ?? a.email ?? "",
        })),
        lastItemAt: e.start.dateTime,
        archivedAt: e.status === "cancelled" ? e.start.dateTime : null,
      },
    },
  ];
}
