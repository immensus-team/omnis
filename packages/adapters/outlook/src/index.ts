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
  // 원본 receivedDateTime엔 밀리초가 없을 수 있다(`...20Z`) — NormalizedItem 계약은 항상
  // `.SSSZ` 형태를 기대하므로(다른 어댑터와 동일 포맷) Date를 한 번 왕복시켜 정규화한다.
  const sentAt = new Date(m.receivedDateTime ?? Date.now()).toISOString();
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
      const refreshToken = await readKeychainSecret(
        auth.keychainService,
        auth.keychainAccount,
        CHANNEL,
      );
      try {
        const { accessToken } = await refreshAccessToken(deps.oauthClientId, refreshToken, fetchFn);
        if (deps.graphClient === undefined) {
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

    backfill(): AsyncIterable<NormalizedItem> {
      throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 4");
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      throw new AdapterError(
        "fatal_unsupported",
        CHANNEL,
        "subscribe not implemented until Task 4",
      );
    },

    async send(): Promise<never> {
      throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 5");
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
