import {
  type Adapter,
  AdapterError,
  type AdapterEvent,
  type Attachment,
  type AuthRef,
  type Capabilities,
  type Health,
  type NormalizedItem,
  type Outbound,
  type SendResult,
  type ThreadRef,
} from "@omnis/protocol";
import { readKeychainSecret } from "./keychain.js";

export const CHANNEL = "outlook" as const;

const CAPABILITIES: Capabilities = {
  read: true,
  write: true,
  realtime: false, // delta 폴링이지 push가 아니다(A1 §2.4 "webhook 전 단계")
  history: true,
  media: true,
  markRead: true,
  typing: false,
  archive: true,
  delete: false,
};

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}
interface GraphMessage {
  id?: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  "@removed"?: { reason?: string };
}

/** ponytail: 정규식 태그 제거만 한다 — 완전한 HTML→텍스트 변환이 필요해지면(표·리스트 서식 깨짐이
 *  체감되면) 그때 라이브러리로 승격한다. Gmail/Graph 둘 다 body를 그대로 저장하고 검색은
 *  `items.search_tsv`(plain 텍스트)가 하므로 v1은 이걸로 충분하다. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addr(a?: GraphAddress): { externalId: string; displayName: string } | null {
  const email = a?.emailAddress?.address;
  if (!email) return null;
  return { externalId: email, displayName: a?.emailAddress?.name || email };
}

/** A message with a broken receivedDateTime (spam, gateway relays, or an empty string left over from
 *  serialization) makes toISOString() throw a RangeError — normalize() runs per message inside the
 *  backfill()/subscribe() loop, so that one message kills the whole stream. Fall back to the
 *  sentDateTime Graph sends alongside it, and to now() if that is unusable too (same principle as
 *  Gmail's internalDate fallback). A surviving Date may carry no milliseconds (`...20Z`), so round-trip
 *  it into the `.SSSZ` form the NormalizedItem contract expects. */
function parseSentAt(receivedDateTime?: string, sentDateTime?: string): string {
  const parsed = [receivedDateTime, sentDateTime]
    .map((s) => (s ? new Date(s) : null))
    .find((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  return (parsed ?? new Date()).toISOString();
}

export function normalize(raw: unknown): NormalizedItem[] {
  const m = raw as GraphMessage;
  // delta tombstone: 삭제된 메시지를 알리는 행이라 콘텐츠가 없다. items를 지우지 않는다(A3 §11) —
  // 그냥 아이템을 만들지 않을 뿐이다.
  if (m["@removed"] !== undefined) return [];
  if (!m.id || !m.conversationId) return [];

  const bodyText =
    m.body?.contentType === "html" ? stripHtml(m.body.content ?? "") : (m.body?.content ?? "");
  const participants = [
    addr(m.from),
    ...(m.toRecipients ?? []).map(addr),
    ...(m.ccRecipients ?? []).map(addr),
  ]
    .filter((p): p is { externalId: string; displayName: string } => p !== null)
    .filter((p, i, all) => all.findIndex((o) => o.externalId === p.externalId) === i);
  const sentAt = parseSentAt(m.receivedDateTime, m.sentDateTime);
  const attachments: Attachment[] = []; // 다운로드는 /attachments 개별 호출(A1 §2.4) — Gmail과 동일 원칙

  return [
    {
      threadExternalId: m.conversationId,
      externalId: m.id,
      kind: "email",
      author: { kind: "person", id: m.from?.emailAddress?.address ?? "" },
      body: m.subject ? `Subject: ${m.subject}\n\n${bodyText}` : bodyText,
      attachments,
      sentAt,
      status: "received",
      sourceHash: m.internetMessageId || m.id,
      threadMeta: {
        externalId: m.conversationId,
        kind: "email",
        title: m.subject || null,
        participants,
        lastItemAt: sentAt,
        archivedAt: null,
      },
    },
  ];
}

export function mapApiError(cause: unknown): AdapterError {
  const err = cause as { statusCode?: number; headers?: Record<string, string> };
  if (err.statusCode === 429) {
    const retryAfterSec = Number(err.headers?.["retry-after"] ?? "60");
    return new AdapterError(
      "retryable_rate_limit",
      CHANNEL,
      "Graph API rate limited",
      retryAfterSec * 1000,
      cause,
    );
  }
  if (err.statusCode === 401)
    return new AdapterError("auth_expired", CHANNEL, "Graph API auth expired", undefined, cause);
  if (err.statusCode === 403)
    return new AdapterError(
      "auth_revoked",
      CHANNEL,
      "Graph API access forbidden",
      undefined,
      cause,
    );
  return new AdapterError("retryable_network", CHANNEL, "Graph API call failed", undefined, cause);
}

/** 이 어댑터가 실제로 부르는 부분집합만 duck-typing한다 — `@microsoft/microsoft-graph-client`의
 *  `Client` 인스턴스가 구조적으로 이 인터페이스를 만족하므로 실제 SDK와 테스트 mock 둘 다 통과한다
 *  (Gmail의 OAuth2Client 이중 타입 회피와 같은 이유, packages/adapters/gmail/src/index.ts 상단 주석 참고). */
export interface GraphClientLike {
  api(path: string): {
    get(): Promise<Record<string, unknown>>;
    patch(body: unknown): Promise<unknown>;
    post(body: unknown): Promise<unknown>;
  };
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
  fetchFn: typeof fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetchFn("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite",
    }).toString(),
  });
  if (!res.ok) {
    throw new AdapterError(
      "auth_revoked",
      CHANNEL,
      `Outlook token refresh failed: ${res.status}`,
      undefined,
      await res.text().catch(() => undefined),
    );
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

export interface OutlookAdapterDeps {
  oauthClientId: string;
  graphClient?: GraphClientLike;
  fetchFn?: typeof fetch;
  pollIntervalMs?: number; // subscribe() delta 폴링 간격, 기본 5분(jobs.outlook_delta_poll 주기와 동일)
  sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
  now?: () => Date;
}

export function createOutlookAdapter(deps: OutlookAdapterDeps): Adapter {
  const now = deps.now ?? ((): Date => new Date());
  const fetchFn = deps.fetchFn ?? fetch;
  let graphClient: GraphClientLike | undefined = deps.graphClient;
  let status: Health["status"] = "down";
  let lastEventAt: string | null = null;
  let lastError: Health["lastError"];

  return {
    id: "outlook",
    channel: CHANNEL,
    capabilities: () => CAPABILITIES,

    async connect(auth: AuthRef): Promise<void> {
      try {
        if (deps.graphClient !== undefined) {
          // 테스트 주입 경로: 이미 자격증명이 설정된 클라이언트를 그대로 쓴다(Keychain 조회 없음,
          // google-calendar 어댑터와 동일 패턴 — packages/adapters/google-calendar/src/index.ts connect()).
          graphClient = deps.graphClient;
        } else {
          const refreshToken = await readKeychainSecret(
            auth.keychainService,
            auth.keychainAccount,
            CHANNEL,
          );
          const { accessToken } = await refreshAccessToken(
            deps.oauthClientId,
            refreshToken,
            fetchFn,
          );
          const { Client } = await import("@microsoft/microsoft-graph-client");
          graphClient = Client.init({
            authProvider: (done) => done(null, accessToken),
          }) as unknown as GraphClientLike;
        }
      } catch (cause) {
        status = "down";
        if (cause instanceof AdapterError) throw cause;
        throw new AdapterError("auth_revoked", CHANNEL, "Outlook connect failed", undefined, cause);
      }
      status = "healthy";
      lastEventAt = now().toISOString();
    },

    async disconnect(): Promise<void> {
      status = "down";
    },

    async *backfill(): AsyncIterable<NormalizedItem> {
      if (graphClient === undefined)
        throw new AdapterError("fatal_protocol", CHANNEL, "backfill() called before connect()");
      const client = graphClient;
      let link = "/me/mailFolders/inbox/messages?$top=50";
      for (;;) {
        let res: { value?: unknown[]; "@odata.nextLink"?: string };
        try {
          res = (await client.api(link).get()) as {
            value?: unknown[];
            "@odata.nextLink"?: string;
          };
        } catch (cause) {
          throw mapApiError(cause);
        }
        for (const raw of res.value ?? []) {
          for (const item of normalize(raw)) yield item;
        }
        const next = res["@odata.nextLink"];
        if (next === undefined) break;
        link = next;
      }
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      if (graphClient === undefined)
        throw new AdapterError("fatal_protocol", CHANNEL, "subscribe() called before connect()");
      const client = graphClient;
      const intervalMs = deps.pollIntervalMs ?? 300_000; // outlook_delta_poll cron */5 * * * *
      const BASE = "/me/mailFolders/inbox/messages/delta";

      async function* poll(): AsyncGenerator<NormalizedItem | AdapterEvent> {
        let link = BASE;
        for (;;) {
          let res: { value?: unknown[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
          try {
            res = (await client.api(link).get()) as {
              value?: unknown[];
              "@odata.nextLink"?: string;
              "@odata.deltaLink"?: string;
            };
          } catch (cause) {
            const err = cause as { statusCode?: number };
            if (err.statusCode === 410) {
              link = BASE; // delta token 만료 → 풀 재동기화(A1 §2.4)
              continue;
            }
            throw mapApiError(cause);
          }
          for (const raw of res.value ?? []) {
            for (const item of normalize(raw)) yield item;
          }
          const settled = res["@odata.deltaLink"];
          link = res["@odata.nextLink"] ?? settled ?? BASE;
          if (settled !== undefined && intervalMs > 0)
            await new Promise((r) => setTimeout(r, intervalMs));
        }
      }
      return poll();
    },

    // 승인 게이트(US-A07, Phase A에 이미 존재) 전까지 실제 sendMail은 절대 호출하지 않는다.
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
      if (graphClient === undefined)
        throw new AdapterError("fatal_protocol", CHANNEL, "markRead() called before connect()");
      try {
        await graphClient.api(`/me/messages/${thread.externalId}`).patch({ isRead: true });
      } catch (cause) {
        throw mapApiError(cause);
      }
    },

    async archive(thread: ThreadRef): Promise<void> {
      if (graphClient === undefined)
        throw new AdapterError("fatal_protocol", CHANNEL, "archive() called before connect()");
      try {
        await graphClient
          .api(`/me/messages/${thread.externalId}/move`)
          .post({ destinationId: "archive" });
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
