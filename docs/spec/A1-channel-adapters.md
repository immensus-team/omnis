# A1 — 채널 어댑터 상세 계약

버전 1.0 (2026-09-20). 0.9→0.95→1.0: 전역 리뷰 1·2차 반영. 근거: `00-omnis-design.md`(마스터, §4.1 L1 Adapters/§6 데이터 모델/§8 어댑터 계약/§16 Phase 0/D4·D10·D12 결정), `research/04, 05, 06, 07, 08, 21, 25`. 마스터와 이 부록이 충돌하면 마스터가 이긴다 — 이 문서는 마스터 §8의 스케치를 완전한 계약으로 확정하고, §16 Phase 0 스파이크에 채널별 세부 절차를 채운다.

## 이 부록이 확정하는 결정

| # | 결정 |
|---|---|
| A1-D1 | 공통 `Adapter` 인터페이스는 마스터 §8 스케치의 메서드 시그니처는 그대로 유지하고, 메서드 목록은 `disconnect?()`와 `archive?()`로 EXTEND한다(§1.6 — `archive?()`는 §3 write-back 표의 Gmail/Outlook `archive=O`를 실제로 구현하려면 필수). thread 메타데이터는 별도 스트림이 아니라 `NormalizedItem.threadMeta`에 실어 보낸다(라운드트립 절감). TS는 camelCase, Postgres 영속화는 snake_case — 매핑은 커널 write path 책임. |
| A1-D2 | 채널별 실시간 전략은 하이브리드로 고정: push 가능한 채널(Slack Socket Mode, Gmail Pub/Sub pull, Telegram MTProto, Beeper WS)은 push 우선, 나머지(Calendar, Outlook 초기, KakaoTalk, LinkedIn)는 폴링을 기본값으로 하고 조건부로 push/webhook을 얹는다. |
| A1-D3 | WhatsApp은 Beeper Desktop API를 1차로, whatsmeow Go 사이드카를 폴백으로 이중 경로 유지. 전환 조건은 Phase 0 스파이크 A1-②(§4 표)의 실제 send 성공 여부. |
| A1-D4 | LinkedIn은 `mautrix/linkedin`의 20초 세션사망 버그(issue #55, 2026-05 오픈, 미해결)로 인해 Beeper/mautrix 경로를 배제하고 Playwright 상주 프로필을 1차로 쓴다. Gmail 알림메일 파싱은 "신규 메시지 도착" 저비용 신호로 병행한다. |
| A1-D5 | KakaoTalk은 kmsg를 1차로 쓰되, `kmsg mcp-server`(3-tool: `kmsg_read`/`kmsg_send`/`kmsg_send_image`)와 `kmsg watch --json`(별도 프로세스)을 분리 구동한다. send는 마스터 Q3 기본값대로 read 2주 안정 후 승인제로 연다. |
| A1-D6 | write-back 범위는 채널마다 다르며 `Capabilities`로 선언하고 UI는 선언된 능력만 노출한다(마스터 §4.1 원칙 그대로). §3에 채널별 표로 확정. |
| A1-D7 | 에러는 6종으로 분류하고 재시도 정책은 종류별로 고정한다(§2.4). auth 계열은 즉시 `pending`형 system Item + `auth_required` 이벤트로 인간에게 넘기고 자동 재시도하지 않는다. |
| A1-D8 | 계약 테스트는 fixture replay 방식: 어댑터의 raw→Normalized 변환 순수 함수를 라이브 연결 없이 검증한다. 어댑터당 최소 시나리오 세트를 §2.5에 고정한다. |
| A1-D9 | 프로세스 배치는 채널 성격으로 갈린다: API 기반 5채널(Slack/Gmail/Calendar/Outlook/Telegram)은 LaunchDaemon(omnis-hub 내장), GUI 세션이 필요한 3채널(WhatsApp-Beeper, KakaoTalk, LinkedIn)은 LaunchAgent. 전부 Mac mini, Phase C까지는 이동 없음. |
| A1-D10 | 마스터 §16의 Phase 0 게이트 14개는 이 부록으로 바뀌지 않는다. 그중 채널 관련 5개(①Calendar·②Beeper·④kmsg·⑨Slack·⑩Gmail)를 이 부록 §4에서 `A1-①`~`A1-⑤`로 채널 단위 절차까지 채우고, 나머지 3채널(Outlook/Telegram/LinkedIn)은 Phase 0 게이트가 아니라 각자의 Phase 진입 시(§16 Phase B/B/C) 실행하는 `A1-⑥`~`A1-⑧`로 §4에 확정한다. 마스터 §16의 원문자 번호(①~⑭)와 겹치지 않도록 이 부록의 채널 스파이크 8개는 전부 `A1-` 접두를 쓴다. |

---

## 1. 공통 어댑터 인터페이스

### 1.1 Capabilities와 Channel

```ts
type Channel =
  | "slack" | "gmail" | "google_calendar" | "outlook"
  | "telegram" | "whatsapp" | "kakaotalk" | "linkedin";

interface Capabilities {
  read: boolean;
  write: boolean;      // send() 실제 호출 가능 여부
  realtime: boolean;   // subscribe()가 push/socket 기반인지(false면 내부적으로 폴링)
  history: boolean;    // backfill() 지원 여부
  media: boolean;      // 첨부 정규화 지원
  markRead: boolean;
  typing: boolean;     // typing indicator 송수신
  archive: boolean;    // 원 채널에 아카이브/라벨이 실제 반영되는지
  delete: boolean;     // v1 전 채널 false(비목표, §3 마스터 확인)
}
```

`accounts.capabilities`(jsonb)는 이 타입을 그대로 직렬화한다. UI는 `capabilities()`가 선언하지 않은 버튼(예: archive 미지원 채널의 "아카이브" 액션)을 아예 렌더링하지 않는다.

### 1.2 정규화 스키마 — NormalizedThread / NormalizedItem

필드명은 마스터 §6 `threads`/`items` 테이블과 같은 의미 축을 쓴다(TS는 camelCase, Postgres는 snake_case — 매핑은 커널 write path에서 처리, A1-D1).

```ts
type ThreadKind = "dm" | "group" | "email" | "calendar";
// "agent_session"은 A2(에이전트 브리지) 소관, L1 채널 어댑터 범위 밖.

interface ParticipantRef {
  externalId: string;    // 채널 고유 ID (Slack user id, email address, JID, ...)
  displayName: string;
  personId?: string;     // persons 테이블과 매칭되면 커널이 채움. 어댑터는 항상 비워 보낸다.
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
// "agent_turn" / "tool_call" / "system"은 A2 및 커널 내부 생성 Item — 채널 어댑터는 만들지 않는다.

interface Attachment {
  kind: "image" | "file" | "audio" | "video" | "link";
  url?: string;         // 원 채널 URL 또는 로컬 캐시 경로(다운로드 후)
  mimeType?: string;
  sizeBytes?: number;
  caption?: string;
}

interface NormalizedItem {
  threadExternalId: string;
  externalId: string;
  kind: ItemKind;
  author: { kind: "person" | "agent" | "system"; id: string }; // A3 items.author_person_id / author_agent_id / (둘 다 NULL=system) 3열 모델과 정렬 — 채널 어댑터는 person만 채운다, agent는 A2가 만드는 agent_turn/tool_call Item 전용
  body: string;
  bodyHtml?: string;
  attachments: Attachment[];
  sentAt: string;                 // ISO8601, items.sent_at
  status: "received";             // 채널 어댑터가 만드는 Item은 항상 received로 시작
  sourceHash: string;             // idempotency key, 채널마다 §3에서 정의
  threadMeta?: NormalizedThread;  // 신규 thread거나 메타데이터 변경 시에만 채움(A1-D1)
}
```

`status`는 마스터 §6대로 `received → read → draft → approved → sent → failed → archived`를 오가지만, 채널 어댑터가 만드는 것은 항상 `received`다. 이후 상태 전이는 커널과 L3 에이전트 층의 책임이며 어댑터는 관여하지 않는다.

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
  keychainService: string;   // 예: "omnis.slack.xoxp"
  keychainAccount: string;   // 예: account external id(팀 ID, 이메일 등)
  // 실제 토큰 값은 절대 이 객체에 담기지 않는다. connect() 내부에서 Keychain을 직접 읽는다.
}
```

**Keychain 명명 규칙**(A1이 정의, A6·모든 부록이 그대로 따른다 — `99-review.md` §1.2 "Keychain 명명" 판정): `omnis.<channel>.<kind>.<external_id>` — `channel`은 `Channel` 열거형 값, `kind`는 시크릿 종류(`xoxb`/`xoxp`/`token`/`session_key`), `external_id`는 계정 식별자(team_id/email/upn 등)이며 채널에 시크릿이 1종류뿐이고 다계정을 지원하지 않으면 생략한다.

| 채널 | Keychain 항목 |
|---|---|
| Slack | `omnis.slack.xoxb.<team_id>`, `omnis.slack.xoxp.<team_id>` |
| Gmail | `omnis.gmail.<email>` |
| Outlook | `omnis.outlook.<upn>` |
| Telegram | `omnis.telegram.session_key` |
| WhatsApp(Beeper) | `omnis.beeper.token` |
| WhatsApp(whatsmeow) | `omnis.whatsmeow.session_key` |
| KakaoTalk | 없음 — KakaoTalk.app 자체 로그인만 사용(§2.8) |
| LinkedIn | 없음 — 세션 쿠키는 Playwright 프로필 디렉토리에 보존, Keychain 미사용(§2.9) |

### 1.4 에러 분류와 재시도 정책

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

| Error kind | 자동 재시도 | Backoff | 상한 | 이후 동작 |
|---|---|---|---|---|
| `retryable_network` | O | 1s → ×2, ±20% jitter, cap 5분 | 무제한(연결성 문제로 간주) | `health()` → `degraded`. 5분 초과 지속 시 인박스에 system Item 1건 생성 |
| `retryable_rate_limit` | O | 서버가 준 `retryAfterMs` 그대로 존중(없으면 60s 고정) | 무제한 | `health()` → `degraded` |
| `auth_expired` | X | — | — | `auth_required` 이벤트 즉시 발행 + system Item, 사용자 재인증 대기(자동 재시도 금지 — D10 "구조로 보안"과 일치) |
| `auth_revoked` | X | — | — | 동일. kill switch 전역 대상 아님, 해당 채널만 정지 |
| `fatal_protocol` | X | — | — | `health()` → `down`, audit_log 기록, ntfy 알림 |
| `fatal_unsupported` | X | — | — | `capabilities()`가 애초에 노출하지 말았어야 할 액션 — 버그로 취급, 알림만 |

### 1.5 health() 규약

```ts
interface Health {
  channel: Channel;
  accountExternalId: string;
  status: "healthy" | "degraded" | "down";
  lastEventAt: string | null;
  lastError?: { kind: AdapterErrorKind; message: string; at: string };
  latencyMsP50?: number;   // 최근 100개 이벤트 기준, realtime 채널만
}
```

healthchecks.io dead-man's-switch(마스터 §15)가 30초마다 이 값을 poll한다. `down`이 5분 지속되면 ntfy 푸시 + 인박스 system Item.

### 1.6 Adapter 인터페이스 (확정)

```ts
interface ThreadRef {
  accountId: string;      // accounts.id (UUID, 커널 발급)
  externalId: string;     // NormalizedThread.externalId
}

interface OutboundAttachment {
  kind: "image" | "file";
  localPath: string;      // 로컬 캐시 파일 경로
  mimeType: string;
  caption?: string;
}

interface Outbound {
  text: string;
  bodyHtml?: string;
  attachments?: OutboundAttachment[];
  replyToExternalId?: string;  // 스레드 내 특정 아이템에 답장(지원 채널만)
}

interface SendResult {
  externalId: string;     // 원 채널이 부여한 메시지 ID
  sentAt: string;
}

interface Adapter {
  id: string;
  channel: Channel;

  capabilities(): Capabilities;
  connect(auth: AuthRef): Promise<void>;
  disconnect?(): Promise<void>;              // graceful restart용, optional

  backfill(since?: Date): AsyncIterable<NormalizedItem>;
  subscribe(): AsyncIterable<NormalizedItem | AdapterEvent>;

  send(thread: ThreadRef, draft: Outbound): Promise<SendResult>;  // 승인 후에만 호출됨(A2/L3 규약)
  markRead?(thread: ThreadRef): Promise<void>;
  archive?(thread: ThreadRef): Promise<void>;

  health(): Promise<Health>;
}
```

`send()`는 `pending_approvals`가 `approved`로 바뀐 뒤 승인 핸들러만 호출한다(마스터 D10, §11 원칙) — 어댑터 자체는 이 게이트를 모르며, 그냥 "지금 이 draft를 지금 보내라"는 명령만 받는다. 어댑터 코드에 승인 로직이 섞이면 안 된다.

### 1.7 계약 테스트 — fixture replay 형식

어댑터의 `raw → NormalizedItem[]` 변환은 라이브 연결 없이 순수 함수로 분리하고(`normalize(raw: unknown): NormalizedItem[]`), fixture로 검증한다.

```
packages/adapters/<channel>/fixtures/<scenario>.json
```

```json
{
  "scenario": "text_message_with_reply_thread",
  "raw": { "...채널 원본 payload...": true },
  "expected": {
    "items": [
      { "threadExternalId": "...", "externalId": "...", "kind": "message", "body": "...", "sourceHash": "..." }
    ]
  }
}
```

테스트 하네스는 `expect(adapter.normalize(fixture.raw)).toEqual(fixture.expected.items)`만 수행 — 네트워크도, 인증도 필요 없다. 어댑터당 최소 시나리오: `text_message`, `thread_reply`(그룹핑 규칙 검증), `attachment`, `rate_limited_response`(→ `AdapterError.kind === "retryable_rate_limit"` 매핑 검증), `auth_error_response`(→ `auth_expired`/`auth_revoked` 매핑). 편집/삭제를 지원하는 채널(Slack, Telegram)은 `edited_message`, `deleted_message`도 추가.

---

## 2. 채널별 상세 계약

### 2.1 Slack

- **인증/온보딩**: api.slack.com/apps에서 앱 생성 → App Manifest로 Socket Mode 활성화(`socket_mode_enabled: true`, App-Level Token에 `connections:write` 스코프) → OAuth 스코프에 bot(`xoxb`: `channels:history`, `im:history`, `chat:write`, `reactions:read`)과 user(`xoxp`: `search:read`, `channels:history`, `chat:write`)를 함께 요청(openclaw manifest를 시작점으로 fork, `08`) → 본인 워크스페이스에 설치(OAuth consent, 즉시 승인) → `xoxb`/`xoxp` 토큰을 각각 `omnis.slack.xoxb.<team_id>` / `omnis.slack.xoxp.<team_id>` Keychain 항목으로 저장.
- **실시간/지연 목표**: `apps.connections.open`으로 WebSocket URL 발급(호출마다 새 URL — 15분 내외로 갱신), Socket Mode 연결 유지. G1(5초) 대비 사실상 서브초 지연. 앱당 동시 연결 10개 한도는 문제 없음(omnis는 1개만 사용).
- **backfill**: `conversations.history`/`conversations.replies`로 최근 30일. Non-Marketplace 앱은 분당 1req/15 items로 강하게 제한되므로(`08` verified) 최초 backfill은 페이지네이션 + 지수 백오프로 수 시간 걸릴 수 있음 — 진행률은 `backfill_progress` 이벤트로 UI에 노출.
- **write-back**: send(`chat.postMessage`, `xoxp`로 실제 사람이 친 것처럼), markRead(`conversations.mark`). archive는 미지원(Slack에 사용자별 채널 아카이브 개념 자체가 없음, `capabilities().archive = false`).
- **thread/ID 매핑**: thread `externalId` = 채널 ID(`D...` DM, `C.../G...` 그룹). item `externalId` = Slack `ts`(스레드 답글은 `thread_ts`), `sourceHash` = `ts` 그대로(Slack은 이미 유니크).
- **미디어**: 파일 URL(`url_private`)은 Bearer 토큰 헤더 필요 — 다운로드 후 로컬 캐시, URL 자체는 저장하지 않음(토큰 만료 시 깨짐).
- **레이트리밋/빈도**: Socket Mode는 push라 폴링 자체가 없음. backfill만 페이싱 필요.
- **실패모드**: WS 끊김 → 자동 재연결(`retryable_network`), URL 만료 → `apps.connections.open` 재호출, 토큰 revoke → `auth_required`.
- **계정정지 리스크 체크리스트**: 낮음. 회사 워크스페이스 관리자가 커스텀 앱 설치를 막을 수 있음(리스크가 아니라 접근성 이슈, 워크스페이스별 확인 필요).
- **프로세스/Phase**: LaunchDaemon(omnis-hub 내장), Mac mini, Phase A. Standalone(Phase D)에서 완전 hub-less.

### 2.2 Gmail

- **인증/온보딩**: Google Cloud Console에서 프로젝트 생성 → Gmail API 활성화 → OAuth consent screen을 "External"로 만들고 **반드시 Production으로 게시**(Testing 상태면 refresh token이 정확히 7일 후 만료, `08` verified) → `gmail.modify` 스코프는 100 user 미만이면 검증 없이 test user 등록만으로 충분할 가능성이 높음(**UNVERIFIED — spike**: `research/08` adversarial 재검증이 "100"이라는 정확한 인원수와 `gmail.modify`에의 적용을 1차 소스로 못 박지 못해 UNVERIFIABLE로 남김, Cloud Console에서 실측 필요) → OAuth Desktop client 자격증명 발급 → 최초 1회 브라우저 동의 → refresh token을 `omnis.gmail.<email>` Keychain 항목에 저장.
- **실시간/지연 목표**: `users.watch()` → Cloud Pub/Sub 토픽 생성 → **pull subscription**(공인 엔드포인트 불요, 맥미니가 아웃바운드로만 폴링) → 새 메시지 시 `{emailAddress, historyId}` 수신 → `history.list`로 diff. 채널은 **7일 만료**, 매일 자정 cron으로 재-`watch`(마스터 §7 `jobs` 테이블에 등록). 지연은 수초~수십초.
- **backfill**: 최초 연동 시 `messages.list`로 최근 30일, 라벨 포함.
- **write-back**: send(`messages.send`, RFC822 MIME 직접 빌드), markRead(`messages.modify`로 `UNREAD` 라벨 제거), archive(`messages.modify`로 `INBOX` 라벨 제거) — 3개 전부 지원.
- **thread/ID 매핑**: thread `externalId` = Gmail `threadId`. item `externalId` = `messages.id`, `sourceHash` = `Message-Id` 헤더(RFC822, 재전송/포워딩에도 안정).
- **미디어**: `attachments.get`(base64) 개별 다운로드, 인라인 이미지는 `Content-ID` 헤더로 본문과 매핑.
- **레이트리밋**: 프로젝트 분당 120만 유닛/유저 분당 6,000유닛, `watch` 100유닛, `send` 100유닛(분당 최대 60통 — 사람 사용량 대비 여유 큼).
- **실패모드**: watch 7일 만료를 놓치면 `history.list`가 404(`historyId` too old) — 이 경우 `messages.list` 풀 재동기화로 폴백.
- **계정정지 리스크**: 낮음(공식 API, 정상 사용).
- **프로세스/Phase**: LaunchDaemon, Mac mini, Phase A. Standalone에서 완전 hub-less.

### 2.3 Google Calendar

- **인증/온보딩**: Gmail과 같은 Cloud 프로젝트에 Calendar API 활성화, OAuth consent에 `calendar` 스코프 추가(같은 client이면 refresh token 재사용 가능).
- **실시간/지연 목표**: 기본은 `events.list` + `syncToken` 증분 폴링(1~5분 간격). Phase 0 스파이크(A1-①, §4)가 통과하면 `events.watch` push로 전환 — 엔드포인트는 Tailscale Funnel HTTPS, `validationToken` echo 핸드셰이크. **정정 사항(`21` adversarial verification)**: Google 지원 문서는 "Search Console 도메인 소유 검증이 더 이상 필요 없다"고 명시하며, 현재 요구사항은 유효한(자체서명 아닌, 만료 안 된) HTTPS 인증서뿐 — Funnel이 Let's Encrypt 인증서를 자동 발급하므로 마스터가 우려한 도메인 검증 블로커는 없을 가능성이 높다. 채널 만료는 여전히 7일이며 자동 갱신 메커니즘이 없어 cron 재등록 필수.
- **backfill**: `events.list`(`timeMin` = 이번 분기 시작, `timeMax` = +90일).
- **write-back**: 마스터 §8 표의 "R/W(hold)" — 일정 삽입/수정(`events.insert`/`update`) API 자체는 지원하지만, v1에서는 항상 `pending_approvals`를 거쳐 승인 후에만 반영한다(자율 생성 금지).
- **thread/ID 매핑**: thread `kind = "calendar"`, `externalId` = event `id`. item = 참석자 응답/변경 이력 각각.
- **미디어**: 첨부(Drive 링크)는 URL 그대로 보존, 별도 다운로드 안 함.
- **레이트리밋**: read 쿼터가 저렴해 1~5분 폴링은 문제 없음.
- **실패모드**: `syncToken` 만료(410 Gone) → 풀 재동기화.
- **계정정지 리스크**: 낮음.
- **프로세스/Phase**: LaunchDaemon, Mac mini, Phase A. Standalone에서 완전 hub-less.

### 2.4 Outlook / Microsoft 365

- **인증/온보딩**: Entra ID(Azure AD) 포털에서 앱 등록 → "계정 유형"을 **"Accounts in any organizational directory and personal Microsoft accounts"**(`/common` authority)로 선택해 개인 Outlook.com과 회사 M365를 단일 등록으로 커버 → `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite` 위임 스코프 → OAuth authorization code flow로 1회 동의 → refresh token을 `omnis.outlook.<upn>` Keychain에 저장. Publisher verification은 멀티테넌트 배포 앱 전용이라 개인 단일 사용자 앱은 불요(`08` verified).
- **실시간/지연 목표**: Phase B 진입 시 delta query 폴링(`/me/mailFolders/inbox/messages/delta`)으로 시작 → 안정화 후 Graph webhook(공인 HTTPS 필요, Funnel + `validationToken` handshake). 메일 리소스 구독 최대 수명은 **10,080분(≈7일)**(`08` adversarial verification이 이전 기록의 "4,230분"을 정정 — 그 수치는 Teams `callRecord`류에만 적용). 갱신은 주 단위 cron으로 충분.
- **backfill**: `messages` 목록으로 최근 30일.
- **write-back**: send(`sendMail`), markRead(`isRead` PATCH), archive(`move` API로 Archive 폴더 이동).
- **thread/ID 매핑**: thread `externalId` = Graph `conversationId`. item `externalId` = message `id`, `sourceHash` = `internetMessageId`.
- **미디어**: `/attachments` 하위 엔드포인트로 개별 다운로드.
- **레이트리밋**: Graph 표준 스로틀링, `429` + `Retry-After` 헤더 존중.
- **실패모드**: webhook 갱신 실패 → delta 폴링 폴백, delta token 만료(410) → 풀 재동기화.
- **계정정지 리스크**: 낮음.
- **프로세스/Phase**: LaunchDaemon, Mac mini, Phase B. Standalone에서 완전 hub-less.

### 2.5 Telegram (mtcute)

- **인증/온보딩**: my.telegram.org 로그인 → "API development tools"에서 앱 생성해 `api_id`/`api_hash` 발급(공개 배포 절대 금지, `07` verified) → mtcute 클라이언트 초기화 → 최초 페어링은 **QR 로그인**(omnis 화면에 QR 렌더 → 아이폰 카메라로 스캔) 또는 phone+code(2FA cloud password 걸려 있으면 추가 입력) → mtcute 내장 SQLite 세션 파일을 로컬에 저장, 파일 자체를 감싸는 암호화 키만 Keychain(`omnis.telegram.session_key`)에 보관.
- **실시간/지연 목표**: MTProto persistent connection의 네이티브 update 스트림 — 실질적 실시간(수초 이내).
- **backfill**: mtcute `getHistory`로 최근 30일 또는 최근 500개.
- **write-back**: send, markRead(`markAsRead`) 전부 지원. archive는 Telegram 자체 폴더 API로 가능하나 v1은 커널 내부 라벨만 사용(`capabilities().archive = false`).
- **thread/ID 매핑**: thread `externalId` = chat/peer id. item `externalId` = message id, `sourceHash` = `(chatId, messageId)`.
- **미디어**: mtcute 파일 다운로드 API(대용량 2GB 한도는 omnis 스코프 밖 — 일반 이미지/문서만 캐시).
- **레이트리밋/빈도**: 서버측 flood-wait으로 동적 제어(응답 온 만큼 대기 후 재시도), `api_id` 비공개 유지. "짧은 시간 반복 로그인/로그아웃 금지"는 **UNVERIFIED — spike**로 취급한다(`research/07` adversarial 재검증이 이 규칙의 1차 소스를 core.telegram.org/api/terms·obtaining_api_id 어디에서도 확인 못 해 VERIFIED에서 내림 — 관찰/영구밴/이의제기 문구 자체는 confirmed, "frequent login/logout" 세부 규칙만 미확인). 세션은 페어링 후 재로그인 없이 유지하는 것으로 설계해 이 리스크를 회피한다.
- **실패모드**: flood-wait 응답 → 지정 시간 대기 재시도(`retryable_rate_limit`), 세션 무효화 → `auth_required`.
- **계정정지 리스크**: 낮음(공식 `api_id` 트랙, `07` verified).
- **프로세스/Phase**: LaunchDaemon(Node sidecar 프로세스로 mtcute 구동, omnis-hub와 로컬 IPC), Mac mini, Phase B. Standalone에서 세션 파일만 이전하면 hub-less.

### 2.6 WhatsApp — 1차: Beeper Desktop API

- **인증/온보딩**: Beeper Desktop 앱을 Mac mini에 설치(무료, Public beta) → Beeper 안에서 WhatsApp 계정을 QR로 페어링 → Settings → Integrations에서 Desktop API용 Bearer 토큰 발급 → Settings → Integrations → Advanced에서 **Remote Access** 활성화(`0.0.0.0` 바인딩, `X-Forwarded-*` 기반 base URL 계산) → **터널은 Tailscale로만**(Beeper 자체 터널 없음, Funnel/Cloudflare는 쓰지 않음 — 이미 존재하는 Tailscale ACL 재사용) → 토큰을 `omnis.beeper.token` Keychain에 저장.
- **실시간/지연 목표**: REST + 실험적 WebSocket(`ws://localhost:23373/v1/ws`, Bearer 인증, 이벤트 4종 `chat.upserted/deleted`, `message.upserted/deleted`, 구독은 `subscriptions.set`으로 전체 교체만 가능 — 증분 구독/해제 불가). "experimental" 딱지가 있으므로 초기엔 WS + REST 폴링(1분) 병행.
- **backfill**: Beeper REST `GET /v0/chats`, `GET /v0/messages` — Beeper가 이미 로컬에 히스토리를 갖고 있어 구조가 단순.
- **write-back**: send(`POST /v1/chats/{chatID}/messages`), markRead/markUnread(`POST /v1/chats/{chatID}/read|unread`). 문서상 네트워크별 예외조항이 없어 전 채널 공통으로 보이나, **실제 WhatsApp send 성공 여부는 문서로 확인 안 됨 — UNVERIFIED, Phase 0 스파이크 A1-②(§4)로 닫는다.**
- **thread/ID 매핑**: thread `externalId` = Beeper `chatID`. item `externalId` = Beeper message id, `sourceHash` = 동일.
- **미디어**: Beeper Assets API로 이미지/파일 프록시.
- **레이트리밋/인간 수준 빈도**: Beeper 공식 문서가 "personal use only, 과도한 발송 시 계정정지 가능"이라고 명시(`04` verified) — 자동 대량발송 절대 금지, draft-then-approve 유지, 응답률 자연스럽게(즉답 자동화 금지).
- **실패모드**: WS 끊김 → REST 폴링(1분)으로 폴백, 토큰 무효화 → `auth_required`, Beeper.app 자체가 죽으면(재시작 등) `health() = down`.
- **계정정지 리스크 완화 체크리스트**: (1) Beeper 내부도 whatsmeow 계열 프로토콜을 쓰므로 리스크 근원은 whatsmeow 폴백(§2.7)과 동일함을 인지, (2) read-mostly + 대량발송 금지, (3) 가정용 회선(Mac mini) 유지, (4) **부번호로 먼저 파일럿**(마스터 Q2 기본값), (5) 상태(status) 업로드 등 부가기능은 v1 범위 밖으로 아예 배제.
- **프로세스/Phase**: LaunchAgent(Beeper.app이 GUI 앱), omnis-hub(LaunchDaemon)는 HTTP client로만 연결. Mac mini, Phase C(스파이크 통과 + 부번호 파일럿 조건).
- **standalone(Phase D)**: Beeper.app은 omnis 앱과 **같은 Mac**에서 돌면 되므로(별도 항상-켜진 기기가 필요한 KakaoTalk/LinkedIn과 다름), 마스터 D12가 WhatsApp을 hub-less 5채널에 포함시킨 것과 일치 — 맥북 단독 전환 시 Beeper.app도 맥북으로 옮기고 계정 재페어링(QR)만 하면 된다.

### 2.7 WhatsApp — 폴백: whatsmeow 사이드카

- **전환 조건(A1-D3)**: §4 스파이크 A1-②에서 Beeper 경유 send가 실패하거나 WS가 30분 관찰 중 재연결 3회 이상이면 이 경로로 전환.
- **인증/온보딩**: whatsmeow(Go, MPL-2.0) 기반 사이드카 바이너리를 Mac mini에 빌드/배포 → `GetQRChannel()`로 QR 페어링(전체 세션 약 160초, omnis 앱 화면에 QR 렌더 → 아이폰 카메라 스캔, 만료 시 자동 재발급) → device store를 로컬 SQLite(`store/sqlstore`)에 영속화 → SQLite 파일 암호화 키만 `omnis.whatsmeow.session_key` Keychain에 저장.
- **실시간/지연 목표**: `AddEventHandler` 기반 순수 실시간 이벤트 스트림(persistent WebSocket).
- **backfill**: `events.HistorySync`(서버측 보존 기간에 의존 — 정확한 기간 **UNVERIFIED**, 프로토타입에서 직접 측정 필요. v1 설계에 영향 없음, 짧으면 backfill 범위만 줄어듦).
- **write-back**: send/markRead 완전 지원(라이브러리 네이티브), archive는 없음.
- **thread/ID 매핑**: thread `externalId` = JID(개인/그룹). item `externalId` = whatsmeow message ID.
- **미디어**: whatsmeow 네이티브 다운로드/업로드.
- **레이트리밋/인간 수준 빈도**: §2.6과 동일 원칙(자동 즉답 금지, 선제 메시지 금지, 가정용 IP 유지).
- **실패모드**: 내장 재연결 로직, 로그아웃 감지 시 `auth_required`(QR 재스캔 필요).
- **계정정지 리스크 완화 체크리스트**: §2.6과 동일 + 부번호 우선.
- **프로세스/Phase**: LaunchDaemon(Go 바이너리, omnis-hub와 로컬 HTTP/Unix socket 통신), Mac mini, Phase C(폴백 발동 시에만). Standalone에서 hub-less(바이너리 이식만 하면 됨, 마스터 §4.2와 일치).

### 2.8 KakaoTalk (kmsg)

- **인증/온보딩**: Mac mini의 KakaoTalk.app에 정상 로그인 유지(자동 로그인 On, 2FA는 새 기기 등록 시 1회, sub-device 연결마다 모바일에 뜨는 4자리 보안 인증번호 입력 — 이는 카카오 공식 정책, `25` verified) → `brew install channprj/tap/kmsg` → `kmsg mcp-server`(stdio, **3-tool만**: `kmsg_read`/`kmsg_send`/`kmsg_send_image` — `watch`는 MCP 툴이 아님, `05` adversarial verification 정정)와 `kmsg watch "<chat>" --json`(**별도 프로세스**)을 둘 다 구동 → `kmsg auth login`(비밀번호를 kmsg 자체 저장소에 넣는 기능)은 **쓰지 않는다** — KakaoTalk.app 자체의 로그인 유지만으로 충분(마스터 D10 "비밀 최소화"와 일치).
- **실시간/지연 목표**: `kmsg watch --json` 폴링, 기본 0.2~10s 간격을 **5~15초로 완화**(인간 수준 빈도, §4 A1-③의 talksafety.kakao.com 이상탐지 목록 기준). `read --background-safe`로 KakaoTalk.app 포커스를 뺏지 않음.
- **backfill**: kmsg `chats`/`read`는 **현재 열려 있는 대화 이력만**(카카오톡에 전체 히스토리 API가 없음). 장기 백필은 카카오톡 "대화 내보내기" export 텍스트 인덱싱(katok류 패턴, `25` 권고)으로 별도 트랙 — v1 실시간 캡처 범위 밖, A3/A4(메모리)에서 다룸.
- **write-back**: send(텍스트+이미지, **dry-run 기본 → 명시적 확인 후 1회 실행**, kmsg 기본 UX). markRead 전용 API는 없음 — 대화창을 열면 카카오톡 자체가 읽음 처리를 유발하므로, 폴링 설계 시 "읽기 = read-receipt 발생"을 감안해 `--background-safe`를 기본으로 쓴다. archive 없음.
- **thread/ID 매핑**: thread `externalId` = kmsg `chat_id`(`~/.kmsg/chat-registry.json` 로컬 레지스트리, 방 이름 변경 시 새 ID 발급). item `sourceHash` = `(chat_id, timestamp, sender, body 앞 64자)` 해시(카카오가 global message id를 노출하지 않으므로 대체 키).
- **미디어**: `--capture-images`(ScreenCaptureKit, 화면 기록 권한 필요) 옵션, 기본은 텍스트만.
- **레이트리밋/인간 수준 빈도**: talksafety.kakao.com/measure 공식 이상탐지 목록(`25` verified) — 짧은 기간 다량 친구추가, **PC 에뮬레이터 사용**(명시적 금지 문구 확인됨) 등을 그대로 "하면 안 되는 것" 체크리스트로 삼는다. `watch` 폴링 5~15초, 친구추가/채팅방 생성 빈도 최소화.
- **실패모드**: KakaoTalk.app 업데이트로 AX 경로 깨짐 → kmsg self-healing path cache 우선 시도 → 실패 시 Notification Center DB(Full Disk Access 필요) + Vision OCR(`macos-vision-ocr` 등, 온디바이스 무료) 폴백으로 최소한 "새 메시지 도착" 신호만 유지.
- **계정정지 리스크 완화 체크리스트**: (1) kmsg 저자 본인의 명시 경고("영구정지 사례 다수 존재") 인지 후 진행, (2) send는 항상 dry-run 확인, (3) 카카오 계정 2FA 활성화, (4) `watch` 5~15초 이상, (5) **read 2주 안정 후 send를 승인제로 연다**(마스터 Q3 기본값 그대로), (6) LOCO 프로토콜/비공식 API 직접 호출, PC 에뮬레이터 **절대 금지**(카카오 정책 문구로 1차 확인됨).
- **프로세스/Phase**: LaunchAgent(GUI 세션 필수 — KakaoTalk.app과 `kmsg watch`는 로그인 세션에서만 동작), Mac mini 전용, Phase C.
- **standalone(Phase D)**: 마스터 D12/§4.2 그대로 — "항상 켜진 GUI 세션을 가진 맥 1대"가 구조적으로 계속 필요하다. 이 부록에서 추가하는 것은 구현 지침뿐: KakaoTalk 커넥터를 코어(omnis-hub)와 물리적으로 분리된 **capture sidecar** 프로세스로 설계해, 그 GUI 세션이 미니든 맥북이든 코어 아키텍처에 영향 없이 이벤트를 같은 포맷으로 흘려보내게 한다(WhatsApp/Telegram 사이드카와 동일 패턴으로 통일, `25` 권고).

### 2.9 LinkedIn (Playwright + Gmail 알림메일 파싱)

- **인증/온보딩**: Mac mini에 Playwright Chromium 상주 프로필 생성(`playwright install chromium`) → LinkedIn에 1회 수동 로그인(2FA 포함) → 프로필 디렉토리(쿠키/localStorage)를 그대로 영속화해 **재로그인을 최소화**(재생된 세션이 도난으로 오인되는 `mautrix/linkedin#55` 유사 패턴을 피하기 위함, `06` 근거) → 자격증명 자체는 저장하지 않고 세션 쿠키만 프로필에 남김.
- **실시간/지연 목표**: 폴링, **5~15분 랜덤화 간격**(초 단위 고정 크론 금지, 수동 사용자 흉내) — 메시지함 페이지만 열어 신규 스레드 유무 확인, 프로필 대량 열람 금지. **병행 신호**: Gmail 어댑터(§2.2)에 발신 도메인 `@linkedin.com` 필터를 추가해 "새 메시지 도착"을 거의 공짜로 얻는다(신규 계정 연결 불요, 기존 Gmail 파이프라인 재사용). 실제 알림메일의 본문 구조(발신자명/프로필 URL/미리보기)는 샘플 미확보 — **UNVERIFIED, Phase 0 스파이크 A1-⑧(§4)로 닫는다.**
- **backfill**: 최초 로그인 시 메시지함 페이지를 1회 스크롤하며 DOM 파싱으로 최근 대화 이력 수집(대량 스크롤·프로필 열람 금지, 1회성).
- **write-back**: send(메시지 입력창에 텍스트 입력 + 전송 버튼 클릭, **승인 후에만**). markRead는 LinkedIn이 메시지함을 열면 자동 처리(별도 API 없음). archive 없음.
- **thread/ID 매핑**: thread `externalId` = LinkedIn 대화 URL의 conversation id(DOM 추출). item `sourceHash` = DOM 순번 + timestamp 해시.
- **미디어**: LinkedIn 메시지 내 이미지/문서는 Playwright로 다운로드 URL 추출 후 캐시.
- **레이트리밋/인간 수준 빈도**: Unipile provider-limits 문서 기준선(액션 전반 기본 100/일, 커넥션 초대 80~100/일·주 200 — `06` adversarial 정정치, "100~150"은 오기)을 참고 상한으로 두되, omnis는 1계정·사람 1인분 메시지량만 다루므로 이 한도에 근접할 일이 거의 없음. 프로필 대량 조회·대량 커넥션 요청 절대 금지.
- **실패모드**: LinkedIn UI 업데이트로 DOM 셀렉터가 깨지면 `health()` → `degraded`로 보고(자동 복구 시도 없음, 셀렉터 갱신은 수동 배포), 세션 쿠키 무효화 시 `auth_required`(재로그인 필요).
- **계정정지 리스크 완화 체크리스트(A1-D4)**: (1) `mautrix/linkedin#55`(20초 세션사망, 미해결) 때문에 Beeper/mautrix 경로 배제, (2) 폴링 5~15분 랜덤화, (3) 지속 프로필 재사용(매번 재로그인 금지), (4) Mac mini 고정 IP(Tailscale 뒤), (5) 발신은 항상 draft→승인, (6) 대량 커넥션 요청 금지.
- **프로세스/Phase**: LaunchAgent(브라우저 세션 필요), Mac mini 전용, Phase C. Gmail 알림메일 파싱만은 LaunchDaemon(Gmail 어댑터에 얹힘).
- **standalone(Phase D)**: KakaoTalk과 동일하게 "항상 켜진 GUI 세션" 제약이 구조적으로 남는다(마스터 D12). Gmail 알림메일 파싱 경로만 완전 hub-less로 동작하지만, "새 메시지 도착" 신호만 주고 본문 전체/답장은 못 한다 — Phase D UI는 이 비대칭을 숨기지 않고 "LinkedIn 요약은 hub-less에서도 오지만, 답장은 capture host가 켜져 있어야 한다"고 명시한다.

---

## 3. write-back 범위 요약

Capabilities 선언을 채널 가로축으로 정리하면 다음과 같다(마스터 §8 표의 R/W 열을 세분화).

| 채널 | send | markRead | archive | 비고 |
|---|---|---|---|---|
| Slack | O | O | X | 아카이브 개념 자체가 없음 |
| Gmail | O | O | O | 셋 다 Gmail API 표준 |
| Google Calendar | O(hold, 승인 후) | — | — | write는 있으나 항상 승인 게이트 |
| Outlook | O | O | O | 셋 다 Graph API 표준 |
| Telegram | O | O | X(v1) | archive API는 있으나 v1 미사용 |
| WhatsApp(Beeper) | O(스파이크로 확정 전 UNVERIFIED) | O | X | |
| WhatsApp(whatsmeow) | O | O | X | |
| KakaoTalk | O(dry-run→승인, Phase C 2주 후) | 자동(읽으면 발생) | X | markRead를 명시 호출할 API 없음 |
| LinkedIn | O(승인 후) | 자동(열면 발생) | X | |

---

## 4. Phase 0 스파이크 절차 (채널 관련)

마스터 §16의 Phase 0 14개 게이트는 이 부록으로 바뀌지 않는다(A1-D10). 이 표의 번호는 마스터 §16의 원문자 번호(①~⑭)와 겹치지 않도록 전부 `A1-` 접두를 쓴다. `A1-①`(Calendar)·`A1-②`(Beeper)·`A1-③`(kmsg)·`A1-④`(Slack)·`A1-⑤`(Gmail)는 마스터 §16의 ①·②·④·⑨·⑩과 같은 게이트이며, 이 부록은 그 5개를 채널 단위 명령·pass 기준으로 채울 뿐 새로 추가하지 않는다. `A1-⑥`(Outlook)·`A1-⑦`(Telegram)·`A1-⑧`(LinkedIn)은 Phase 0 게이트가 아니라 각자의 Phase 진입 시(마스터 §16 Phase B/B/C)에 실행한다. 전부 실측 없이는 §2의 설계가 가정에 머무른다.

| # | 스파이크 | 명령/단계 | Pass 기준 | Fail 시 결정 |
|---|---|---|---|---|
| A1-① | Calendar `events.watch` via Funnel(마스터 §16 ①) | Tailscale Funnel로 `https://<mini>.<tailnet>.ts.net/hooks/calendar` 노출 → `POST calendar/v3/calendars/primary/events/watch` (`address`에 위 URL) | `validationToken` 핸드셰이크 통과 + 실제 일정 변경 알림 1건 수신 | syncToken 폴링(1~5분)을 확정 기본값으로, §2.3 push 전환 문단 폐기 |
| A1-② | Beeper 토큰 발급 + WhatsApp 부번호 send(마스터 §16 ②) | Beeper Settings→Integrations에서 토큰 발급 → `POST /v1/chats/{chatID}/messages`(부번호가 속한 chatID로) | HTTP 200 + 상대 단말에서 수신 확인 | A1-D3에 따라 whatsmeow 사이드카(§2.7)로 즉시 전환, Beeper는 다른 6개 네트워크(Instagram/Signal/Discord 등, v1 범위 밖)용으로만 유지 |
| A1-③ | kmsg read on mini(마스터 §16 ④) | `brew install channprj/tap/kmsg && kmsg chats --json && kmsg read <chat_id> --background-safe --json` | JSON에 최근 메시지 정상 출력, KakaoTalk.app 포커스 뺏기지 않음 | Notification Center DB + Vision OCR 폴백 설계로 전환, KakaoTalk read 착수 지연을 Logan에게 보고 |
| A1-④ | Slack Socket Mode 1턴 왕복(마스터 §16 ⑨) | Manifest로 앱 생성 → `apps.connections.open` → WS 연결 → 테스트 DM 발송 | 5초 이내 이벤트 수신(G1) | Events API(공인 endpoint, Funnel 경유) 대안 검토 — Phase A 지연 가능 |
| A1-⑤ | Gmail watch+Pub/Sub pull 왕복(마스터 §16 ⑩) | `gcloud pubsub topics create omnis-gmail` → `users.watch()` → 테스트 메일 발송 | pull subscription으로 `historyId` 수신 | `history.list` 1분 폴링으로 폴백(이미 §2.2에 폴백으로 명시된 경로, 기능 손실 없음) |
| A1-⑥ | Outlook Graph webhook via Funnel(Phase B 진입 시) | Funnel URL로 `notificationUrl` 지정해 구독 생성 | `validationToken` 핸드셰이크 통과 + 실제 알림 수신 | delta query 폴링 유지(Phase B 기본값이 이미 폴링이므로 soft-fail, 일정 영향 없음) |
| A1-⑦ | Telegram mtcute QR 로그인 + 1턴 송수신(Phase B 진입 시) | my.telegram.org에서 `api_id` 발급 → mtcute QR 로그인 스크립트 → 테스트 메시지 왕복 | SQLite 세션 저장 확인 + 메시지 왕복 | phone+code 로그인 경로로 폴백(라이브러리 자체 지원, 설계 변경 없음) |
| A1-⑧ | LinkedIn 알림메일 샘플 확보(Phase C 진입 시) | LinkedIn에서 실제 DM 1건 발생 → Gmail `messages.get?format=raw`로 원문 확보 | 발신자명/프로필 URL/미리보기 파싱 규칙 확정 | 알림메일 경로는 "새 메시지 도착" 트리거로만 쓰고 본문 파싱은 v1에서 제외, Playwright 폴링만으로 커버 |

**스파이크 범위 밖의 미검증 항목**(go/no-go 게이트는 아니지만 설계에 영향 가능): whatsmeow `events.HistorySync`가 실제로 며칠 분량을 백필해주는지(§2.7) — v1 backfill 범위 추정치에만 영향, 프로토타입 단계에서 측정.

---

## 5. 마스터와의 관계 확인

이 부록은 마스터 §8 표(채널×경로×폴백×R/W×리스크×Phase)의 값을 바꾸지 않는다 — WhatsApp의 "Beeper 1차/whatsmeow 폴백", LinkedIn의 "Playwright 1차/Gmail 알림메일·Unipile 폴백", KakaoTalk의 "kmsg, read 2주 후 send" 전부 마스터 원문 그대로이고, 이 부록은 그 안을 실행 가능한 명령·스키마·체크리스트로 채웠을 뿐이다. `21`(Calendar push 도메인 검증 정정), `08`(Outlook 구독 수명 10,080분 확정치)도 마스터가 이미 채택한 값과 일치하거나(§8 표에 10,080분으로 이미 반영됨) 마스터가 조건부로 열어둔 스파이크의 성공 가능성을 높이는 방향이라 재작업이 필요 없다.

---

## 수정 이력 (v0.95, 2026-09-20)

마스터 v0.95 + `99-review.md`(전역 리뷰) 대조 후 A1 자체 "리뷰 노트 (2026-09-20)"의 4건 전부를 이 패스에서 닫아 그 섹션은 삭제한다.

1. §4 Phase 0 스파이크 표를 `A1-①`~`A1-⑧`로 리라벨(마스터 §16의 ①~⑭와 원문자 번호 충돌 제거), A1-D10 문구를 마스터 §16의 실제 14게이트(①②④⑨⑩=채널 관련 5개, 나머지는 각 Phase 진입 시)에 맞춰 재작성.
2. A1-D1을 "메서드 시그니처는 유지 + 메서드 목록은 `disconnect?()`/`archive?()`로 EXTEND"로 정정, §1.6·§3의 archive 능력 표기와 일치 확인.
3. `NormalizedItem.author.kind`를 `"person" | "agent" | "system"`으로 확장해 A3 `items.author_person_id`/`author_agent_id`/(둘 다 NULL=system) 3열 모델과 정렬, agent-authored Item(A2 소관)을 타입에서 배제하지 않도록 수정.
4. §2.1 Slack "G5(5초)" 오기를 "G1(5초)"로 수정(마스터 §2 G1=채널 수신 5초, G5=기기간 동기화 2초), §4 A1-④ pass 기준에도 G1 표기 반영.
5. §2.5 Telegram "짧은 시간 반복 로그인/로그아웃 금지"와 §2.2 Gmail "gmail.modify 100 user 미만 검증 불요"를 UNVERIFIED — spike로 표기(각각 `research/07`, `research/08`의 adversarial 재검증 결과 인용).
6. 허브 로컬 포트: A1 본문에 포트 리터럴 참조가 없어 8787 충돌 없음 — 변경 없음(확인만).
7. §1.3에 Keychain 명명 규칙(`omnis.<channel>.<kind>.<external_id>`) 한 줄 요약 + 채널별 현재 항목 표 추가, A6이 그대로 참조하도록 함(`99-review.md` §1.2 "Keychain 명명" 판정 반영).
