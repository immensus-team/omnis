# 21 — GAP 2: Channel layer decision — Beeper Desktop API vs per-channel adapter

Research date: 2026-09-20. Scope: resolving the mutual contradictions between `04-beeper-matrix-bridges.md`, `06-channel-linkedin.md`, `07-channel-whatsapp-telegram.md`, `08-channel-slack-email-calendar.md`, and `90-critique.md`.

## 0. What this document did not do (stated up front)

The task was "install Beeper on the Mac mini with a free account, issue a token, and empirically measure read+send+read-receipt write-back across 7 channels." **This session did not perform that empirical measurement.** Reasons: (1) this session is a research subagent with access only to the local filesystem and the web, and has no remote execution rights on Logan's Mac mini; (2) the measurement requires performing QR scans, 2FA, and OAuth consent directly with Logan's real WhatsApp/LinkedIn/Telegram/Slack accounts, which involves handling user credentials — territory an agent cannot substitute for. Instead, this document (a) coherently reconstructs the existing primary-source verification from the 4 research files + `90-critique.md`, (b) re-verifies Beeper's official documentation as of today (rechecking the pricing-gating question and the send API details), and (c) leaves in §4 an empirical protocol Logan can run himself within 30–60 minutes. The measurement itself is carried forward as an open question (§6).

## 1. TL;DR

The Beeper Desktop API looks free (the official page says "Download for free" and marks it Public beta), but `beeper.com/pricing` is still a 404 and the FAQ never mentions the Desktop API, so whether the API itself is pay-gated cannot be settled from documentation alone. The send API (`POST /v1/chats/{chatID}/messages`) is generalized with no per-network distinction, so whether it actually works for LinkedIn/WhatsApp is not confirmed by the docs. The decisive newly confirmed fact: Beeper's LinkedIn bridge (`mautrix/linkedin`) has an unresolved bug where the session dies ~20 seconds after login (issue #55, opened 2026-05, fix PR #61 unmerged since August), and both of Beeper's own LinkedIn repos, `beeper/linkedin` and `beeper/linkedin-messaging-api`, are archived — LinkedIn is the weakest link in Beeper's portfolio. For each of omnis's 7 channels (Slack/KakaoTalk/Gmail/Outlook/Telegram/LinkedIn/WhatsApp), the answer differs by channel: WhatsApp takes Beeper as primary (same whatsmeow-family risk, saving only integration cost), Telegram and Slack exclude Beeper because each platform's official realtime channel (mtcute, Socket Mode+xoxp) is already better and safer under ToS, LinkedIn uses a resident Playwright profile for now (the Beeper path is broken upstream), KakaoTalk uses its own macOS adapter, and Gmail/Outlook are outside Beeper's scope to begin with, so 08's plan stands as-is.

## 2. Facts

**Beeper Desktop API — items re-verified today**
- `beeper.com/pricing` → HTTP 404 (reconfirmed 2026-09-20). The pricing page still does not exist. — UNVERIFIED (no change)
- The full text of `beeper.com/faq` contains no mention of "Desktop API" or "MCP" at all (reconfirmed 2026-09-20). The only related mention is "Integrations that power all of our connections are open source". — VERIFIED (absence confirmed)
- Confirmed pricing from `beeper.com/faq`: Beeper Free (free up to 5 accounts), **Beeper Plus $9.99/month** (up to 10 accounts; send-later/reminder/incognito/voice-note transcription/custom icons), **Beeper Plus Plus $49.99/month** (unlimited accounts). Of the "$30–49.99" range cited by 04, the $30 lower bound is still unconfirmed anywhere today — **Correction: only the single price point of $49.99 is confirmed.** — VERIFIED (fetched 2026-09-20)
- Text on `beeper.com/desktop-api` (marketing page, separate from the docs): **"Download for free"**, status **"Public beta"**. This means "the Beeper app itself is free", not a direct proof that "the Desktop API is not gated behind Plus", but nothing anywhere suggests pay-gating — the evidence accumulates on the free side. — VERIFIED (new confirmation, 2026-09-20)
- `developers.beeper.com/desktop-api-reference/`: there is a single send endpoint, `POST /v1/chats/{chatID}/messages`, common to all networks. Read receipts are `POST /v1/chats/{chatID}/read` and `POST /v1/chats/{chatID}/unread`. **Nowhere in the docs is there an exception clause saying "this endpoint does not work for network X"** — i.e. the "per-network send capability is undocumented" point raised by the task is still confirmed today (read/mark-as-read are generalized the same way, so the docs neither deny nor affirm that write-back scope may differ per channel). — VERIFIED (absence confirmed, 2026-09-20)
- New experimental WebSocket details (not in 04; fetched directly today): connection URL `ws://localhost:23373/v1/ws`, Bearer token auth, 4 event types (`chat.upserted`, `chat.deleted`, `message.upserted`, `message.deleted`), subscription is a single `subscriptions.set` that replaces the whole set (no incremental subscribe/unsubscribe), explicitly "experimental and may change between desktop releases", with no latency/reconnect/SLA guidance at all. — VERIFIED (fetched 2026-09-20)
- Re-query of `gh api search/repositories?q=org:beeper`: besides `beeper/linkedin` (Apache-2.0, archived 2025-03-17), **`beeper/linkedin-messaging-api` is also archived, last push 2023-12-12** (a finding not in 04) — meaning Beeper itself built LinkedIn-related repos twice and abandoned both. The only live LinkedIn path is `mautrix/linkedin`. — VERIFIED (2026-09-20, gh api)
- `beeper/cli` (TypeScript, 44 stars, last push 2026-06-04, 27 open issues) is not active but not dead either — usable as a reference CLI implementation, but do not count on it as a primary SDK. — VERIFIED (2026-09-20, gh api)

**LinkedIn bridge bug (already primary-verified in 06; decisive for this document's decision)**
- `mautrix/linkedin` issue #55 (opened 2026-05-09, status open): the `li_at` cookie is deleted ~20 seconds after login and the session dies. Presumed to be LinkedIn treating the replayed session as stolen. — CONFIRMED (primary source, `gh api repos/mautrix/linkedin/issues/55`)
- Fix PR #61 (opened 2026-08-17, status open, **unmerged**): the author himself states the measurement, "before the change, each login survived ~20 seconds". — CONFIRMED (primary source)
- In other words, **as of today (2026-09-20) this bug is unresolved**, and if Beeper uses this code as-is for its own LinkedIn bridge, LinkedIn connectivity through the Beeper Desktop API is likely inside the blast radius of the same defect (whether Beeper layered its own patch on top is UNVERIFIED — the stability of the Beeper app's own LinkedIn connection depends on Beeper's private modifications and cannot be settled by this investigation).

**WhatsApp/Telegram — substantive overlap between Beeper's internal implementation and 07's independent recommendation**
- Beeper's WhatsApp support uses a whatsmeow-family protocol (mautrix/whatsapp is whatsmeow-based, already VERIFIED in 04). That is **fundamentally the same protocol layer** as the whatsmeow sidecar that 07 independently recommended — whether you use WhatsApp through Beeper or build your own whatsmeow sidecar, the root of the ban risk (reverse-engineering WhatsApp Web multi-device) is identical. The only difference is "who maintains that code". — Logical inference in this document (combining the VERIFIED facts in each file), not new primary verification.
- Telegram is structurally similar in being MTProto-based, but Telegram has an official `api_id` issuance track (07, VERIFIED), so the risk itself is structurally lower than WhatsApp/LinkedIn — whether you go through Beeper or use mtcute directly, the risk difference is marginal; the difference is "control" and "company dependency".

## 3. Options / per-channel decision table

For each channel, decide between "use the Beeper Desktop API as primary" and "use the dedicated adapter recommended by that channel's research file". Based on omnis's 7 channels (Slack, KakaoTalk, Gmail, Outlook, Telegram, LinkedIn, WhatsApp).

| Channel | Beeper coverage | Dedicated adapter alternative (source) | **Decision** | Effort | Ban/ToS risk | Write-back scope (per docs) | Beeper exit cost |
|---|---|---|---|---|---|---|---|
| **WhatsApp** | O (whatsmeow-family internal implementation) | whatsmeow Go sidecar (07) | **Adopt Beeper as primary** — same protocol, so no added risk while integration cost drops to S; as a bonus Instagram/Signal/Discord/X come along free with the same integration | S (Beeper) / M (self-built) | Medium, gray area (reverse-engineering WhatsApp Web is itself the root of the risk, whoever writes the code) | Docs say generic send+read/unread; unlike LinkedIn there is no known blocking bug → relatively trustworthy, but UNVERIFIED-EMPIRICAL until measured | M — the session is device-linked and held by Beeper, so exiting requires re-pairing (QR rescan); the code itself can move to whatsmeow unchanged |
| **Telegram** | O (presumed MTProto-family) | mtcute native TS (07) | **Adopt mtcute independently, exclude Beeper** — Telegram already has an official `api_id` track, making it the safest channel under ToS, so there is no reason to add a company dependency (Beeper) on top. mtcute is S–M effort, has SQLite sessions built in, and is pure TS, plugging straight into the omnis stack | S–M | Low (as concluded in 07) | Because mtcute is implemented directly, read/send/markAsRead are all 100% under our control and verifiable | N/A (never adopted) |
| **LinkedIn** | O, but **effectively unstable due to an upstream bug** (mautrix/linkedin #55, unresolved for 6+ months) | Resident Playwright profile (06) | **Adopt Playwright independently, exclude Beeper (for now)** — omnis's most sensitive channel (job search and business communication) cannot be built on a 20-second-session-death bug that has gone unfixed for 6 months. Revisit once #55/#61 merge and Beeper confirms real-world stability | M | Medium (as concluded in 06; directly controllable) | Planned to implement read+send fully via 06's draft-then-approve pattern; read receipts are a feature LinkedIn shows only to the counterpart, so separate verification is needed (not investigated) | N/A (never adopted) |
| **Slack** | O (generic) | Socket Mode + xoxp user token (08) | **Adopt Socket Mode+xoxp independently, exclude Beeper** — Slack already has a fully documented official realtime channel (Socket Mode), and openclaw's manifest can be reused as-is (S effort). It allows finer-grained scope control (`search:read` etc.) than Beeper's generic chat abstraction, making it safer overall | S | Low (as concluded in 08; delegating a user token is normal OAuth) | Because Socket Mode is implemented directly, read/send/mark-read are all directly verifiable | N/A (never adopted) |
| **KakaoTalk** | X (officially unsupported; community bridges are unmaintained + have suspension reports) | macOS Accessibility/local DB adapter (04) | **Own adapter, no alternative** | M | Low (stock official client, read-first) | read first, send as a later phase | N/A |
| **Gmail** | X (outside Beeper's scope — chat only) | watch()+Pub/Sub pull (08) | **08's plan as-is, unrelated to this gap** | M | Low | read/send/markRead all standard Gmail API | N/A |
| **Outlook** | X | Graph API delta/webhook (08) | **08's plan as-is, unrelated to this gap** | S→M | Low | Same | N/A |

**Summary**: Of the 7 channels, only 4 overlap with Beeper (WhatsApp/Telegram/LinkedIn/Slack), and of those, only **WhatsApp** actually uses Beeper. The other 3 either have a platform official/semi-official realtime channel that is already better than Beeper (Telegram/Slack), or Beeper's own implementation is broken (LinkedIn). The big picture 04 painted — "Beeper covers 6 channels at S effort" — is not wrong, but within omnis's 7-channel scope the real gain narrows to WhatsApp alone (plus Instagram/Signal/Discord/X as a bonus).

## 4. Recommendation for omnis

**Adopt: a hybrid per-channel layer.** The premise of unifying on a single layer was itself wrong — Beeper is "one vendor with broad coverage", not "the best implementation of every channel". Choose separately per channel based on (a) whether an official/semi-official realtime API exists, and (b) whether Beeper's bridge for that channel is stable right now.

- **WhatsApp = Beeper**. The rationale is as laid out in §3: no risk difference, only integration cost saved. However, **the documentation does not confirm per-network send capability (unchanged on today's recheck)**, so before adopting, verify with the spike test in §5 that send actually works, within 30 minutes. If it does not, fall back immediately to 07's whatsmeow sidecar — the code assets (protocol layer) are the same, so the switching cost is low.
- **Telegram = standalone mtcute implementation**. Inserting Beeper is a net negative (adds a company dependency, gains nothing).
- **LinkedIn = resident Playwright profile (06 as-is)**. The Beeper path is excluded for now — re-evaluate after `mautrix/linkedin#55` merges and stability has been confirmed for at least 4 weeks (hang this on the calendar as an open question).
- **Slack = Socket Mode+xoxp (08 as-is)**.
- **KakaoTalk/Gmail/Outlook**: unrelated to this gap; proceed with the plans in the existing files as-is.

**Effort total**: Beeper integration (WhatsApp only, S) + mtcute (S–M) + Playwright (M) + Socket Mode (S) + Kakao adapter (M) + Gmail (M) + Outlook (S→M) ≈ total effort grows versus the earlier assumption that "Beeper solves everything" (since it keeps almost all of what the 4 files each recommended), but each channel's risk and control actually improve. The core gain of this hybrid is avoiding the "single point of failure + single company dependency" scenario of piling 4 channels onto Beeper alone.

**Risk**: WhatsApp (via Beeper) is a ToS gray area (Medium, the risk common to the whatsmeow family) — using Beeper or not does not make this risk go away. LinkedIn is Medium even when self-implemented (06 as-is). The rest are Low.

## 5. What to borrow

- **Beeper's `X-Forwarded-*`-based Remote Access pattern** (already confirmed in 04) — even with only the WhatsApp channel integrated through Beeper, this Tailscale-friendly exposure approach is still worth reusing as-is.
- **Beeper WebSocket's 4-event model** (`chat.upserted/deleted`, `message.upserted/deleted`) — use it as a reference line for the minimal event set when designing omnis's internal common `InboxEvent` type (it matches exactly the common adapter interface `connect/onEvent/sendMessage/markRead` already proposed in 07).
- **`subscriptions.set`'s replace-only subscription model** — there is a simplicity gain in not having to write incremental subscription management code. For omnis's own event bus too, "the subscription list is fully replaced every time" may be a practical choice that reduces state-management bugs (a simplification worth borrowing).
- **06's draft-then-approve pattern** — apply as-is when building LinkedIn directly without Beeper.
- **openclaw Slack manifest** (already confirmed in 08) — the starting point for the Socket Mode+xoxp implementation.

## 6. Open questions

- **Whether actual send on WhatsApp/LinkedIn works through the Beeper Desktop API** — could not be confirmed from documentation after all (same today). A question that closes only when Logan runs the spike test in §4 himself.
- **Whether Beeper's LinkedIn connection is affected by the `mautrix/linkedin#55` bug** — undetermined, since the Beeper app may have layered its own patch on top. Needs direct confirmation by attempting login with a real account and checking whether the session survives past 20 seconds.
- **Whether the Desktop API is gated behind Plus/Plus Plus** — the "Download for free" wording on `beeper.com/desktop-api` may refer to downloading the app, which could be separate from gating of the API itself. Closes only by actually attempting to issue a token with a free account.
- **Whether the experimental WebSocket meets G1 (5-second target) latency** — the docs contain no numbers at all, so there is no answer short of measurement.
- **Whether LinkedIn read-receipt (read indicator visible to the counterpart) write-back is even a conceivable thing on the LinkedIn platform** — neither 06 nor this document investigated it; LinkedIn's own UX needs rechecking.

## 7. Sources

- [beeper.com/pricing](https://www.beeper.com/pricing) — HTTP 404, fetched 2026-09-20
- [beeper.com/faq](https://www.beeper.com/faq) — fetched 2026-09-20
- [beeper.com/desktop-api](https://www.beeper.com/desktop-api) — fetched 2026-09-20
- [developers.beeper.com/desktop-api/](https://developers.beeper.com/desktop-api/) — fetched 2026-09-20
- [developers.beeper.com/desktop-api-reference/](https://developers.beeper.com/desktop-api-reference/) — fetched 2026-09-20
- [developers.beeper.com/desktop-api/mcp/](https://developers.beeper.com/desktop-api/mcp/) — fetched 2026-09-20
- [developers.beeper.com/desktop-api/websocket-experimental](https://developers.beeper.com/desktop-api/websocket-experimental) — fetched 2026-09-20
- `gh api search/repositories?q=org:beeper` — fetched 2026-09-20
- `gh api repos/beeper/cli` — fetched 2026-09-20
- `gh api repos/mautrix/linkedin/issues/55`, `gh api repos/mautrix/linkedin/pulls/61` — original source is the 2026-09-20 verification in `06-channel-linkedin.md`; re-cited here
- Underlying research (the originals this document synthesizes and reconstructs): `research/04-beeper-matrix-bridges.md`, `research/06-channel-linkedin.md`, `research/07-channel-whatsapp-telegram.md`, `research/08-channel-slack-email-calendar.md`, `research/90-critique.md` (all written 2026-09-20)
