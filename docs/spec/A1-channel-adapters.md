# A1 — Channel Adapter Detailed Contract

Version 1.0 (2026-09-20). 0.9→0.95→1.0: incorporates global review rounds 1 and 2. Sources: `00-omnis-design.md` (master, §4.1 L1 Adapters/§6 Data Model/§8 Adapter Contract/§16 Phase 0/D4·D10·D12 decisions), `research/04, 05, 06, 07, 08, 21, 25`. Where the master and this appendix conflict, the master wins — this document finalizes the sketch in master §8 into a complete contract and fills the §16 Phase 0 spikes with per-channel detailed procedures.

## Decisions this appendix finalizes

| # | Decision |
|---|---|
| A1-D1 | The common `Adapter` interface keeps the method signatures from the master §8 sketch unchanged and EXTENDs the method list with `disconnect?()` and `archive?()` (§1.6 — `archive?()` is required to actually implement the Gmail/Outlook `archive=O` entries in the §3 write-back table). Thread metadata rides on `NormalizedItem.threadMeta` rather than a separate stream (saves a round trip). TS uses camelCase, Postgres persistence uses snake_case — the kernel write path owns the mapping. |
| A1-D2 | Per-channel realtime strategy is fixed as a hybrid: push-capable channels (Slack Socket Mode, Gmail Pub/Sub pull, Telegram MTProto, Beeper WS) are push-first; the rest (Calendar, Outlook initially, KakaoTalk, LinkedIn) default to polling and layer push/webhook on top conditionally. |
| A1-D3 | WhatsApp keeps a dual path: Beeper Desktop API as primary, the whatsmeow Go sidecar as fallback. The switch condition is actual send success in Phase 0 spike A1-② (§4 table). |
| A1-D4 | Because of `mautrix/linkedin`'s 20-second session-death bug (issue #55, opened 2026-05, unresolved), LinkedIn rules out the Beeper/mautrix path and uses a resident Playwright profile as primary. Gmail notification-email parsing runs alongside as a low-cost "new message arrived" signal. |
| A1-D5 | KakaoTalk uses kmsg as primary, running `kmsg mcp-server` (3 tools: `kmsg_read`/`kmsg_send`/`kmsg_send_image`) and `kmsg watch --json` (separate process) as separate processes. Send follows the master Q3 default and opens under an approval gate after two weeks of stable reads. |
| A1-D6 | write-back scope differs per channel, is declared through `Capabilities`, and the UI exposes only declared capabilities (master §4.1 principle, unchanged). Fixed per channel in the §3 table. |
| A1-D7 | Errors are classified into 6 kinds and the retry policy is fixed per kind (§2.4). Auth-class errors are handed to a human immediately via a `pending` system Item + `auth_required` event, and are never retried automatically. |
| A1-D8 | Contract tests use fixture replay: the adapter's pure raw→Normalized transform is verified with no live connection. The minimum scenario set per adapter is fixed in §2.5. |
| A1-D9 | Process placement splits by channel character: the 5 API-based channels (Slack/Gmail/Calendar/Outlook/Telegram) run as a LaunchDaemon (embedded in omnis-hub), the 3 channels needing a GUI session (WhatsApp-Beeper, KakaoTalk, LinkedIn) as a LaunchAgent. All on the Mac mini, with no migration until Phase C. |
| A1-D10 | The 14 Phase 0 gates in master §16 are not changed by this appendix. Of those, the 5 channel-related ones (①Calendar·②Beeper·④kmsg·⑨Slack·⑩Gmail) are filled out here in §4 down to per-channel procedures as `A1-①`~`A1-⑤`, and the remaining 3 channels (Outlook/Telegram/LinkedIn) are fixed in §4 as `A1-⑥`~`A1-⑧`, executed not as Phase 0 gates but at each channel's own phase entry (§16 Phase B/B/C). So as not to collide with the circled numbers in master §16 (①~⑭), all 8 channel spikes in this appendix use the `A1-` prefix. |

---

## 1. Common Adapter Interface

### 1.1 Capabilities and Channel

```ts
type Channel =
  | "slack" | "gmail" | "google_calendar" | "outlook"
  | "telegram" | "whatsapp" | "kakaotalk" | "linkedin";

interface Capabilities {
  read: boolean;
  write: boolean;      // whether send() can actually be called
  realtime: boolean;   // whether subscribe() is push/socket based (false = polls internally)
  history: boolean;    // whether backfill() is supported
  media: boolean;      // attachment normalization support
  markRead: boolean;
  typing: boolean;     // typing indicator send/receive
  archive: boolean;    // whether archiving/labeling is actually reflected in the source channel
  delete: boolean;     // false for every channel in v1 (non-goal, confirmed in master §3)
}
```

`accounts.capabilities` (jsonb) serializes this type as-is. The UI does not render at all any button that `capabilities()` does not declare (for example, an "archive" action on a channel without archive support).

### 1.2 Normalization Schema — NormalizedThread / NormalizedItem

Field names use the same semantic axes as the `threads`/`items` tables in master §6 (camelCase in TS, snake_case in Postgres — the mapping is handled in the kernel write path, A1-D1).

```ts
type ThreadKind = "dm" | "group" | "email" | "calendar";
// "agent_session" belongs to A2 (agent bridge), outside the L1 channel adapter scope.

interface ParticipantRef {
  externalId: string;    // channel-native ID (Slack user id, email address, JID, ...)
  displayName: string;
  personId?: string;     // filled by the kernel when matched against the persons table. Adapters always send it empty.
}

interface NormalizedThread {
  externalId: string;          // threads.external_id
  kind: ThreadKind;
  title: string | null;
  participants: ParticipantRef[];
  lastItemAt: string;           // ISO8601, threads.last_item_at
  archivedAt: string | null;
}

type ItemKind = "message" | "email" | "event";
// "agent_turn" / "tool_call" / "system" are A2 and kernel-internal Items — channel adapters never create them.

interface Attachment {
  kind: "image" | "file" | "audio" | "video" | "link";
  url?: string;         // source channel URL or local cache path (after download)
  mimeType?: string;
  sizeBytes?: number;
  caption?: string;
}

interface NormalizedItem {
  threadExternalId: string;
  externalId: string;
  kind: ItemKind;
  author: { kind: "person" | "agent" | "system"; id: string }; // aligned with the A3 items.author_person_id / author_agent_id / (both NULL = system) three-column model — channel adapters fill only person; agent is exclusive to the agent_turn/tool_call Items A2 creates
  body: string;
  bodyHtml?: string;
  attachments: Attachment[];
  sentAt: string;                 // ISO8601, items.sent_at
  status: "received";             // Items created by a channel adapter always start as received
  sourceHash: string;             // idempotency key, defined per channel in §3
  threadMeta?: NormalizedThread;  // filled only for a new thread or when metadata changed (A1-D1)
}
```

As in master §6, `status` moves through `received → read → draft → approved → sent → failed → archived`, but what a channel adapter creates is always `received`. Subsequent state transitions are the responsibility of the kernel and the L3 agent layer; the adapter is not involved.

### 1.3 AdapterEvent / AuthRef

```ts
type AdapterEvent =
  | { kind: "connected"; at: string }
  | { kind: "disconnected"; reason: string; at: string }
  | { kind: "auth_required"; reason: string; authUrl?: string; at: string }
  | { kind: "rate_limited"; retryAfterMs: number; endpoint: string; at: string }
  | { kind: "backfill_progress"; done: number; total: number | null; at: string };

interface AuthRef {
  channel: Channel;
  accountExternalId: string;
  keychainService: string;   // e.g. "omnis.slack.xoxp"
  keychainAccount: string;   // e.g. account external id (team ID, email, ...)
  // The actual token value is never carried in this object. connect() reads the Keychain directly.
}
```

**Keychain naming convention** (defined by A1; A6 and all appendices follow it verbatim — `99-review.md` §1.2 "Keychain naming" ruling): `omnis.<channel>.<kind>.<external_id>` — `channel` is a `Channel` enum value, `kind` is the secret type (`xoxb`/`xoxp`/`token`/`session_key`), and `external_id` is the account identifier (team_id/email/upn, etc.), omitted when the channel has only one kind of secret and does not support multiple accounts.

| Channel | Keychain entry |
|---|---|
| Slack | `omnis.slack.xoxb.<team_id>`, `omnis.slack.xoxp.<team_id>` |
| Gmail | `omnis.gmail.<email>` |
| Outlook | `omnis.outlook.<upn>` |
| Telegram | `omnis.telegram.session_key` |
| WhatsApp(Beeper) | `omnis.beeper.token` |
| WhatsApp(whatsmeow) | `omnis.whatsmeow.session_key` |
| KakaoTalk | none — uses KakaoTalk.app's own login only (§2.8) |
| LinkedIn | none — session cookies are preserved in the Playwright profile directory, Keychain unused (§2.9) |

### 1.4 Error Classification and Retry Policy

```ts
type AdapterErrorKind =
  | "retryable_network"
  | "retryable_rate_limit"
  | "auth_expired"
  | "auth_revoked"
  | "fatal_protocol"
  | "fatal_unsupported";

class AdapterError extends Error {
  kind: AdapterErrorKind;
  channel: Channel;
  retryAfterMs?: number;
  cause?: unknown;
}
```

| Error kind | Auto retry | Backoff | Cap | Behavior afterwards |
|---|---|---|---|---|
| `retryable_network` | Y | 1s → ×2, ±20% jitter, cap 5 min | Unlimited (treated as a connectivity problem) | `health()` → `degraded`. If it persists beyond 5 min, create one system Item in the inbox |
| `retryable_rate_limit` | Y | Honor the server-provided `retryAfterMs` verbatim (fixed 60s if absent) | Unlimited | `health()` → `degraded` |
| `auth_expired` | N | — | — | Emit the `auth_required` event immediately + system Item, wait for the user to re-authenticate (auto retry forbidden — consistent with D10 "security through structure") |
| `auth_revoked` | N | — | — | Same. Not subject to a global kill switch; only that channel stops |
| `fatal_protocol` | N | — | — | `health()` → `down`, write audit_log, ntfy alert |
| `fatal_unsupported` | N | — | — | An action `capabilities()` should never have exposed in the first place — treated as a bug, alert only |

### 1.5 health() Convention

```ts
interface Health {
  channel: Channel;
  accountExternalId: string;
  status: "healthy" | "degraded" | "down";
  lastEventAt: string | null;
  lastError?: { kind: AdapterErrorKind; message: string; at: string };
  latencyMsP50?: number;   // over the last 100 events, realtime channels only
}
```

The healthchecks.io dead-man's-switch (master §15) polls this value every 30 seconds. If `down` persists for 5 minutes, ntfy push + inbox system Item.

### 1.6 Adapter Interface (final)

```ts
interface ThreadRef {
  accountId: string;      // accounts.id (UUID, issued by the kernel)
  externalId: string;     // NormalizedThread.externalId
}

interface OutboundAttachment {
  kind: "image" | "file";
  localPath: string;      // local cache file path
  mimeType: string;
  caption?: string;
}

interface Outbound {
  text: string;
  bodyHtml?: string;
  attachments?: OutboundAttachment[];
  replyToExternalId?: string;  // reply to a specific item in the thread (supported channels only)
}

interface SendResult {
  externalId: string;     // message ID assigned by the source channel
  sentAt: string;
}

interface Adapter {
  id: string;
  channel: Channel;

  capabilities(): Capabilities;
  connect(auth: AuthRef): Promise<void>;
  disconnect?(): Promise<void>;              // for graceful restart, optional

  backfill(since?: Date): AsyncIterable<NormalizedItem>;
  subscribe(): AsyncIterable<NormalizedItem | AdapterEvent>;

  send(thread: ThreadRef, draft: Outbound): Promise<SendResult>;  // called only after approval (A2/L3 convention)
  markRead?(thread: ThreadRef): Promise<void>;
  archive?(thread: ThreadRef): Promise<void>;

  health(): Promise<Health>;
}
```

`send()` is called only by the approval handler, after `pending_approvals` flips to `approved` (master D10, §11 principle) — the adapter itself does not know about this gate; it just receives the command "send this draft now". Approval logic must never be mixed into adapter code.

### 1.7 Contract Tests — fixture replay format

The adapter's `raw → NormalizedItem[]` transform is separated into a pure function (`normalize(raw: unknown): NormalizedItem[]`) and verified with fixtures, without a live connection.

```
packages/adapters/<channel>/fixtures/<scenario>.json
```

```json
{
  "scenario": "text_message_with_reply_thread",
  "raw": { "...channel raw payload...": true },
  "expected": {
    "items": [
      { "threadExternalId": "...", "externalId": "...", "kind": "message", "body": "...", "sourceHash": "..." }
    ]
  }
}
```

The test harness does nothing but `expect(adapter.normalize(fixture.raw)).toEqual(fixture.expected.items)` — no network, no auth needed. Minimum scenarios per adapter: `text_message`, `thread_reply` (grouping-rule verification), `attachment`, `rate_limited_response` (verifies mapping to `AdapterError.kind === "retryable_rate_limit"`), `auth_error_response` (verifies mapping to `auth_expired`/`auth_revoked`). Channels supporting edit/delete (Slack, Telegram) also add `edited_message` and `deleted_message`.

---

## 2. Per-Channel Detailed Contracts

### 2.1 Slack

- **Auth/onboarding**: create an app at api.slack.com/apps → enable Socket Mode via App Manifest (`socket_mode_enabled: true`, `connections:write` scope on the App-Level Token) → request bot (`xoxb`: `channels:history`, `im:history`, `chat:write`, `reactions:read`) and user (`xoxp`: `search:read`, `channels:history`, `chat:write`) OAuth scopes together (fork the openclaw manifest as a starting point, `08`) → install into your own workspace (OAuth consent, immediate approval) → store the `xoxb`/`xoxp` tokens as `omnis.slack.xoxb.<team_id>` / `omnis.slack.xoxp.<team_id>` Keychain entries respectively.
- **Realtime/latency target**: issue a WebSocket URL via `apps.connections.open` (a new URL per call — refreshed roughly every 15 minutes), keep the Socket Mode connection alive. Versus G1 (5 seconds), effectively sub-second latency. The 10 concurrent connections per app limit is not a problem (omnis uses only 1).
- **backfill**: last 30 days via `conversations.history`/`conversations.replies`. Non-Marketplace apps are heavily throttled to 1 req/15 items per minute (`08` verified), so the initial backfill can take hours with pagination + exponential backoff — expose progress to the UI via `backfill_progress` events.
- **write-back**: send (`chat.postMessage`, via `xoxp` so it looks like a real person typed it), markRead (`conversations.mark`). archive unsupported (Slack has no concept of per-user channel archiving at all, `capabilities().archive = false`).
- **thread/ID mapping**: thread `externalId` = channel ID (`D...` for DMs, `C.../G...` for groups). item `externalId` = Slack `ts` (`thread_ts` for thread replies), `sourceHash` = the `ts` verbatim (Slack's are already unique).
- **Media**: file URLs (`url_private`) require a Bearer token header — download then cache locally, never store the URL itself (it breaks when the token expires).
- **Rate limits/frequency**: Socket Mode is push, so there is no polling at all. Only backfill needs pacing.
- **Failure modes**: WS disconnect → auto-reconnect (`retryable_network`), URL expiry → re-call `apps.connections.open`, token revoke → `auth_required`.
- **Account-suspension risk checklist**: low. A company workspace admin can block custom app installation (an accessibility issue rather than a risk, needs per-workspace verification).
- **Process/Phase**: LaunchDaemon (embedded in omnis-hub), Mac mini, Phase A. Fully hub-less in Standalone (Phase D).

### 2.2 Gmail

- **Auth/onboarding**: create a project in Google Cloud Console → enable the Gmail API → create the OAuth consent screen as "External" and **publish it to Production without fail** (in Testing state the refresh token expires after exactly 7 days, `08` verified) → for the `gmail.modify` scope, with fewer than 100 users, registering test users alone is likely sufficient without verification (**UNVERIFIED — spike**: `research/08` adversarial re-verification could not pin the exact number "100" nor its applicability to `gmail.modify` to a primary source, leaving it UNVERIFIABLE — needs direct measurement in Cloud Console) → issue OAuth Desktop client credentials → one-time browser consent → store the refresh token as the `omnis.gmail.<email>` Keychain entry.
- **Realtime/latency target**: `users.watch()` → create a Cloud Pub/Sub topic → **pull subscription** (no public endpoint required, the Mac mini polls outbound only) → on a new message receive `{emailAddress, historyId}` → diff via `history.list`. The channel **expires in 7 days**, re-`watch` via a daily midnight cron (registered in the master §7 `jobs` table). Latency is seconds to tens of seconds.
- **backfill**: on first linking, last 30 days via `messages.list`, labels included.
- **write-back**: send (`messages.send`, building RFC822 MIME directly), markRead (remove the `UNREAD` label via `messages.modify`), archive (remove the `INBOX` label via `messages.modify`) — all 3 supported.
- **thread/ID mapping**: thread `externalId` = Gmail `threadId`. item `externalId` = `messages.id`, `sourceHash` = the `Message-Id` header (RFC822, stable across resends/forwards).
- **Media**: `attachments.get` (base64) downloads individually; inline images are mapped to the body via the `Content-ID` header.
- **Rate limits**: project 1.2M units/minute, 6,000 units/minute/user, 100 units for `watch`, 100 units for `send` (max 60 messages per minute — comfortable headroom versus human usage).
- **Failure modes**: if the 7-day watch expiry is missed, `history.list` returns 404 (`historyId` too old) — fall back to a full `messages.list` resync in that case.
- **Account-suspension risk**: low (official API, normal use).
- **Process/Phase**: LaunchDaemon, Mac mini, Phase A. Fully hub-less in Standalone.

### 2.3 Google Calendar

- **Auth/onboarding**: enable the Calendar API in the same Cloud project as Gmail, add the `calendar` scope to the OAuth consent (the refresh token can be reused if it is the same client).
- **Realtime/latency target**: by default `events.list` + `syncToken` incremental polling (1–5 minute interval). If Phase 0 spike (A1-①, §4) passes, switch to `events.watch` push — the endpoint is a Tailscale Funnel HTTPS URL, with a `validationToken` echo handshake. **Correction (`21` adversarial verification)**: Google's support documentation states that "Search Console domain ownership verification is no longer required", and the current requirement is only a valid (non-self-signed, unexpired) HTTPS certificate — Funnel issues Let's Encrypt certificates automatically, so the domain-verification blocker the master worried about most likely does not exist. Channel expiry is still 7 days and there is no auto-renewal mechanism, so cron re-registration is mandatory.
- **backfill**: `events.list` (`timeMin` = start of the current quarter, `timeMax` = +90 days).
- **write-back**: "R/W (hold)" from the master §8 table — the insert/update API (`events.insert`/`update`) is supported, but in v1 every change always goes through `pending_approvals` and is applied only after approval (no autonomous creation).
- **thread/ID mapping**: thread `kind = "calendar"`, `externalId` = event `id`. item = one per attendee response / change-history entry.
- **Media**: attachments (Drive links) are preserved as URLs, not downloaded separately.
- **Rate limits**: read quota is cheap, so 1–5 minute polling is fine.
- **Failure modes**: `syncToken` expiry (410 Gone) → full resync.
- **Account-suspension risk**: low.
- **Process/Phase**: LaunchDaemon, Mac mini, Phase A. Fully hub-less in Standalone.

### 2.4 Outlook / Microsoft 365

- **Auth/onboarding**: register an app in the Entra ID (Azure AD) portal → set "Supported account types" to **"Accounts in any organizational directory and personal Microsoft accounts"** (the `/common` authority) so a single registration covers both personal Outlook.com and corporate M365 → delegated scopes `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite` → one-time consent via the OAuth authorization code flow → store the refresh token in the `omnis.outlook.<upn>` Keychain entry. Publisher verification applies only to multi-tenant distribution apps, so it is unnecessary for a personal single-user app (`08` verified).
- **Realtime/latency target**: start with delta query polling at Phase B entry (`/me/mailFolders/inbox/messages/delta`) → after stabilization, Graph webhook (requires public HTTPS, Funnel + `validationToken` handshake). Maximum mail resource subscription lifetime is **10,080 minutes (≈7 days)** (`08` adversarial verification corrects the earlier "4,230 minutes" — that number applies only to Teams `callRecord` and the like). A weekly cron refresh is sufficient.
- **backfill**: last 30 days via the `messages` list.
- **write-back**: send (`sendMail`), markRead (`isRead` PATCH), archive (move to the Archive folder via the `move` API).
- **thread/ID mapping**: thread `externalId` = Graph `conversationId`. item `externalId` = message `id`, `sourceHash` = `internetMessageId`.
- **Media**: individual downloads via the `/attachments` sub-endpoint.
- **Rate limits**: standard Graph throttling, honor the `429` + `Retry-After` header.
- **Failure modes**: webhook renewal failure → delta polling fallback, delta token expiry (410) → full resync.
- **Account-suspension risk**: low.
- **Process/Phase**: LaunchDaemon, Mac mini, Phase B. Fully hub-less in Standalone.

### 2.5 Telegram (mtcute)

- **Auth/onboarding**: log in at my.telegram.org → create an app under "API development tools" to obtain `api_id`/`api_hash` (never distribute publicly, `07` verified) → initialize the mtcute client → initial pairing is **QR login** (render the QR on the omnis screen → scan with the iPhone camera) or phone+code (plus an extra entry if a 2FA cloud password is set) → store the mtcute built-in SQLite session file locally, keeping only the encryption key that wraps the file itself in the Keychain (`omnis.telegram.session_key`).
- **Realtime/latency target**: the native update stream of the MTProto persistent connection — effectively realtime (within seconds).
- **backfill**: last 30 days or the most recent 500 via mtcute `getHistory`.
- **write-back**: send, markRead (`markAsRead`) both supported. archive is possible via Telegram's own folder API, but v1 uses kernel-internal labels only (`capabilities().archive = false`).
- **thread/ID mapping**: thread `externalId` = chat/peer id. item `externalId` = message id, `sourceHash` = `(chatId, messageId)`.
- **Media**: the mtcute file download API (the 2GB limit for large files is outside omnis's scope — cache ordinary images/documents only).
- **Rate limits/frequency**: server-side flood-wait governs dynamically (wait out the returned duration, then retry), keep `api_id` private. "Do not repeatedly log in/out in a short period" is treated as **UNVERIFIED — spike** (`research/07` adversarial re-verification could not confirm a primary source for this rule in core.telegram.org/api/terms or obtaining_api_id, downgrading it from VERIFIED — the wording about observation/permanent bans/appeals itself is confirmed, only the "frequent login/logout" detail is unconfirmed). The session is designed to persist after pairing without re-login, sidestepping this risk.
- **Failure modes**: flood-wait response → wait the specified time and retry (`retryable_rate_limit`), session invalidation → `auth_required`.
- **Account-suspension risk**: low (official `api_id` track, `07` verified).
- **Process/Phase**: LaunchDaemon (runs mtcute as a Node sidecar process, local IPC with omnis-hub), Mac mini, Phase B. Hub-less in Standalone by migrating only the session file.

### 2.6 WhatsApp — primary: Beeper Desktop API

- **Auth/onboarding**: install the Beeper Desktop app on the Mac mini (free, Public beta) → pair the WhatsApp account inside Beeper via QR → issue a Bearer token for the Desktop API in Settings → Integrations → enable **Remote Access** in Settings → Integrations → Advanced (bind `0.0.0.0`, derive the base URL from `X-Forwarded-*`) → **tunnel through Tailscale only** (Beeper has no tunnel of its own; do not use Funnel/Cloudflare — reuse the existing Tailscale ACL) → store the token in the `omnis.beeper.token` Keychain entry.
- **Realtime/latency target**: REST + experimental WebSocket (`ws://localhost:23373/v1/ws`, Bearer auth, 4 event kinds `chat.upserted/deleted`, `message.upserted/deleted`; subscriptions can only be replaced wholesale via `subscriptions.set` — no incremental subscribe/unsubscribe). Since it carries an "experimental" label, initially run WS + REST polling (1 minute) in parallel.
- **backfill**: Beeper REST `GET /v0/chats`, `GET /v0/messages` — Beeper already holds history locally, so the shape is simple.
- **write-back**: send (`POST /v1/chats/{chatID}/messages`), markRead/markUnread (`POST /v1/chats/{chatID}/read|unread`). The docs list no per-network exceptions, so it appears common to all channels, but **actual WhatsApp send success is not confirmed by the docs — UNVERIFIED, closed by Phase 0 spike A1-② (§4).**
- **thread/ID mapping**: thread `externalId` = Beeper `chatID`. item `externalId` = Beeper message id, `sourceHash` = the same.
- **Media**: images/files proxied through the Beeper Assets API.
- **Rate limits/human-level frequency**: Beeper's official docs state "personal use only, excessive sending may get the account banned" (`04` verified) — never send in bulk automatically, keep draft-then-approve, keep reply timing natural (no auto-instant replies).
- **Failure modes**: WS disconnect → fall back to REST polling (1 minute), token invalidation → `auth_required`, if Beeper.app itself dies (restart, etc.) → `health() = down`.
- **Account-suspension risk mitigation checklist**: (1) recognize that Beeper internally uses a whatsmeow-family protocol, so the root of the risk is identical to the whatsmeow fallback (§2.7), (2) read-mostly + no bulk sending, (3) keep a residential connection (Mac mini), (4) **pilot on a secondary number first** (master Q2 default), (5) exclude extras like status uploads from v1 scope entirely.
- **Process/Phase**: LaunchAgent (Beeper.app is a GUI app); omnis-hub (LaunchDaemon) connects as an HTTP client only. Mac mini, Phase C (spike passing + secondary-number pilot conditions).
- **standalone (Phase D)**: Beeper.app only needs to run on the **same Mac** as the omnis app (unlike KakaoTalk/LinkedIn, which need a separate always-on device), consistent with master D12 including WhatsApp among the hub-less 5 channels — when switching to a laptop alone, just move Beeper.app to the laptop and re-pair the account (QR).

### 2.7 WhatsApp — fallback: whatsmeow sidecar

- **Switch condition (A1-D3)**: switch to this path if send via Beeper fails in §4 spike A1-②, or if the WS reconnects 3 or more times during a 30-minute observation.
- **Auth/onboarding**: build/deploy the whatsmeow (Go, MPL-2.0) based sidecar binary on the Mac mini → QR pairing via `GetQRChannel()` (roughly 160 seconds for the full session; render the QR on the omnis app screen → scan with the iPhone camera, auto-reissued on expiry) → persist the device store to a local SQLite (`store/sqlstore`) → store only the SQLite file encryption key in the `omnis.whatsmeow.session_key` Keychain entry.
- **Realtime/latency target**: a pure realtime event stream based on `AddEventHandler` (persistent WebSocket).
- **backfill**: `events.HistorySync` (depends on server-side retention — the exact duration is **UNVERIFIED**, needs direct measurement in the prototype. No impact on the v1 design; if short, only the backfill range shrinks).
- **write-back**: send/markRead fully supported (library-native), archive absent.
- **thread/ID mapping**: thread `externalId` = JID (individual/group). item `externalId` = whatsmeow message ID.
- **Media**: whatsmeow native download/upload.
- **Rate limits/human-level frequency**: same principles as §2.6 (no auto-instant replies, no unsolicited messages, keep a residential IP).
- **Failure modes**: built-in reconnect logic, `auth_required` on logout detection (QR re-scan required).
- **Account-suspension risk mitigation checklist**: same as §2.6 + secondary number first.
- **Process/Phase**: LaunchDaemon (Go binary, local HTTP/Unix socket communication with omnis-hub), Mac mini, Phase C (only when the fallback triggers). Hub-less in Standalone (just port the binary, consistent with master §4.2).

### 2.8 KakaoTalk (kmsg)

- **Auth/onboarding**: keep KakaoTalk.app on the Mac mini normally logged in (auto-login on; 2FA is one-time when registering a new device, entering the 4-digit security code shown on the phone for each sub-device connection — this is Kakao's official policy, `25` verified) → `brew install channprj/tap/kmsg` → run both `kmsg mcp-server` (stdio, **3 tools only**: `kmsg_read`/`kmsg_send`/`kmsg_send_image` — `watch` is not an MCP tool, corrected by `05` adversarial verification) and `kmsg watch "<chat>" --json` (**separate process**) → do **not** use `kmsg auth login` (which stores the password in kmsg's own store) — keeping KakaoTalk.app's own login alive is sufficient (consistent with master D10 "minimize secrets").
- **Realtime/latency target**: `kmsg watch --json` polling, relaxing the default 0.2–10s interval to **5–15 seconds** (human-level frequency, per the talksafety.kakao.com anomaly-detection list in §4 A1-③). Use `read --background-safe` so KakaoTalk.app never loses focus.
- **backfill**: kmsg `chats`/`read` cover **only the currently open conversation history** (KakaoTalk has no full-history API). Long-term backfill is a separate track via indexing KakaoTalk "export conversation" text files (the katok-style pattern, `25` recommendation) — outside v1 realtime capture scope, handled in A3/A4 (memory).
- **write-back**: send (text + image, **dry-run by default → executed once after explicit confirmation**, kmsg's default UX). There is no dedicated markRead API — opening the conversation window makes KakaoTalk itself mark it read, so the polling design accounts for "reading = generating a read receipt" and defaults to `--background-safe`. No archive.
- **thread/ID mapping**: thread `externalId` = kmsg `chat_id` (the local registry `~/.kmsg/chat-registry.json`; a new ID is issued when the room name changes). item `sourceHash` = hash of `(chat_id, timestamp, sender, first 64 chars of body)` (a surrogate key since Kakao does not expose a global message id).
- **Media**: `--capture-images` option (ScreenCaptureKit, requires screen recording permission), text only by default.
- **Rate limits/human-level frequency**: the official anomaly-detection list at talksafety.kakao.com/measure (`25` verified) — adding many friends in a short period, **using a PC emulator** (explicit prohibition wording confirmed), and so on become the "things you must not do" checklist verbatim. `watch` polling at 5–15 seconds, minimize friend-add/chat-room-creation frequency.
- **Failure modes**: if a KakaoTalk.app update breaks the AX path → try the kmsg self-healing path cache first → on failure, fall back to the Notification Center DB (Full Disk Access required) + Vision OCR (such as `macos-vision-ocr`, free and on-device) to at least keep the "new message arrived" signal.
- **Account-suspension risk mitigation checklist**: (1) proceed only after acknowledging kmsg's author's explicit warning ("many cases of permanent bans exist"), (2) always confirm send via dry-run, (3) enable 2FA on the Kakao account, (4) `watch` no faster than 5–15 seconds, (5) **open send under an approval gate after two weeks of stable reads** (master Q3 default, unchanged), (6) **never** call the LOCO protocol/unofficial API directly or use a PC emulator (confirmed primarily by Kakao's policy wording).
- **Process/Phase**: LaunchAgent (a GUI session is mandatory — KakaoTalk.app and `kmsg watch` work only in a logged-in session), Mac mini only, Phase C.
- **standalone (Phase D)**: exactly as master D12/§4.2 — "one Mac with an always-on GUI session" remains structurally required. What this appendix adds is implementation guidance only: design the KakaoTalk connector as a **capture sidecar** process physically separate from the core (omnis-hub), so that whichever GUI session it is — mini or laptop — it emits events in the same format without affecting the core architecture (unified with the WhatsApp/Telegram sidecar pattern, `25` recommendation).

### 2.9 LinkedIn (Playwright + Gmail notification-email parsing)

- **Auth/onboarding**: create a resident Playwright Chromium profile on the Mac mini (`playwright install chromium`) → log into LinkedIn manually once (including 2FA) → persist the profile directory (cookies/localStorage) as-is to **minimize re-logins** (to avoid the `mautrix/linkedin#55`-like pattern where a replayed session is mistaken for theft, `06` source) → store no credentials themselves, leaving only the session cookies in the profile.
- **Realtime/latency target**: polling at **5–15 minute randomized intervals** (never a fixed second-level cron, imitating a human user) — open only the messaging inbox page to check whether new threads exist, never bulk-view profiles. **Parallel signal**: add a sender-domain `@linkedin.com` filter to the Gmail adapter (§2.2) to get "new message arrived" almost for free (no new account linking, reusing the existing Gmail pipeline). The actual notification email's body structure (sender name/profile URL/preview) has no sample available — **UNVERIFIED, closed by Phase 0 spike A1-⑧ (§4).**
- **backfill**: on first login, scroll the messaging inbox page once and collect recent conversation history via DOM parsing (no bulk scrolling or profile viewing, one-time).
- **write-back**: send (type text into the message input and click the send button, **only after approval**). markRead is handled automatically by LinkedIn when the inbox is opened (no separate API). No archive.
- **thread/ID mapping**: thread `externalId` = the conversation id in the LinkedIn conversation URL (extracted from the DOM). item `sourceHash` = hash of DOM ordinal + timestamp.
- **Media**: for images/documents inside LinkedIn messages, extract the download URL with Playwright then cache.
- **Rate limits/human-level frequency**: use the Unipile provider-limits documentation baselines as reference ceilings (default 100/day across actions, 80–100/day and 200/week for connection invitations — the `06` adversarial corrected figures; "100–150" was a misreading), but omnis handles 1 account and one person's message volume, so it will almost never approach these limits. Never bulk-view profiles or send bulk connection requests.
- **Failure modes**: if a LinkedIn UI update breaks the DOM selectors, report `health()` → `degraded` (no auto-recovery attempt; selector updates ship as manual deploys); on session cookie invalidation, `auth_required` (re-login required).
- **Account-suspension risk mitigation checklist (A1-D4)**: (1) rule out the Beeper/mautrix path because of `mautrix/linkedin#55` (20-second session death, unresolved), (2) randomized 5–15 minute polling, (3) reuse a persistent profile (no re-login every time), (4) fixed Mac mini IP (behind Tailscale), (5) outbound always draft→approval, (6) no bulk connection requests.
- **Process/Phase**: LaunchAgent (browser session required), Mac mini only, Phase C. Gmail notification-email parsing alone runs as a LaunchDaemon (layered onto the Gmail adapter).
- **standalone (Phase D)**: like KakaoTalk, the "always-on GUI session" constraint remains structurally (master D12). Only the Gmail notification-email parsing path works fully hub-less, but it provides only a "new message arrived" signal, not the full body/reply — the Phase D UI does not hide this asymmetry and states explicitly that "LinkedIn summaries arrive even hub-less, but replies require the capture host to be running".

---

## 3. write-back Scope Summary

Arranging the Capabilities declarations along the channel axis gives the following (refining the R/W column of the master §8 table).

| Channel | send | markRead | archive | Notes |
|---|---|---|---|---|
| Slack | Y | Y | N | No concept of archiving at all |
| Gmail | Y | Y | Y | All three are Gmail API standard |
| Google Calendar | Y(hold, after approval) | — | — | write exists but always gated by approval |
| Outlook | Y | Y | Y | All three are Graph API standard |
| Telegram | Y | Y | N(v1) | archive API exists but is unused in v1 |
| WhatsApp(Beeper) | Y(UNVERIFIED until the spike confirms) | Y | N | |
| WhatsApp(whatsmeow) | Y | Y | N | |
| KakaoTalk | Y(dry-run→approval, 2 weeks after Phase C) | automatic(triggered by reading) | N | No API to call markRead explicitly |
| LinkedIn | Y(after approval) | automatic(triggered by opening) | N | |

---

## 4. Phase 0 Spike Procedures (channel-related)

The 14 Phase 0 gates in master §16 are not changed by this appendix (A1-D10). The numbers in this table all use the `A1-` prefix so as not to collide with the circled numbers in master §16 (①~⑭). `A1-①` (Calendar)·`A1-②` (Beeper)·`A1-③` (kmsg)·`A1-④` (Slack)·`A1-⑤` (Gmail) are the same gates as ①·②·④·⑨·⑩ in master §16, and this appendix merely fills those 5 with per-channel commands and pass criteria rather than adding anything new. `A1-⑥` (Outlook)·`A1-⑦` (Telegram)·`A1-⑧` (LinkedIn) are not Phase 0 gates but run at each channel's own phase entry (master §16 Phase B/B/C). Without direct measurement, the §2 design remains assumption for all of them.

| # | Spike | Command/steps | Pass criteria | Decision on fail |
|---|---|---|---|---|
| A1-① | Calendar `events.watch` via Funnel (master §16 ①) | Expose `https://<mini>.<tailnet>.ts.net/hooks/calendar` via Tailscale Funnel → `POST calendar/v3/calendars/primary/events/watch` (with the URL above in `address`) | `validationToken` handshake passes + 1 real calendar-change notification received | Fix syncToken polling (1–5 min) as the default and drop the push-transition paragraph in §2.3 |
| A1-② | Beeper token issuance + WhatsApp secondary-number send (master §16 ②) | Issue a token in Beeper Settings→Integrations → `POST /v1/chats/{chatID}/messages` (to the chatID the secondary number belongs to) | HTTP 200 + receipt confirmed on the peer device | Switch immediately to the whatsmeow sidecar (§2.7) per A1-D3, keeping Beeper only for the other 6 networks (Instagram/Signal/Discord, etc., outside v1 scope) |
| A1-③ | kmsg read on mini (master §16 ④) | `brew install channprj/tap/kmsg && kmsg chats --json && kmsg read <chat_id> --background-safe --json` | Recent messages output correctly as JSON, KakaoTalk.app does not lose focus | Switch to the Notification Center DB + Vision OCR fallback design and report the KakaoTalk read delay to Logan |
| A1-④ | Slack Socket Mode one-turn round trip (master §16 ⑨) | Create an app via Manifest → `apps.connections.open` → WS connect → send a test DM | Event received within 5 seconds (G1) | Consider the Events API alternative (public endpoint, via Funnel) — Phase A may slip |
| A1-⑤ | Gmail watch+Pub/Sub pull round trip (master §16 ⑩) | `gcloud pubsub topics create omnis-gmail` → `users.watch()` → send a test email | `historyId` received on the pull subscription | Fall back to `history.list` polling every 1 minute (already documented as the fallback in §2.2, no functional loss) |
| A1-⑥ | Outlook Graph webhook via Funnel (at Phase B entry) | Create a subscription with the Funnel URL as `notificationUrl` | `validationToken` handshake passes + real notification received | Keep delta query polling (Phase B's default is already polling, so it soft-fails with no schedule impact) |
| A1-⑦ | Telegram mtcute QR login + one-turn send/receive (at Phase B entry) | Issue `api_id` at my.telegram.org → mtcute QR login script → test message round trip | SQLite session persisted confirmed + message round trip | Fall back to the phone+code login path (supported by the library itself, no design change) |
| A1-⑧ | Obtain a LinkedIn notification-email sample (at Phase C entry) | Generate one real DM on LinkedIn → obtain the raw message via Gmail `messages.get?format=raw` | Sender name/profile URL/preview parsing rules finalized | Use the notification-email path only as a "new message arrived" trigger and exclude body parsing from v1, covering with Playwright polling alone |

**Unverified items outside spike scope** (not go/no-go gates, but possibly design-relevant): whether whatsmeow `events.HistorySync` actually backfills several days' worth (§2.7) — affects only the v1 backfill range estimate, measured during the prototype stage.

---

## 5. Relationship to the Master

This appendix does not change any value in the master §8 table (channel × path × fallback × R/W × risk × Phase) — WhatsApp's "Beeper primary/whatsmeow fallback", LinkedIn's "Playwright primary/Gmail notification-email·Unipile fallback", and KakaoTalk's "kmsg, send 2 weeks after read" are all verbatim from the master, and this appendix merely filled them in with executable commands, schemas, and checklists. `21` (Calendar push domain-verification correction) and `08` (Outlook subscription lifetime fixed at 10,080 minutes) either match values the master already adopted (already reflected as 10,080 minutes in the §8 table) or increase the odds of success for spikes the master left open conditionally, so no rework is needed.

---

## Revision History (v0.95, 2026-09-20)

After cross-checking against master v0.95 + `99-review.md` (global review), all 4 items in A1's own "Review Notes (2026-09-20)" were closed in this pass, so that section is deleted.

1. Relabeled the §4 Phase 0 spike table as `A1-①`~`A1-⑧` (eliminating the circled-number collision with ①~⑭ in master §16), and rewrote the A1-D10 wording to match the actual 14 gates in master §16 (①②④⑨⑩ = the 5 channel-related ones, the rest executed at each phase entry).
2. Corrected A1-D1 to "keep the method signatures + EXTEND the method list with `disconnect?()`/`archive?()`", with the archive capability notation in §1.6/§3 confirmed consistent.
3. Expanded `NormalizedItem.author.kind` to `"person" | "agent" | "system"` to align with the A3 `items.author_person_id`/`author_agent_id`/(both NULL = system) three-column model, so that agent-authored Items (A2's domain) are not excluded by the type.
4. Fixed the §2.1 Slack "G5(5 seconds)" misreading to "G1(5 seconds)" (master §2 G1 = channel receipt within 5 seconds, G5 = device-to-device sync within 2 seconds), and reflected the G1 notation in the §4 A1-④ pass criteria as well.
5. Marked §2.5 Telegram "do not repeatedly log in/out in a short period" and §2.2 Gmail "gmail.modify under 100 users needs no verification" as UNVERIFIED — spike (citing the adversarial re-verification results of `research/07` and `research/08` respectively).
6. Hub local port: there is no port literal reference in the A1 body, so there is no 8787 conflict — no change (verification only).
7. Added a one-line summary of the Keychain naming convention (`omnis.<channel>.<kind>.<external_id>`) plus a per-channel current-entry table to §1.3, so A6 can reference it verbatim (reflecting the `99-review.md` §1.2 "Keychain naming" ruling).
