# 08 — Channel integration: Slack, Gmail, Outlook/M365, Google Calendar

Researched 2026-09-20. Scope: capture design for a single power user (Logan), Mac mini hub + MacBook/iPhone clients over Tailscale, no public server today.

## 1. TL;DR

Slack는 RTM 대신 **Socket Mode**(WebSocket, 아웃바운드 연결이라 맥미니에서 포트 오픈 없이 됨) + **xoxp user token**을 같이 써야 "나에게 오는 멘션/DM 전체"와 "내 이름으로 발송"이 가능함(bot token만으로는 안 됨). Gmail은 **watch() + Cloud Pub/Sub**가 최선 — Pub/Sub는 구글 인프라라 공인 엔드포인트가 필요 없음(pull subscription 가능). 단 OAuth "Testing" 모드는 refresh token이 **7일**로 죽으므로 Production 전환 필수, gmail.modify 같은 sensitive scope는 100 user 미만이면 검증 없이도 별 문제 없음. Outlook/M365는 Graph webhook을 쓰려면 **공인 HTTPS 엔드포인트**가 필요한데 이건 Google Calendar처럼 Search Console 도메인 소유 검증까지 요구하진 않아서 **Tailscale Funnel**로 뚫을 수 있음(구독 최대수명 4230분=약 3일, 갱신 필요). Google Calendar push는 도메인 소유 인증이 필요해 Funnel로는 사실상 막히므로 **syncToken 폴링**이 현실적. openclaw 레포(39만 stars)에 Slack/IMAP/Google 채널 플러그인 아키텍처가 그대로 참고할 소스로 있음.

## 2. Facts

**Slack**
- RTM API는 신규 앱에서 사용 불가; 레거시 classic app은 2026-11-16에 완전 중단, 대체는 Socket Mode(`apps.connections.open` → WebSocket) 또는 Events API(HTTP). VERIFIED. Source: [Slack changelog — legacy custom bots/classic apps deprecation](https://api.slack.com/changelog/2024-09-legacy-custom-bots-classic-apps-deprecation), [Legacy RTM API docs](https://docs.slack.dev/legacy/legacy-rtm-api/). Fetched 2026-09-20.
- Socket Mode는 앱당 최대 10개 동시 WebSocket 연결 허용(로드밸런싱/graceful restart 용도), URL은 `apps.connections.open` 호출마다 새로 발급되어 주기적으로 갱신해야 함. VERIFIED. Source: [apps.connections.open](https://api.slack.com/methods/apps.connections.open), [Socket Mode implementation](https://api.dev.slack.com/apis/connections/socket-implement). Fetched 2026-09-20.
- Bot token(`xoxb`)은 초대된 채널/자신에게 온 DM만 봄; 워크스페이스 전체 검색, 남의 DM, "내 이름으로 온 것처럼 보이는" 발송(사람이 직접 친 것처럼)은 user token(`xoxp`, 예: `search:read`, `channels:history` 리소스 기반 스코프)이 있어야 함. VERIFIED. Source: [Token types](https://api.slack.com/authentication/token-types), [Bot vs user tokens](https://slack.dev/two-keys-to-one-platform-understanding-bot-and-user-tokens/). Fetched 2026-09-20.
- Rate limit은 "API 메서드 × 워크스페이스 × 앱" 단위로 별도 버킷. Non-Marketplace 앱은 2025-05 이후 신규 설치, 2026-03-03부터는 기존 설치까지 `conversations.history`/`conversations.replies`가 분당 1회·15개로 강하게 제한됨(Marketplace 승인 앱은 분당 50+회, limit 최대/기본 1000). 개인 워크스페이스 전용(비배포) 앱은 이 제한의 적용 여부가 불명확 — Marketplace 미등록이면 "commercially distributed" 여부와 무관하게 걸릴 수 있음. VERIFIED(제한 내용) / UNVERIFIED(개인 전용 내부 앱 예외 여부). Source: [Rate limits](https://docs.slack.dev/apis/web-api/rate-limits/), [Rate limit changes for non-Marketplace apps](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq). Fetched 2026-09-20.
- 여러 워크스페이스를 쓰려면 워크스페이스마다 별도 OAuth 설치(같은 앱 정의를 재사용해 여러 번 install)가 필요 — "멀티 워크스페이스 단일 설치"는 Enterprise Grid org-wide install 경로로만 됨. VERIFIED (per-workspace bucket 구조로 추론, openclaw enterprise-grid 문서로 교차 확인). Source: 위 rate limits 문서 + [openclaw docs/channels/slack/enterprise-grid.md] (repo listing, 2026-09-20).

**Gmail**
- `users.watch`는 Gmail 메일함을 Cloud Pub/Sub 토픽에 연결하고, 변경 시 `emailAddress`+`historyId`(워터마크)만 담은 메시지를 퍼블리시함 — 본문은 안 옴, 이후 `history.list`로 diff를 가져와야 함. **채널 만료는 7일**, 매일 cron으로 재등록 필요. VERIFIED. Source: [Configure push notifications with the Gmail API](https://developers.google.com/workspace/gmail/api/guides/push), [users.watch quota 100 units](https://www.unipile.com/gmail-api-push-notifications/). Fetched 2026-09-20.
- Pub/Sub는 구글이 운영하는 메시지 버스라서, **pull subscription**을 쓰면 내 쪽에 공인 HTTPS 엔드포인트가 전혀 필요 없음(맥미니에서 아웃바운드로 polling하면 끝) — push subscription을 쓸 때만 공인 endpoint가 필요. 이 점이 Calendar API의 webhook 방식과 결정적으로 다름. VERIFIED (Pub/Sub 아키텍처 표준 동작). Source: [Gmail push guide](https://developers.google.com/workspace/gmail/api/guides/push). Fetched 2026-09-20.
- OAuth consent screen이 "Testing" 상태(=미검증 앱)면 발급되는 refresh token이 **정확히 7일 후 만료**. "Production"으로 게시(publish)하면 이 제한이 사라짐. 개인 1인용 앱이라도 Testing에 머물면 매주 재인증해야 함. VERIFIED. Source: [Google OAuth Refresh Token 7-day limit](https://www.unipile.com/google-oauth-refresh-token/), Google 공식 OAuth2 refresh-token-expiration 문서(위 페이지 인용). Fetched 2026-09-20.
- `gmail.modify`(read+compose+send) 같은 "sensitive" 스코프는 **100명 미만 테스트 사용자**면 정식 verification 없이도 계속 쓸 수 있음(Cloud Console에 test user로 등록); 100명 넘거나 퍼블릭 공개 시 검증 필요. "Restricted" 등급 스코프(전체 메일함 export급)는 별도로 더 엄격. 개인 전용 프로젝트(사용자=본인 1명)는 사실상 검증 부담이 거의 없음 — 다만 Production 게시는 해야 refresh token이 안 죽음(검증과 게시는 별개 절차). VERIFIED. Source: [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Nylas — Google OAuth app verification](https://www.nylas.com/blog/google-oauth-app-verification/). Fetched 2026-09-20.
- Gmail API 신규 프로젝트(2026-05-01 이후 생성) 쿼터: 프로젝트당 분당 120만 유닛, 유저당 분당 6,000 유닛. `messages.send`는 요청당 100유닛 → 유저 기준 분당 최대 60통 발송 가능. `users.watch`는 100유닛/콜. VERIFIED. Source: [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota), [Unipile — Gmail API limits 2026](https://www.unipile.com/gmail-api-limits/). Fetched 2026-09-20.
- Hermes Agent(맥미니 상시구동)의 이메일 게이트웨이는 IMAP/SMTP 기반 **reply-only**(발신 스레드 답장만, 신규 발송/실시간 push 아님) — 이는 이번 세션 웹검증이 아니라 프로젝트 내부 기록(과거 Hermes 분석)에서 가져온 값. UNVERIFIED(이번 세션에서 재검증 안 함, 코드 확인 필요).

**Outlook / Microsoft 365 (개인 + 회사)**
- Graph 변경 알림(webhook)은 **공인 HTTPS 엔드포인트**가 필수 — private/localhost로는 전달 안 됨. 검증은 구독 생성 시 `validationToken`을 그대로 echo하는 핸드셰이크 방식으로, Google Calendar처럼 Search Console 도메인 소유 인증을 요구하지 않음(문서상 명시 안 됨). VERIFIED (엔드포인트 요건) / 상대적으로 낮은 확신(도메인 검증 불요 — 부재 증명이라 완전한 VERIFIED는 아님, MEDIUM). Source: [Receive change notifications through webhooks](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks), [Change notifications overview](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview). Fetched 2026-09-20.
- 메일 리소스 구독의 **최대 수명은 4230분(≈2.94일)**; 45분 미만으로 설정하면 자동으로 45분으로 보정. 만료 전에 갱신(`PATCH` expirationDateTime) 안 하면 새로 만들어야 함. VERIFIED. Source: [subscription resource type](https://learn.microsoft.com/en-us/graph/api/resources/subscription), [Elio Struyf — renewing Graph webhook subscriptions](https://www.eliostruyf.com/creating-and-renewing-your-microsoft-graph-webhook-subscriptions/). Fetched 2026-09-20.
- 앱 등록(Entra ID/Azure AD)에서 "Accounts in any organizational directory and personal Microsoft accounts"를 선택하면 **개인 Outlook.com 계정과 회사(M365) 계정을 단일 앱 등록**으로 함께 처리 가능(`/common` authority endpoint). IMAP/POP/SMTP도 OAuth2로 지원되지만 Microsoft는 webhook 등 기능 이점 때문에 Graph API를 권장. VERIFIED. Source: [Unipile — Microsoft Graph OAuth email](https://www.unipile.com/microsoft-graph-oauth-email/), [Authenticate IMAP/POP/SMTP via OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth). Fetched 2026-09-20.
- Publisher verification(파란 인증 배지)은 **멀티테넌트 배포 앱**용 절차이고 개인 1인 사용(단일 테넌트/개인 계정, "Unverified" 경고만 뜨고 본인이 직접 Consent하면 동작)에는 강제되지 않음 — 사용자 본인만 쓰는 개인 프로젝트라면 실무적으로 건너뛸 수 있음. VERIFIED (절차 목적) / 개인용 예외 적용은 MEDIUM 확신. Source: [Publisher verification overview](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview). Fetched 2026-09-20.

**Google Calendar**
- `events.watch` 채널도 **7일 만료**, 자동 갱신 메커니즘이 없어 만료 전 수동으로 새 채널을 열어 교체해야 함(만료 시각은 매 알림의 `X-Goog-Channel-Expiration` 헤더로 옴). VERIFIED. Source: [Google Calendar push notifications](https://developers.google.com/workspace/calendar/api/guides/push). Fetched 2026-09-20.
- Calendar push를 받으려면 **콜백 도메인을 Search Console로 소유 검증**하고 API Console에 등록해야 함 — Gmail의 Pub/Sub 방식과 달리 진짜 "내 소유 도메인 + 유효 SSL"이 필요. `*.ts.net`(Tailscale Funnel이 주는 서브도메인)은 Tailscale 소유 도메인이라 개인이 Search Console에서 소유권을 증명하기 어려움 → 사실상 Calendar push는 개인 셋업에서 막힘. VERIFIED (요구사항) / Funnel 도메인 검증 실패 가능성은 추론(MEDIUM, 실제 시도로 재확인 필요). Source: [Verifying domains for push notifications](https://support.google.com/googleapi/answer/7072069), [Google Calendar push guide](https://developers.google.com/workspace/calendar/api/guides/push). Fetched 2026-09-20.
- 자체 도메인이 없으면 대안은 **폴링**: `events.list`를 `syncToken`과 함께 증분 호출(변경분만 받음), 짧은 주기(예: 1~5분)로 충분히 실시간처럼 느껴짐. UNVERIFIED(정확한 폴링 주기별 쿼터 소모는 미검증, 다만 `events.list`는 표준 read 쿼터로 저렴함이 일반적으로 알려짐).

**아키텍처 참고 소스 (openclaw)**
- `github.com/openclaw/openclaw` — 390,096 stars(2026-09-20 기준), TypeScript, "AI that really does things. Any OS. Any Platform." VERIFIED (레포 메타데이터 직접 조회). Source: `gh repo view openclaw/openclaw`. Fetched 2026-09-20.
- `extensions/` 디렉토리에 슬랙(`extensions/slack`), IMAP(`extensions/imap`), 구글(`extensions/google`), Discord, Telegram, WhatsApp 등 **채널마다 독립 plugin 패키지**로 분리된 구조가 있고, `docs/channels/slack/{setup,events,transports,enterprise-grid,troubleshooting}.md`처럼 채널당 표준 문서 세트가 있음. Slack setup 문서에는 Socket Mode용 App manifest(JSON)가 그대로 포함되어 있고 `Recommended`/`Minimal` 두 가지 스코프 세트(`channels:history`, `chat:write`, `im:history`, `reactions:read` 등)를 제공. VERIFIED (레포 파일 직접 fetch). Source: `gh api repos/openclaw/openclaw/contents/docs/channels/slack/setup.md`, `gh api repos/openclaw/openclaw/contents/extensions`. Fetched 2026-09-20.
- Nango(`github.com/NangoHQ/nango`)는 오픈소스, 900+ API에 대한 OAuth 플로우/토큰 리프레시/자격증명 저장을 통합 관리하는 self-hostable 플랫폼(Auth/Proxy/Functions 3-primitive). VERIFIED. Source: [Nango GitHub](https://github.com/NangoHQ/nango), [Best open-source API integration platforms 2026](https://nango.dev/blog/best-open-source-api-integration-platforms-for-ai-agents/). Fetched 2026-09-20.

## 3. Options / comparison

|채널 | 실시간 전략 옵션 | 채택 후보 | 이유 |
|---|---|---|---|
| Slack | Socket Mode(WS) vs Events API(HTTP, 공인 endpoint 필요) vs RTM(신규 앱 불가) | **Socket Mode** | 맥미니에서 아웃바운드 연결만 열면 됨, 공인 IP/도메인/TLS 불요, RTM 대체 공식 경로 |
| Slack 토큰 | Bot(xoxb) only vs Bot+User(xoxp) | **Bot+User 병행** | "나에게 오는 모든 것"은 bot으로 커버 안 되는 검색/타인 DM 가시성이 있고, "내 이름으로 발송"은 user token 필요 |
| Gmail | watch()+Pub/Sub push vs history.list 폴링 vs IMAP IDLE | **watch()+Pub/Sub pull subscription** | 공인 엔드포인트 불요(맥미니가 폴링만 하면 됨), 초단위 지연, 쿼터 절약. IMAP IDLE은 OAuth2 지원되지만 Gmail 고유 라벨/스레드 모델을 못 씀 |
| Outlook 알림 | Graph webhook(공인 HTTPS 필요) vs delta query 폴링 | **초기: delta 폴링 / 중기: Graph webhook + Tailscale Funnel** | webhook은 4230분마다 갱신 필요하고 Funnel 안정성 검증 전까지는 폴링이 더 싸고 단순 |
| Outlook 프로토콜 | Graph API vs IMAP+OAuth2 | **Graph API** | webhook·delta·카테고리·대화스레드 등 기능 우위, MS 공식 권장 |
| Calendar 알림 | events.watch(도메인 검증 필요) vs syncToken 폴링 | **syncToken 폴링(1~5분 주기)** | Funnel 도메인은 Search Console 소유 검증 불가 가능성 높음; 캘린더는 이메일/슬랙만큼 초단위 긴급성이 없어 폴링으로 충분 |

## 4. Recommendation for omnis

**Slack** — Socket Mode + 워크스페이스별 개별 앱 설치(user token 포함), openclaw의 manifest를 그대로 fork해서 스코프만 다듬기. 노력: **S**(레퍼런스 manifest 있음). 리스크: 워크스페이스 관리자 승인이 필요한 회사 워크스페이스에서 개인 앱 설치가 막힐 수 있음(ToS/조직 정책 리스크, MEDIUM) — user token으로 "본인 계정처럼 행동"하는 건 Slack ToS상 문제 없음(사람이 위임한 정상 OAuth 플로우).

**Gmail** — watch()+Pub/Sub pull, OAuth를 반드시 "Production"으로 publish(검증 자체는 생략 가능, 100 user 미만 개인용이므로)해서 7일 만료를 피할 것. 노력: **M**(Pub/Sub 토픽/구독 설정, 매일 재-watch cron). 리스크: 낮음(계정 정지 리스크 거의 없음, 공식 API 정상 사용).

**Outlook** — 1단계는 delta query 폴링으로 시작(설정 마찰 최소), 안정화 후 Graph webhook + Tailscale Funnel 실험. 개인 계정은 publisher verification 불요라 진입장벽 낮음. 노력: **S→M**. 리스크: 낮음, 단 Funnel 안정성 미검증(맥미니 재부팅/네트워크 변동 시 URL 안정성 확인 필요).

**Google Calendar** — push는 보류, syncToken 폴링만으로 MVP. 노력: **S**. 리스크: 낮음.

**공통 인프라** — Nango 같은 오픈소스 OAuth broker를 자체 구현 대신 self-host하는 걸 강하게 권장(1인 프로젝트에서 4개 이상 OAuth provider의 토큰 갱신/저장을 직접 짜는 건 낭비). 노력 절감 효과 큼.

## 5. What to borrow

- **`github.com/openclaw/openclaw` — `extensions/slack/`, `extensions/imap/`, `extensions/google/`**: 채널당 독립 플러그인 패키지 구조 그대로 omnis의 "adapter per channel" 아키텍처로 차용. `docs/channels/slack/setup.md`의 Socket Mode manifest(JSON)와 스코프 리스트를 시작점으로 복사.
- **`docs/channels/index.md`의 "Gateway" 개념**: 모든 채널이 단일 Gateway를 통해 연결되고, `openclaw channels add`/`channels status --probe` 같은 CLI로 상태를 관리 — omnis의 맥미니 허브 데몬에 동일한 "channels add/status" CLI 패턴을 적용할 것.
- **`extensions/imap/`**: Outlook/Gmail IMAP 폴백 어댑터 코드가 이미 있으므로, Graph webhook 불안정 시 폴백 경로로 그대로 참고 가능.
- **Nango (`NangoHQ/nango`)**: OAuth 토큰 저장/리프레시/멀티테넌트 credential 관리를 self-host해서 omnis 자체 OAuth broker로 얹는 것 검토. Auth/Proxy 2개 primitive만 쓰면 충분(Functions는 불필요할 수도).
- **Pub/Sub pull-subscription 패턴**: Gmail만 공인 엔드포인트 없이 실시간이 가능하다는 비대칭성을 설계에 반영 — 맥미니가 "outbound-only" 폴러로 남아도 Gmail은 진짜 실시간, Slack도 Socket Mode라 outbound-only로 실시간 가능. Outlook/Calendar만 폴링 주기 타협이 필요하다는 걸 온보딩 UX에 반영(사용자에게 "이 채널은 준실시간"이라고 표시).

## 6. Open questions

- Slack 개인 워크스페이스(회사 소유) 관리자가 "커스텀 앱 설치"를 막아뒀는지 — 회사 워크스페이스별로 확인 필요.
- Tailscale Funnel로 발급된 `*.ts.net` HTTPS 엔드포인트가 실제로 Microsoft Graph의 webhook validation handshake를 통과하는지 — 서치 결과는 이론적 추정(공식 문서에 Funnel 사례 없음), 실제 스파이크 테스트 필요.
- Hermes Agent의 이메일 게이트웨이가 정말 IMAP/SMTP reply-only인지, 최신 코드에서 Gmail API/Graph API로 확장됐는지 — 코드 재확인 필요(`~/AI-Workspaces/Claude/memory/hermes-enterprise-loop-service.md` 근거가 2026-07-03 시점 기록이라 stale할 수 있음).
- Gmail OAuth를 "Production"으로 publish할 때, `gmail.modify`처럼 sensitive 스코프가 포함되면 정말 검증 없이 게시가 허용되는지(문서상 100 user 미만은 테스트 사용자 등록으로 커버되지만, "Testing→Production 전환" 자체에 스코프 검증이 강제되는 케이스가 있는지는 소스마다 뉘앙스가 갈림) — 실제 Cloud Console에서 시도해 확인 필요.
- Google Calendar용 웹훅을 포기하고 폴링만 쓸 경우, 1~5분 주기가 "캘린더 컨텍스트 실시간 반영" 요구사항(브리프의 "업무와 삶의 컨텍스트 조율")에 충분한지 사용자 확인 필요.

## 7. Sources

- [Slack changelog — legacy custom bots/classic apps deprecation](https://api.slack.com/changelog/2024-09-legacy-custom-bots-classic-apps-deprecation)
- [Legacy RTM API | Slack Developer Docs](https://docs.slack.dev/legacy/legacy-rtm-api/)
- [apps.connections.open method](https://api.slack.com/methods/apps.connections.open)
- [Socket Mode implementation](https://api.dev.slack.com/apis/connections/socket-implement)
- [Token types | Slack](https://api.slack.com/authentication/token-types)
- [Bot and user tokens explained](https://slack.dev/two-keys-to-one-platform-understanding-bot-and-user-tokens/)
- [Rate limits | Slack Developer Docs](https://docs.slack.dev/apis/web-api/rate-limits/)
- [Rate limit changes for non-Marketplace apps](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq)
- [Configure push notifications with the Gmail API](https://developers.google.com/workspace/gmail/api/guides/push)
- [Gmail API Push Notifications guide (Unipile, 2026)](https://www.unipile.com/gmail-api-push-notifications/)
- [Google OAuth Refresh Token: 7-Day Limit (Unipile, 2026)](https://www.unipile.com/google-oauth-refresh-token/)
- [Restricted scope verification | Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google OAuth App Verification (Nylas)](https://www.nylas.com/blog/google-oauth-app-verification/)
- [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Gmail API Limits in 2026 (Unipile)](https://www.unipile.com/gmail-api-limits/)
- [Receive change notifications through webhooks | Microsoft Graph](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)
- [Change notifications for Outlook resources overview](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview)
- [subscription resource type | Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/resources/subscription)
- [Creating and renewing Graph webhook subscriptions (Elio Struyf)](https://www.eliostruyf.com/creating-and-renewing-your-microsoft-graph-webhook-subscriptions/)
- [Microsoft Graph OAuth: Authenticate Outlook and M365 (Unipile, 2026)](https://www.unipile.com/microsoft-graph-oauth-email/)
- [Authenticate an IMAP, POP or SMTP connection using OAuth | Microsoft Learn](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Publisher verification overview | Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)
- [Push notifications | Google Calendar API](https://developers.google.com/workspace/calendar/api/guides/push)
- [Verifying domains for push notifications](https://support.google.com/googleapi/answer/7072069)
- [Tailscale Funnel examples](https://tailscale.com/docs/reference/examples/funnel)
- [Share a local dev server with the internet | Tailscale Docs](https://tailscale.com/docs/use-cases/application-testing/share-local-dev-server-with-internet)
- `gh repo view openclaw/openclaw` (2026-09-20)
- `gh api repos/openclaw/openclaw/contents/docs/channels/slack/setup.md` (2026-09-20)
- `gh api repos/openclaw/openclaw/contents/docs/channels/index.md` (2026-09-20)
- [Nango GitHub](https://github.com/NangoHQ/nango)
- [Best open-source API integration platforms for AI agents (Nango blog, 2026)](https://nango.dev/blog/best-open-source-api-integration-platforms-for-ai-agents/)

## Verification (adversarial)

Adversarial re-check performed 2026-09-20 by fetching primary sources directly (not re-trusting the original citations). Methodology: `WebFetch` on each official doc page, `gh api`/`gh repo view` on the openclaw and Nango repos. Where a claim's own confidence was already "medium," that hedge is preserved unless a primary source resolved it either way.

| # | Claim (abridged) | Verdict | Evidence URL (fetched 2026-09-20) | Correction |
|---|---|---|---|---|
| 1 | RTM unusable for new apps; classic apps sunset 2026-11-16; replacement Socket Mode/Events API | **CONFIRMED** | [Slack changelog — classic apps deprecation](https://docs.slack.dev/changelog/2024-09-legacy-custom-bots-classic-apps-deprecation/), [Legacy RTM API](https://docs.slack.dev/legacy/legacy-rtm-api/) | None. Page states verbatim: "Beginning November 16, 2026, classic apps will no longer function." Granular-permission (new) apps cannot use RTM at all; Socket Mode is explicitly recommended as "a better way." |
| 2 | Bot token (xoxb) can't search workspace or see others' DMs, can't send "as the user"; xoxp required | **CONFIRMED** | [Token types](https://docs.slack.dev/authentication/tokens), [`search:read` scope](https://docs.slack.dev/reference/scopes/search.read) | None. `search:read` is explicitly "Supported token types: User" only (no bot variant). User-token actions are documented as "performed as if by the user themselves"; bot-token actions are attributed to the bot identity, not a person. |
| 3 | Gmail `users.watch()` pushes only historyId via Pub/Sub; pull subscription needs no public endpoint; channel expires every 7 days, renew daily | **CONFIRMED** | [Configure push notifications — Gmail API](https://developers.google.com/workspace/gmail/api/guides/push) | None. Pushed payload is exactly `{emailAddress, historyId}`; pull subscriptions are client-initiated (no inbound endpoint); "You must call watch at least once every 7 days." |
| 4 | Testing-status OAuth apps get 7-day refresh tokens; Production removes this; <100 test users avoids verification for sensitive scopes (e.g. gmail.modify) | **PARTIALLY CONFIRMED** | [Google OAuth2 docs — refresh token expiration](https://developers.google.com/identity/protocols/oauth2), [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) | 7-day refresh-token expiry for "Testing" status is confirmed verbatim in Google's own OAuth2 doc (better primary source than the Unipile blog originally cited). The "<100 test users avoids verification for *sensitive* (non-restricted) scopes" mechanic is directionally right (Google support docs confirm a test-user cap exists and that apps using only non-sensitive scopes skip verification) but the exact "100" figure and its applicability specifically to `gmail.modify` could not be pinned to primary-source text in this session — treat that specific number as UNVERIFIABLE, not confirmed, until checked live in Cloud Console. |
| 5 | Graph webhooks need a public HTTPS endpoint + `validationToken` handshake; no Search-Console-style domain-ownership check (unlike Calendar) | **CONFIRMED** | [Receive change notifications through webhooks](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks) | None — matches the file's own "medium confidence" framing. Endpoint must be "publicly accessible, HTTPS-secured"; validation is a plain-text `validationToken` echo within 10 seconds. The page never mentions domain-ownership verification. |
| 6 | Graph mail subscriptions max out at 4,230 minutes (~2.94 days) | **REFUTED** | [subscription resource type — v1.0](https://learn.microsoft.com/en-us/graph/api/resources/subscription) | Current Microsoft doc (subscription-lifetime table) states **Outlook `message`, `event`, `contact` max expiration is 10,080 minutes (under 7 days)** — not 4,230. 4,230 minutes applies to *other* resources (Teams `callRecord`, `onlineMeeting`, `printer`, `todoTask`, group `conversation`, deprecated `baseTask`), not to mail/calendar/contacts. This was likely true at an earlier point (matches the vintage of the Elio Struyf blog cited) and Microsoft has since raised the mail limit. Practical effect: Outlook message-subscription renewal cadence can be ~weekly, not ~every 3 days — lower operational overhead than the brief assumed. |
| 7 | Calendar `events.watch` expires every 7 days with no auto-renew; push requires Search-Console domain-ownership verification, which a `*.ts.net` Funnel domain will likely fail, making syncToken polling the practical strategy | **PARTIALLY REFUTED** | [events.watch reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch), [Push notifications guide](https://developers.google.com/workspace/calendar/api/guides/push), [Verifying domains for push notifications](https://support.google.com/googleapi/answer/7072069) | 7-day *default* TTL (604,800s) and "no automatic way to renew a channel" are both confirmed. But the domain-ownership-verification premise is **outdated**: Google's own support page states plainly that "domain verification in the API Console is no longer required" and directs developers to the API-specific push-notification docs instead — and the current Calendar push guide's only endpoint requirements are HTTPS + a valid (non-self-signed, non-expired) SSL certificate, nothing about proving domain ownership via Search Console. Tailscale Funnel issues real Let's Encrypt certs on its `*.ts.net` subdomains, so this specific blocker for Calendar webhook push via Funnel no longer applies as described — see corrected recommendation below. |
| 8 | Single Entra app registration ("any org directory + personal Microsoft accounts") handles personal Outlook.com and work M365 via `/common`; publisher verification is only a multitenant-distribution requirement | **CONFIRMED** | [Publisher verification overview](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview) | None. Page states verification "primarily is for developers who build multitenant apps" distributed broadly with OAuth/OIDC consent from users outside the registering tenant — not a requirement for a personal single-user app the owner consents to directly. |
| 9 | openclaw (390,096 stars) has per-channel plugins (`extensions/slack`, `extensions/imap`, `extensions/google`) with a ready Slack Socket Mode manifest + scopes in `docs/channels/slack/setup.md`, directly reusable for omnis | **PARTIALLY REFUTED** | `gh repo view openclaw/openclaw`, `gh api repos/openclaw/openclaw/contents/docs/channels/slack/setup.md`, `gh api repos/openclaw/openclaw/contents/extensions/google/openclaw.plugin.json`, `gh api repos/openclaw/openclaw/contents/docs/channels` (all fetched 2026-09-20) | Star count (390,096) and the Slack setup.md manifest+scopes (`Recommended`/`Minimal` scope sets, `socket_mode_enabled: true`) are all CONFIRMED verbatim. But **`extensions/google` is not a Gmail/Calendar channel adapter** — its own manifest declares `"categories": ["google"... ["models"]]`, i.e. it's the Gemini/Vertex AI *model-provider* plugin (embeddings, image/video generation, Gemini CLI auth), unrelated to email/calendar channels. `docs/channels/` has no `gmail.md`, `google.md`, or `calendar.md` — only `googlechat.md` (a different, unrelated product) exists alongside Slack/IMAP/Discord/Telegram/etc. Correction: openclaw is a solid reference for the Slack adapter and for generic IMAP, but there is no ready-made Gmail/Calendar channel code in this repo to borrow — that part needs to be built from scratch or sourced elsewhere. |
| 10 | Slack rate limits are per-method×workspace×app buckets; non-Marketplace apps face ~15 msgs/1 req/min on `conversations.history`/`replies`, rolling out to existing installs by 2026-03-03 | **PARTIALLY REFUTED** | [Rate limits](https://docs.slack.dev/apis/web-api/rate-limits/), [Rate-limit changelog, 2025-05-29](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps) | The bucket model and the numeric limit itself are CONFIRMED ("1 request per minute," "a maximum of 15 objects per request") for non-Marketplace apps. But the "rolling out to existing installs by 2026-03-03" claim is **not supported by the primary source** — no such date appears anywhere in the changelog. Instead the changelog explicitly says the opposite: "the new rate limits will not be applied to existing installations of unlisted, distributed applications published outside the Marketplace," and gives no future date for that to change. The only dates in the source are 2025-05-29 (effective date for new apps/installs) and 2025-06-30 (ToS enforcement deadline for pre-existing apps, unrelated to this rate limit). Treat "existing installs lose their exemption on 2026-03-03" as fabricated/unverifiable and drop it from planning. |

**Three additional architecture-critical claims checked (beyond the 10 above), chosen for consequence to the recommendation:**

1. **MS Graph mail-subscription max lifetime (4,230 vs 10,080 minutes)** — see row 6. Changes the Outlook renewal-cron design from "every ~3 days" to "up to weekly."
2. **Google Calendar push domain-ownership verification requirement** — see row 7. This is the single highest-leverage correction in the file: it directly reverses the stated reason for defaulting Calendar to polling-only.
3. **openclaw `extensions/google` as a reusable Gmail/Calendar channel adapter** — see row 9. The repo does not in fact contain Gmail/Calendar channel code to borrow; only Slack and generic IMAP are usable references there.

Minor, unscored observation: the brief cites Nango as straightforwardly "오픈소스" (open source) and self-hostable. `gh api repos/NangoHQ/nango/license` returns `spdx_id: NOASSERTION`, i.e. GitHub cannot classify it under a standard OSI license — it ships a custom/"fair-source"-style license (common for VC-funded self-hostable infra, e.g. Elastic-License-style terms that restrict competing-SaaS resale but permit internal self-hosting). This likely doesn't block Logan's personal self-hosted use, but "오픈소스" is an imprecise label worth a one-line caveat if this recommendation is ever acted on. Not independently verified against the actual LICENSE file text in this session.

### Corrected recommendation

**Google Calendar**: Do not default to "push is blocked, use polling only." The brief's own cited reason — that a `*.ts.net` Tailscale Funnel domain can't pass Search-Console domain-ownership verification — is based on a Google requirement that Google's own support docs say no longer exists ("domain verification in the API Console is no longer required"). The current, documented requirement for `events.watch` push is just an HTTPS endpoint with a valid, non-self-signed, non-expired SSL certificate — which Tailscale Funnel provides out of the box via Let's Encrypt. Recommended change: run a real spike (create an `events.watch` channel pointed at the Mac mini's Funnel URL) before committing to syncToken-only polling. If the Funnel endpoint validates, Calendar can join Gmail and Slack as a genuinely real-time, outbound-only channel; polling should be the fallback, not the primary plan, and the "Calendar is second-class / can't be real-time" framing in the onboarding-UX note (§5) should be softened pending that test. Separately, the Outlook webhook renewal cadence in §3/§4 can be relaxed from "~every 3 days" to "up to weekly" per the corrected 10,080-minute Graph mail-subscription limit (row 6), lowering the operational cost of choosing Graph webhooks over delta-query polling for Outlook.
