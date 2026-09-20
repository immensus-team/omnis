# Kinso Tear-down + Competitor Landscape (2026-09-20 research)

## 1. TL;DR

Kinso is a waitlist-stage unified inbox built by the brothers Frank/Jacques Greeff (with a $180M exit behind them); it merges Gmail, Slack, LinkedIn, WhatsApp, and Instagram into a single timeline and offers a morning briefing, tone-matched AI drafts, universal search, and a cross-channel "contextual assistant" (automatic linking of related conversations). The official page lists no pricing (the pricing subpage 404s), and the prices quoted by third-party blogs ($29–59/month) contradict each other, so all of them are UNVERIFIED. The capture mechanism for channels without APIs (WhatsApp/LinkedIn) has not been officially disclosed — omnis's Mac mini hub approach (Accessibility automation) is effectively the only proven precedent in the field. Among competitors, Beeper (Automattic, merged with Texts) has the best channel coverage, Shortwave/Superhuman have the most mature AI draft UX, and Unipile is the commercial reference for WhatsApp/LinkedIn API-less capture. omnis should reference kinso's layout/tone but design its own pricing and architecture.

## 2. Facts

**Kinso the product**
- Kinso positions itself with "One inbox, every conversation" and integrates Gmail (explicitly), WhatsApp, Slack, and LinkedIn. VERIFIED — [kinso.ai](https://www.kinso.ai/) (2026-09-20 fetch).
- Third-party articles additionally mention Instagram and TikTok. UNVERIFIED (not on the official page) — [thisandthat.chat review](https://www.thisandthat.chat/blog/kinso-review/), [Grit Daily](https://gritdaily.com/hunt-for-unified-box-why-kinso-may-finally-nail-it/) (2026-09-20 fetch).
- Four core features: DRAFT RESPONSE (tone-matched automatic replies), morning briefing (summary of important messages and action items), UNIVERSAL SEARCH (natural-language search across all channels), CONTEXTUAL ASSISTANT (automatic linking of related conversations across channels). VERIFIED — [kinso.ai](https://www.kinso.ai/).
- Third-party sources additionally mention "Smart Contacts" (per-contact summarized history across all channels), a voice interface (hands-free briefings/replies), and "opportunity stack" ranking (ordered by business impact rather than arrival time). UNVERIFIED — [thisandthat.chat](https://www.thisandthat.chat/blog/kinso-review/), [VentureBeat](https://venturebeat.com/business/cracking-the-universal-inbox-inside-kinsos-quest-to-make-cross-channel-ai) (2026-09-20 fetch).
- Founders Frank/Jacques Greeff had a $180M exit at their previous company (believed to be Realbase; the articles do not name the company). Kinso started on self-funded/angel pre-seed money; the exact round size is undisclosed. VERIFIED (founder background) / UNVERIFIED (exact funding amount) — [Grit Daily](https://gritdaily.com/hunt-for-unified-box-why-kinso-may-finally-nail-it/), [WebSearch summary](https://www.linkedin.com/in/jacques-greeff/) (2026-09-20 fetch).
- As of 2025-09-25 it was at the waitlist stage with 11,000–23,000 people waiting (the number differs by source). UNVERIFIED — [Medium](https://medium.com/@theventurecation/over-11-000-waitlist-for-one-universal-inbox-the-hype-behind-100m-ai-platform-kinso-06afb108365b), [thisandthat.chat](https://www.thisandthat.chat/blog/kinso-review/).
- Pricing: kinso.ai/pricing 404s. The figures in third-party blogs contradict each other — one claims "$59/month, unlimited email + messenger connections" (attributed to the founder), another claims "$35/month, or $29/month billed annually, 3,000 credits, 30 days free". Neither figure is confirmed by a primary source, and they describe different billing models (subscription vs. credits), so confidence is low. UNVERIFIED, CONFLICTING — [thisandthat.chat pricing](https://www.thisandthat.chat/blog/kinso-pricing/), [WebSearch summary](https://useconverge.app/pricing/kinso) (2026-09-20 fetch).
- Whether it has platforms (Mac/iOS/Web) cannot be confirmed from primary sources. Searches turned up only a separate waitlist page at `kinso-site.webflow.io` and an Instagram account (@kinso.app) — no evidence of a native app. UNVERIFIED — WebSearch (2026-09-20).
- No source describes the capture mechanism for API-less channels (WhatsApp, LinkedIn) in any detail (they only say "native APIs"; whether it is a QR session or an unofficial protocol is unknown). UNVERIFIED — [thisandthat.chat](https://www.thisandthat.chat/blog/kinso-review/).
- Visual design: text extraction from the primary page did not yield layout/typography/color/motion details (the landing page is mostly marketing copy). A screenshot-based hands-on analysis is needed — UNVERIFIED as of this text fetch. Browser screenshots are required as follow-up work.

**Competitors (as of 2026-09-20, WebSearch summaries — no direct fetch of each company's official page was performed; most were cross-checked against third-party pricing blogs)**
- Superhuman: Starter $30/month, Business $40/month, Enterprise priced separately. AI Replies/Summarize/Auto Labels/Instant Reply, Gmail + Outlook. VERIFIED-ish (consistent across multiple sources) — [Morgen](https://www.morgen.so/blog-posts/superhuman-pricing), [Capterra](https://www.capterra.com/p/199278/Superhuman/) (2026-09-20).
- Shortwave: Business $24/seat, Premier $36, Max $100 (per month, billed annually). Gmail/Google Workspace only, no Outlook support. VERIFIED-ish — [faraday.email](https://faraday.email/blog/shortwave-pricing-2026), [get-alfred.ai](https://get-alfred.ai/blog/shortwave-pricing) (2026-09-20).
- Notion Mail: auto-label/tone draft/scheduling via Notion AI, Gmail only. **The standalone Notion Mail (web/desktop/iOS) service is scheduled to shut down on 2026-09-22** — a cautionary tale for omnis's design (platform-coupling risk). VERIFIED — [original TechCrunch announcement](https://techcrunch.com/2025/04/15/notion-releases-its-ai-driven-email-inbox), [Wysor](https://wysor.io/alternatives/notion-mail) (2026-09-20).
- Unipile: integrates LinkedIn/WhatsApp/Instagram/Telegram/Email (Gmail, Outlook, IMAP) + calendar behind a single REST API. QR authentication, no Meta partnership required. Pricing €49/month (up to 10 accounts) + €3–5/month per account. LinkedIn is unofficial (account-suspension risk stated). VERIFIED — [unipile.com/pricing-api](https://www.unipile.com/pricing-api/) (2026-09-20).
- Beeper (Automattic, merged with ex-Texts.com): Automattic acquired Beeper for $125M (2024) and Texts.com for $50M (2023); after the 2025 merger it was "99% integrated" as of 2026. Supports WhatsApp/Instagram/Messenger/X/Telegram/Signal/Matrix/Slack/Google Chat/Discord/LinkedIn/Google Messages. Relaunched with an on-device model, free + premium (more accounts, reminders, scheduled sending, incognito, AI transcription of voice memos). VERIFIED — [TechCrunch](https://techcrunch.com/2025/07/16/beepers-all-in-one-messaging-app-relaunches-with-an-on-device-model-and-premium-upgrades/), [Wikipedia](https://en.wikipedia.org/wiki/Beeper_(software)) (2026-09-20).
- Missive: Starter $14, Productive $24, Business $36/user/month (annual). Email + SMS + social, real-time two-way sync, comments/shared drafts on every tier. VERIFIED-ish — [missiveapp.com comparison](https://missiveapp.com/compare/frontapp-vs-missive) (2026-09-20).
- Front: Starter $25, Professional $65, Enterprise $105/seat/month. A full set of ticketing + knowledge base + voice + AI; closer to a customer-operations platform (a team helpdesk rather than a personal inbox). VERIFIED-ish — [hiverhq.com](https://hiverhq.com/blog/front-vs-missive) (2026-09-20).
- Spike: chat-style email UI bundled with notes/video calls/custom-domain email. Aimed at small teams. UNVERIFIED (pricing unconfirmed) — [get-alfred.ai](https://get-alfred.ai/blog/best-spike-alternatives) (2026-09-20).
- 2025-2026 "AI assistant/unified inbox" newcomers: Upstream (pre-seed $3M, reframes email as a human + agent collaboration workspace), alfred_ (all-in-one triage + calendar + task + daily brief), Fambot (an AI chief of staff for the household). UNVERIFIED (details beyond the funding figure unconfirmed) — [MediaPost](https://www.mediapost.com/publications/article/415633/meet-me-in-the-inbox-startup-says-it-can-unite-ai-email-in-one-place.html), [TechCrunch](https://techcrunch.com/2026/09/01/fambot-introduces-an-ai-chief-of-staff-for-families/) (2026-09-20).

**API-less channel capture references directly relevant to omnis (GitHub, existence confirmed via `gh repo view`)**
- [`silver-flight-group/kakaocli`](https://github.com/silver-flight-group/kakaocli) — ★153. Reads the local KakaoTalk DB and sends via UI automation using the macOS Accessibility API. JSON output for AI agents, MCP skill definitions, webhooks. No server login / protocol reverse engineering. Updated 2026-09-18, active. VERIFIED (repo existence and metadata).
- [`JungHoonGhae/openkakao-cli`](https://github.com/JungHoonGhae/openkakao-cli) — ★123. "Server login broke in recent builds" → works around it via local-send/ax-read (reading the Accessibility tree). Pushed 2026-09-03. VERIFIED.
- [`twoimo/openkakao-bot`](https://github.com/twoimo/openkakao-bot) — ★0 (new). Drafts replies from local DB context plus a preferred LLM, on-device only (claims credentials never leave the machine). Pushed 2026-09-19; very new, unvetted code. VERIFIED (existence) / UNVERIFIED (stability).
- [`block/buzz`](https://github.com/block/buzz) — ★33,695, "A hive mind communication platform", updated 2026-09-19. A multi-agent communication layer pushed by Block (formerly Square), and a reference Logan called out directly in the brief. VERIFIED — use it as an architecture reference for omnis's "agent session = inbox thread" design.

## 3. Comparison table

| Axis | Kinso | Superhuman | Shortwave | Notion Mail | Beeper (Automattic) | Unipile | Missive/Front | Implication for omnis |
|---|---|---|---|---|---|---|---|---|
| Channel breadth | Gmail+Slack+LinkedIn+WhatsApp (IG claimed) | Gmail/Outlook only | Gmail only | Gmail only | 12+ messengers (broadest) | LinkedIn/WhatsApp/IG/Telegram/Email (API layer) | Email+SMS+social (for teams) | Beeper and Unipile are the strongest in practice on channel breadth |
| AI draft maturity | Claims only, UX unverified | Best in class (years of refinement) | High (tiered quotas) | Low (criticized as "generic") | Low (mostly capture/routing) | None (an API layer, so no UI) | Low to medium | Benchmark Superhuman/Shortwave's draft UX |
| API-less capture | Mechanism undisclosed | N/A | N/A | N/A | In-house bridge (reverse-engineers many protocols; has a history of account suspensions) | Commercial API, QR session, LinkedIn unofficial (ToS risk stated) | N/A | Always-on Mac mini + kakaocli-style Accessibility automation is the most realistic path |
| Platforms | Unknown (only a web waitlist page confirmed) | Mac/Win/iOS/Android/Web | Web/Mac/iOS/Android | Web/Desktop/iOS (shutting down 9/22) | Mac/Win/iOS/Android/Web | API only (no UI of its own) | Web/Mac/Win/iOS | omnis needs a Mac app + iOS; web can be lower priority |
| Pricing model | Unknown/contradictory | $30–40/month subscription | $24–100/month subscription | Included in the Notion plan (discontinued) | Free + premium | Usage-based per account (€3–5) | $14–105 per seat | For a solo founder, usage-based pricing (Unipile-style) is better for budget control |
| ToS/account-suspension risk | Unknown | Low (official API) | Low (official API) | Low (official API) | Yes (past WhatsApp/iMessage bridge issues) | Yes (LinkedIn explicitly unofficial) | Low | KakaoTalk/LinkedIn automation inevitably means designing around accepted risk |

## 4. Recommendation for omnis

**Channel capture architecture**: For channels that have official APIs (Gmail, Outlook, Slack, Telegram, Google Calendar), integrate each through its official API — effort **S**, risk low. For WhatsApp you must weigh the Meta Business API (limited, effort **M**, risk medium with policy-change exposure) against an unofficial option such as whatsapp-web.js (effort S, risk high with ban exposure); for a single personal account, the unofficial route is the realistic one. KakaoTalk and LinkedIn either have no API at all (Kakao) or exist only unofficially (LinkedIn), so as Logan's brief says, there is no choice but to go with a **resident app on the Mac mini + Accessibility automation** — effort **M** (fork kakaocli or implement it directly for KakaoTalk), risk **high** (possible ToS violation; hard to recover from an account suspension; and because Kakao is a domestic service, policy changes are hard to predict). This risk must be stated explicitly to Logan before proceeding.

**AI draft/briefing UX**: Adopt kinso's three-part set — "tone-matched drafts + morning briefing + contextual linking" — as the target feature set as-is, but use Superhuman (Instant Reply, Split Inbox) and Shortwave (tiered AI quotas, bundle cleanup) as implementation-detail references for UX polish. effort **M**, risk low (pure product work).

**Agent session = inbox thread design**: Read `block/buzz` (★33.7k, hive-mind communication platform) first as an architecture spike — the melody for treating Claude Code/Codex/DeepSeek/Hermes sessions like inbox threads is already there. Before implementing anything in omnis itself, grep buzz's message schema and session-bridge patterns to identify what is reusable first (message protocol, session handoff). effort **S** (research) → **M** (integration).

**Pricing/positioning**: kinso's pricing is not trustworthy, so do not use it as a benchmark. omnis is a single-user product, so it needs no pricing design at all — instead, apply Unipile's "usage-based per account" mindset to infrastructure cost management (which channels, how many accounts connected) and track OpenRouter/Gateway token costs, which is more meaningful.

**The lesson from Notion Mail**: Even a large platform (Notion) shut down its email client within six months — a direct cautionary tale that omnis must avoid single-vendor lock-in (Gmail-only, dependence on a specific SDK) and design its channel adapters to be swappable.

## 5. What to borrow

- **Layout/copy tone**: kinso.ai's homepage pattern of labeling feature names in uppercase ("DRAFT RESPONSE", "UNIVERSAL SEARCH", "CONTEXTUAL ASSISTANT") — omnis can borrow this naming convention for landing/onboarding copy. However, the actual visuals (layout grid, type scale, motion) could not be confirmed through this text fetch, so screenshot-based re-research is needed (as a next step, visiting kinso.ai with `mcp__Claude_Browser` or `claude-in-chrome` to measure it directly is recommended).
- **Agent-session-as-inbox-thread architecture**: Clone the `block/buzz` (https://github.com/block/buzz) codebase, index the message routing/session handoff schema with GitNexus, and extract reusable patterns.
- **Starting point for KakaoTalk capture implementation**: Fork and compare `silver-flight-group/kakaocli` (local DB reads + AX automation, includes MCP skill definitions, and JSON output that plugs straight into omnis's agent pipeline) alongside `JungHoonGhae/openkakao-cli` (an alternative path with no server login), then adopt whichever is more stable as the Mac mini resident process.
- **WhatsApp/LinkedIn/Telegram integration layer**: Rather than reverse-engineering unofficial protocols yourself, consider adopting the Unipile API (from €49/month) as the primary option — you pay a monthly fixed cost instead of spending development effort, and the ToS risk shifts to Unipile (though LinkedIn is still unofficial, so the risk is not entirely eliminated).
- **Beeper's on-device relaunch direction**: An architecture that bridges locally without sending credentials/messages to the cloud — it aligns philosophically with omnis's "Mac mini hub, iPhone/MacBook clients" structure, so use Beeper's release notes/blog (the TechCrunch article link) as a reference for privacy design.
- **Notion Mail's view/DB metaphor**: Treating email as views over a Notion database (labels, filters, project links) remains valid as a pattern even after the service shut down — reference the view concept when designing omnis's automatic work/personal filter and topic-based auto-labeling.

## 6. Open questions

- kinso.ai's actual visual design (layout/typography/motion) cannot be confirmed from a text fetch — a separate screenshot-based hands-on review is required.
- It has not been officially confirmed whether kinso's API-less channel capture is a Beeper-style protocol bridge, a WhatsApp Business API reseller, or a QR session (Unipile-style).
- There is insufficient data on real account-suspension cases from Kakao/LinkedIn Accessibility automation (frequency, trigger conditions) — the `kakaocli`/`openkakao-cli` issue trackers need to be searched for actual user reports.
- If Unipile is used, KakaoTalk is still not covered (KakaoTalk is not in Unipile's list) — a decision is needed on whether to run KakaoTalk as a separate track or implement everything in-house.
- In the "standalone without a Mac mini" future scenario omnis is aiming for, whether Accessibility-automation-based capture can technically be sustained (it is impossible on an iPhone alone) needs separate review.

## 7. Sources

- https://www.kinso.ai/ (2026-09-20)
- https://www.thisandthat.chat/blog/kinso-review/ (2026-09-20)
- https://www.thisandthat.chat/blog/kinso-pricing/ (2026-09-20)
- https://venturebeat.com/business/cracking-the-universal-inbox-inside-kinsos-quest-to-make-cross-channel-ai (2026-09-20)
- https://gritdaily.com/hunt-for-unified-box-why-kinso-may-finally-nail-it/ (2026-09-20)
- https://medium.com/@theventurecation/over-11-000-waitlist-for-one-universal-inbox-the-hype-behind-100m-ai-platform-kinso-06afb108365b (2026-09-20)
- https://useconverge.app/pricing/kinso (2026-09-20)
- https://www.linkedin.com/in/jacques-greeff/ (2026-09-20)
- https://www.morgen.so/blog-posts/superhuman-pricing (2026-09-20)
- https://www.capterra.com/p/199278/Superhuman/ (2026-09-20)
- https://faraday.email/blog/shortwave-pricing-2026 (2026-09-20)
- https://get-alfred.ai/blog/shortwave-pricing (2026-09-20)
- https://techcrunch.com/2025/04/15/notion-releases-its-ai-driven-email-inbox (2026-09-20)
- https://wysor.io/alternatives/notion-mail (2026-09-20)
- https://www.unipile.com/pricing-api/ (2026-09-20)
- https://techcrunch.com/2025/07/16/beepers-all-in-one-messaging-app-relaunches-with-an-on-device-model-and-premium-upgrades/ (2026-09-20)
- https://en.wikipedia.org/wiki/Beeper_(software) (2026-09-20)
- https://missiveapp.com/compare/frontapp-vs-missive (2026-09-20)
- https://hiverhq.com/blog/front-vs-missive (2026-09-20)
- https://get-alfred.ai/blog/best-spike-alternatives (2026-09-20)
- https://www.mediapost.com/publications/article/415633/meet-me-in-the-inbox-startup-says-it-can-unite-ai-email-in-one-place.html (2026-09-20)
- https://techcrunch.com/2026/09/01/fambot-introduces-an-ai-chief-of-staff-for-families/ (2026-09-20)
- https://github.com/silver-flight-group/kakaocli (2026-09-20, verified via `gh repo view`)
- https://github.com/JungHoonGhae/openkakao-cli (2026-09-20, verified via `gh repo view`)
- https://github.com/twoimo/openkakao-bot (2026-09-20, verified via `gh repo view`)
- https://github.com/block/buzz (2026-09-20, verified via `gh repo view`, ★33,695)
