# 90 — Completeness critique of the omnis research sweep

Reviewed 2026-09-20: `BRIEF-2026-09-20.md`, `01-definition-draft.md`, and all 18 files in `research/`.
Own verification this pass: `gh api` on block/buzz, google/artemis, NousResearch/hermes-agent, openclaw/openclaw, vercel/eve, vercel/workflow, channprj/kmsg, cloudflare/agentic-inbox, langchain-ai/agent-inbox, rocicorp/mono; `gh search repos` for "unified inbox" and "agent inbox"; WebFetch of kinso.ai, eve.dev/docs/deployment, eve.dev/docs/deployment/self-hosting, developers.beeper.com/desktop-api/, beeper.com/pricing (404), modelcontextprotocol.io/specification/versioning, cs.kakao.com, github.com/trending. WebSearch budget was already exhausted session-wide (200/200) before this pass — every Korean-language and pricing question needing search stays open.

The sweep is strong on per-channel feasibility and licence/metadata hygiene. It is weak exactly where decisions get made: nobody reconciled the channel-layer recommendations against each other, nobody read a line of source code, nobody looked at kinso's actual UI, and the build process Logan asked for is unresearched.

## 1. Gap table

| # | Gap | Where it should have been | Severity | Blocks |
|---|---|---|---|---|
| 1 | Vercel Eve was rejected on a premise that is false. `11` says Eve "assumes serverless/Vercel deploy target" and leaves "can Workflow self-host?" open. eve.dev/docs/deployment: "Deploy eve to Vercel or run it as a Node service on your own infrastructure"; self-hosting page: run eve's Nitro server, "The default local Workflow world stores run state under `.eve/.workflow-data`", Nitro's schedule runner, channels at `/eve/`. | 11 | High | §10.4 harness |
| 2 | No file reconciles the four overlapping channel-stack recommendations (Beeper API vs Playwright vs whatsmeow/mtcute vs Socket Mode). Beeper covers 6 of 7 channels at S effort and would delete most of 06/07; its per-network send limits are undocumented and `beeper.com/pricing` 404s. | 04/06/07/08 | High | §10.1, Phase A/C scope |
| 3 | Zero source code read in the entire sweep — all 18 files stop at README/docs. `02` §6 and `17` §4 both say to clone block/buzz first; nobody did. My `gh search` surfaced cloudflare/agentic-inbox (Apache-2.0, ★7,942, auto-draft-on-inbound + explicit confirm before send) and langchain-ai/agent-inbox (MIT, ★1,092) — neither appears in any file. | 02/09/17 | High | L0 schema, approval UX |
| 4 | kinso's actual UI is unexamined. `01` §6 and `14` §7 both flag it; nobody used the browser/screenshot modality that is installed. My re-fetch: still marketing text, no pricing, no platform statement. Design tokens in `14` §6 come from Linear/Raycast, not kinso. | 01/14 | High | L4, Logan's stated reference |
| 5 | The build process itself is unresearched: ralph-loop with Opus/Sonnet/Haiku/DeepSeek, task decomposition, verification gates, dev-time token budget, worktree isolation. `12` budgets runtime inference only. | (missing) | High | Execution after planning |
| 6 | Standalone/hub-less (G6) rests on an unverified keystone. `15` §4 says hub-less is impossible while Kakao/LinkedIn lack APIs; `05`'s "1 mobile + 1 PC slot" rule — which excludes the emulator route — is UNVERIFIED and could not be confirmed this pass. | 05/13/15 | High | G6, Phase D |
| 7 | Memory ingestion from local files / Drive / GitHub — named in the brief — has no research. `10` covers stores, not connectors, chunking, incremental sync, backfill volume, embedding host, or a retrieval eval set. | 10 | Med-High | §10.3, L2 |
| 8 | Nobody sized event volume. `09` puts every Codex `item` event in the inbox schema; `13` syncs that schema to two clients with a 2s target. No events/sec or row estimate. | 09/13 | Med-High | §10.5 sync engine |
| 9 | Minor but open: no prompt-injection test set exists though G8 is judged by one (`15`); write-back fidelity per channel (G2) is never enumerated; no onboarding/auth flow design despite Nango being recommended (`08`). | 08/15 | Med | G2, G8 |

## 2. Contradictions

1. **Kinso price.** `07` and `14` state "$59/month" as VERIFIED; `01` marks pricing UNVERIFIED and CONFLICTING ($29/$35/$59, subscription vs credits). My fetch of kinso.ai found no price anywhere. `01` is right — delete the $59 figure.
2. **WhatsApp library.** `07` §4 rejects whatsapp-web.js (Chromium weight, more detection signal) for whatsmeow; `15` §3 picks whatsapp-web.js as *lower* ban risk. Opposite conclusions, neither quantified.
3. **Who owns the channel layer.** `04` makes Beeper primary for WhatsApp/Telegram/LinkedIn/Slack/Signal/Discord; `06`/`07`/`08` each build the same channels independently. Both cannot be the plan.
4. **Greenfield vs Hermes.** `01-definition-draft` §8/§10 (edited today) says omnis replaces the mini's Hermes/omh/buzz setup and does not share Hermes memory. The brief requires Hermes sessions on both machines to be reachable *from* omnis, and `09` §4 builds the agent bridge on Hermes's `api_server` while `11` §5 reuses its `write_approval` gates. "Replace Hermes" and "Hermes is one of four inbox agents" need reconciling.
5. **Eve.** `11`'s rejection premise is refuted by eve.dev's own deployment docs (see gap 1).
6. **Calendar realtime.** `08` §3/§4 default to syncToken polling because push needs Search Console domain verification; `08`'s own verification quotes Google saying that verification "is no longer required." The recommendation table was never updated.
7. **iPhone client.** `13` §4 picks an installed PWA for MVP while its own table rates PWA Apple-native feel "Low" — against the brief and `14`. Separately `13` calls Tailscale Serve's iOS SSL bug the biggest risk, then its verification finds the issue has 5 comments blaming a third-party DoH app.
8. **MCP version.** `09`'s body cites spec 2025-11-25; the versioning page (fetched today) says current is **2026-07-28** with mandatory `server/discover` and `_meta` negotiation. `15`'s MCP-security guidance is written against the superseded handshake model.
9. **Where Tier-0 local inference runs.** `12` says the M4 16GB mini cannot run MLX-accelerated models (32GB+ needed) so classification belongs on the M5 MacBook — but `13`/`18` make the mini the always-on hub and the MacBook an intermittent client. "Free local classification" currently has no always-on host.
10. **Notification Center DB.** `05` §3 rates it "Nearly none" risk, trigger-only; its own verification shows the DB held full plaintext content and is now FDA-gated. Table not corrected.

## 3. Modalities never used

Source code (0 repos cloned), browser screenshots (0), GitHub search/trending as a discovery tool (`16` cites trending but used it only for README style — my two searches found two on-topic repos the sweep missed), Korean-language primary sources for Kakao's own device/automation policy (community posts only; `cs.kakao.com` was never fetched, and the one page `05` cites doesn't contain the claim), and any pricing page for Beeper (404) or Qwen/GLM/Kimi/MiniMax/OpenAI direct (`12` §6 admits this).

## 4. Logan's explicit asks — coverage

Kinso fidelity: **weak** (names only, no visuals). Buzz: **partial** (docs read, source not). Artemis: **answered** (Android-only, correctly rejected; the open question "is this what Logan meant?" still needs him). Vercel Eve: **wrong answer** (gap 1). Ralph-loop mixed-model dev: **absent**. "Kernel": **asserted** in `01` §4 but no research on event-log/scheduler/approval-gate implementations beyond `11`'s one paragraph. Standalone: **contradicted** (gap 6). Cost: **runtime only**, dev cost and measured token counts missing.
