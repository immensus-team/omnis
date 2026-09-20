# "Google Artemis" (2026) — Identity Check and Implications for omnis's Mobile Strategy

Fetched 2026-09-20.

## 1. TL;DR

"Google Artemis" is an **open-source Android UI automation framework** (github.com/google/artemis, Apache 2.0, released 2026-09-10). It was built by Google's Pixel Test Engineering Fusion team and turns natural-language instructions into real phone manipulation, scoring 99%+ on the AndroidWorld benchmark. It attaches to Antigravity, Claude Code, Codex, and Cursor as an MCP server, for the purpose of "manipulating a physical Android phone from an IDE chat window." It is a **QA/test automation tool**, not a consumer "everything is an inbox" app, and it is **Android-only** (iOS is a roadmap item only, not implemented). It is a different project from the Gemini I/O announcement Logan mentioned (Gemini Intelligence on Android, 2026-05). Little of it transfers directly to omnis, but the MCP-based "natural language → device manipulation" pattern and the Flash/Pro dual-profile structure are worth referencing for future KakaoTalk capture (Mac mini) automation design. With no iOS support, it does not directly fit the iPhone client goal.

## 2. Facts

- **VERIFIED** — `google/artemis` is a public GitHub repository, Apache-2.0 licensed, Python-based, 8,111 stars, created 2026-08-13, last pushed 2026-09-12. Source: https://github.com/google/artemis (fetched 2026-09-20, via `gh repo view`)
- **VERIFIED** — README description: "ARTEMIS turns natural-language instructions into reliable Android automation... integrates seamlessly with AI coding assistants such as Antigravity, Codex, and Claude Code... 99%+ success rate on AndroidWorld Benchmark." Source: `gh api repos/google/artemis/readme` (fetched 2026-09-20)
- **VERIFIED** — Builder/release date: Google's **Pixel Test Engineering Fusion team** open-sourced it on 2026-09-10. Source: https://alphasignal.ai/news/google-s-artemis-hits-99-on-android-tasks-where-most-agents-fail (fetched 2026-09-20)
- **VERIFIED** — Platform: **Android-only**. The README roadmap lists "iOS Platform Expansion: Extending multimodal perception and mobile automation to iOS devices and simulators" as an incomplete item → iOS is currently unsupported. Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — Integration method: provides a **native Model Context Protocol (MCP) server**. Installable on Antigravity, Claude Code, Codex, Windsurf, Cursor, VS Code, Cline/Roo (`artemis mcp --install <client>`). Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — Execution model: a dual structure of the **Flash profile** (reactive loop, 3–5 seconds per step, no planning/verification) and the **Pro profile** (Planner+Operator+Checker multi-agent, 15–40 seconds per step, pre-execution safety net, final verification). Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — Model-agnostic: supports Gemini, Claude, GPT-4o, Qwen-VL (not locked into any particular model). Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — On-device component: on first task execution it installs **Artemis Accessibility Helper** (an accessibility service that reads screen layout only, "sends nothing elsewhere") on the phone. UIAutomator2 fallback is available. No cloud dependency for core operation (aside from model calls). Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — Benchmark: 99%+ completion rate on Google Research's **AndroidWorld** benchmark (20+ apps, 100+ multi-step tasks) (SOTA claim). Source: GitHub README + AlphaSignal (fetched 2026-09-20)
- **⚠️ Contested — VERIFIED (source: interested-party blog, includes unverified claims)** — Competitor **Minitap, Inc.** (author of the open-source `mobile-use` project) publicly accused Artemis of taking its code without copyright notices: "the device connection code matches exactly," "the Hopper agent instructions are identical word for word," and early versions carried the original authors' names (Pierre-Louis Favreau et al.) that were later removed by force-push. The Google artemis README itself notes at the bottom, "includes source code developed by Minitap, Inc." (apparently added after the fact). Source: https://www.minitap.ai/blog/i-expected-better-from-google (fetched 2026-09-20) — **UNVERIFIED**: no rebuttal or official response from Google was found in search; this claim comes from Minitap's own blog (a party's own claim), so it must not be treated as standalone fact.
- **VERIFIED** — The name "Artemis" does not appear in the official keynote/announcement list of Google I/O 2026 (2026-05-19~20). The mobile-agent announcement at I/O was a separate project, **"Gemini Intelligence on Android"** (2026-05, announced at Android Show I/O Edition; performs proactive tasks, web summaries, and form autofill; summer rollout on Samsung/Google phones). It is a consumer system feature, is not open source, and is unrelated to Artemis. Source: https://blog.google/products-and-platforms/platforms/android/gemini-intelligence/ (confirmed via search snippet; direct fetch of the original returned 404; fetched 2026-09-20)
- **VERIFIED** — Comparable open-source projects exist: `mobile-next/mobile-mcp` (Apache-2.0, TypeScript, 6,763 stars, **supports iOS + Android + emulators/simulators**), `droidrun/mobilerun` (Android + iOS, LLM-agnostic, own benchmark 63% on 116 tasks). Source: `gh repo view mobile-next/mobile-mcp`, WebSearch droidrun (fetched 2026-09-20)

## 3. Options / Comparison Table

| Item | Google **Artemis** | Minitap **mobile-use / mini** | **mobile-mcp** (mobile-next) | **droidrun/mobilerun** |
|---|---|---|---|---|
| License | Apache-2.0 (open) | Has an open-source core, commercial "mini" is closed | Apache-2.0 (open) | Open source |
| Android | O (99%+ AndroidWorld) | O | O | O (63% on 116 tasks, own benchmark) |
| iOS | ✕ (roadmap only) | O (mini product) | **O** | O |
| MCP support | O (native server) | Partial | O (core design) | Partial |
| Integration targets | Antigravity/Claude Code/Codex/Cursor/Windsurf | Own QA product | Claude Code/Codex/Gemini/Copilot/Antigravity | CLI/Docker/Python |
| Nature | Developer testing/automation tool | Commercial mobile QA SaaS | General-purpose MCP server | General-purpose agent framework |
| Star count | 8,111 | Not public | 6,763 | Many (many forks, exact original count unconfirmed) |
| omnis fit | Low (Android-only, irrelevant to iPhone) | Low (closed, QA-specialized) | **Medium** (iOS support is the key differentiator) | Medium |

Artemis itself is a low fit for omnis — Logan's client is an iPhone, and KakaoTalk capture happens on the Mac mini (macOS). An Android-only tool has nowhere to be used directly.

## 4. Recommendation for omnis

**Do not adopt.** Integrating Artemis directly into the omnis pipeline is not recommended.

- **Why**: (1) omnis's two clients are a MacBook Pro and an iPhone — neither is Android. (2) The API-less channel capture target (KakaoTalk) is a macOS app, not an Android app (the brief specifies installing KakaoTalk.app on the Mac mini). (3) Artemis is a tool optimized for "test automation," and its design purpose differs from always-on background inbox polling/notification parsing (an observe-act loop taking 3–40 seconds per task is inefficient for a real-time inbox use case).
- **Effort estimate**: S — there is no need to reconsider adoption itself; attempting integration would be M (iOS is unsupported, so an adapter would have to be written from scratch, which is effectively pointless).
- **Risks**: Using Artemis for Android app manipulation would require installing an accessibility service and could run afoul of the ToS of apps such as Kakao (clauses prohibiting automation) — the same line as the original brief's concern that "API-less channels carry account-suspension risk." Minitap's copyright dispute also suggests governance risk in the Google project itself (opaque code provenance) — low credibility as a production dependency.
- **What to reference instead**: `mobile-next/mobile-mcp`, which also supports iOS, is a better candidate for the point at which "manipulating OS-native apps over MCP" actually becomes necessary (e.g., when KakaoTalk cannot be captured through macOS accessibility APIs and UI automation must be used as a workaround). That said, this is not an immediate priority either — the omnis MVP should prioritize channels that have APIs (Slack/Gmail/Telegram).

## 5. What to borrow (patterns only)

The **architectural patterns** are more valuable as reference than the technology itself:

1. **Flash/Pro dual-profile separation** (README "Execution Profiles" section): fast, deterministic tasks (e.g., "label this email") run through a reactive loop with no planning, while complex judgments (e.g., "decide what to reply in this thread") run through a heavy loop with a Planner+Checker — omnis can use this same dichotomy when designing "context-aware reply drafts" and "auto-labeling." Lightweight labeling/filtering = Flash-style, reply draft generation/CRM follow-up judgment = Pro-style.
2. **"An agent manipulating an agent" via an MCP server**: The way Artemis exposes a "physical device" as MCP tools to IDE agents (Claude Code, etc.) is the same pattern omnis is aiming for — "Claude Code/Codex/DeepSeek/Hermes sessions being aware of and manipulating each other's sessions." Artemis's `mcp_server/rules.md` (which separates behavioral rules into a standalone file mounted as IDE rules) can be referenced as a way to document, in omnis's agent-session-as-inbox-thread design, "the rules an agent must follow when intervening in another agent's session."
3. **Principle of minimizing the on-device helper**: The Artemis helper explicitly states the privacy line "reads screen layout only and sends nothing anywhere" (README "What ARTEMIS Installs on Your Phone"). When omnis installs a resident process on the iPhone/Mac (notification capture, etc.), it can borrow this pattern of putting minimal-privilege and transparency language into user-facing documentation.
4. **Copyright/attribution lesson**: The Minitap dispute is a cautionary tale that omnis must carefully honor licenses and author attribution when reusing open-source components. This matters especially if there are plans to fork/modify the Vercel AI SDK or other OSS.

File path pointer: If there is anything to reference, writing the above three patterns as principles alone in a future `mac-mini-capture/` (working name) or `agent-orchestration/` module design doc inside the omnis repo is sufficient — code porting is unnecessary (different platforms).

## 6. Open questions

- Whether Gemini Intelligence on Android (consumer-facing, announced at 2026-05 I/O) has actually shipped and is usable on Logan's Android/Samsung devices, and whether that might have been the "artemis" Logan originally intended — need to re-confirm with Logan the original context (where the word "artemis" was seen).
- Whether Google has responded officially to the Minitap code-provenance dispute over Artemis (subsequent commit logs or announcements) — not confirmed in this investigation (UNVERIFIED).
- When omnis would actually need `mobile-mcp` (which supports iOS) — an architecture decision comes first: whether to do KakaoTalk capture via macOS app automation or via a separate API/bridge. Once that decision is made, re-evaluate whether to adopt mobile-mcp.
- Artemis's on-device VLM roadmap ("On-Device Lightweight VLMs" — local execution, privacy-first) points in the same direction as omnis's goal of using local models on Apple Silicon (M4/M5) — how Artemis implements this is still at the roadmap stage, so tracking value is low; recommend re-checking in 6 months.

## 7. Sources

- https://github.com/google/artemis (repo, README) — fetched 2026-09-20
- https://alphasignal.ai/news/google-s-artemis-hits-99-on-android-tasks-where-most-agents-fail — fetched 2026-09-20
- https://www.minitap.ai/blog/i-expected-better-from-google — fetched 2026-09-20 (party's own claim, copyright dispute)
- https://blog.google/products-and-platforms/platforms/android/gemini-intelligence/ — fetched 2026-09-20 (search snippet confirmed, direct fetch 404)
- https://github.com/mobile-next/mobile-mcp — fetched 2026-09-20
- https://github.com/droidrun/mobilerun — fetched 2026-09-20 (search snippet)
- https://medium.com/coding-nexus/google-artemis-the-open-source-ai-agent-that-can-control-your-android-phone-747bf7ce3d20 — fetched 2026-09-20 (secondary source, for cross-verification)
- Google I/O 2026 official page (blog.google/innovation-and-ai/technology/ai/google-io-2026-all-our-announcements/) — confirmed "Artemis" absent via search snippet, 2026-09-20

## Verification (adversarial)

Re-checked 2026-09-20 against primary sources: `gh repo view google/artemis`, `gh api repos/google/artemis/readme` (full 318-line README fetched and read in full, not just a snippet), `gh repo view mobile-next/mobile-mcp`, `gh repo view droidrun/mobilerun`, and direct fetches of alphasignal.ai, minitap.ai, blog.google, mobilerun.ai/benchmark. 11 gh/web lookups performed. Default posture: unverifiable unless a primary source (Google's own repo/README, or the claimant's own site for self-claims) backs it.

| # | Claim | Verdict | Evidence URL | Correction |
|---|---|---|---|---|
| 1 | google/artemis: Apache-2.0, 8,111 stars, created 2026-08-13, pushed 2026-09-12, Python | CONFIRMED | https://github.com/google/artemis (`gh repo view`/`gh api repos/google/artemis`, fetched 2026-09-20) | Live count is 8,112 stars (+1) — normal drift, not material. All other fields exact match. |
| 2 | Built/released by Google's Pixel Test Engineering Fusion team on 2026-09-10 | **UNVERIFIABLE** (was marked "high confidence VERIFIED" — overstated) | AlphaSignal only: https://alphasignal.ai/news/google-s-artemis-hits-99-on-android-tasks-where-most-agents-fail (fetched 2026-09-20) | Checked README.md (full text) and CONTRIBUTING.md in google/artemis directly — neither names "Pixel Test Engineering," "Fusion team," or any internal team. No Google blog post, press release, or repo file corroborates this attribution; it traces to a single secondary news aggregator (AlphaSignal), not Google. Should be downgraded from "confirmed/high confidence" to "reported by one secondary source, no Google primary confirmation found." |
| 3 | Android-only; iOS is an unchecked roadmap item | CONFIRMED | README `## Roadmap` section: `- [ ] **iOS Platform Expansion**: Extending multimodal perception and mobile automation to iOS devices and simulators.` (fetched 2026-09-20) | None. |
| 4 | Native MCP server integrating Antigravity, Claude Code, Codex, Cursor, Windsurf | CONFIRMED | README `#mcp-setup` section, fetched 2026-09-20 | None — README's Quick Start explicitly lists all five (plus VS Code, Cline/Roo, OpenClaw) as IDEs the one-click installer configures with the MCP server + rules; the "Mount Behavioral Rules" subsection gives per-IDE install steps for each of the five named tools individually. |
| 5 | 99%+ on AndroidWorld (100+ multi-step tasks, 20+ apps) | CONFIRMED | README `## Benchmarks: AndroidWorld (SOTA 99%+)`, fetched 2026-09-20 | None. |
| 6 | Flash (~3–5s/step, no planning) vs. Pro (~15–40s/step, Planner/Operator/Checker, safety checks) | CONFIRMED | README `## Execution Profiles: Flash vs. Pro`, fetched 2026-09-20 | None — wording matches almost verbatim. |
| 7 | I/O 2026 did not announce "Artemis"; separate closed feature "Gemini Intelligence on Android" exists | CONFIRMED | https://blog.google/products-and-platforms/platforms/android/gemini-intelligence/ (fetched 2026-09-20, page loaded this time, no "Artemis" mention found in full text) | Minor date nuance: Gemini Intelligence was announced 2026-05-12 at the "Android Show 2026" event, not at I/O itself (I/O was 2026-05-19/20) — the original file's "Android Show I/O Edition" phrasing is directionally correct but the two events are formally distinct. The I/O all-announcements URL still 404s for direct fetch (same as original finding); absence of "Artemis" there remains a search-snippet-level check, not a full-page read. |
| 8 | Minitap alleges Artemis copied its code (connection code, identical Hopper agent instructions, force-pushed-away author names); README now credits Minitap | CONFIRMED | https://www.minitap.ai/blog/i-expected-better-from-google (fetched 2026-09-20, primary source — Minitap's own post); README line 318, fetched 2026-09-20: `This project includes source code developed by [Minitap, Inc.](https://github.com/minitap-ai/mobile-use).` | None on the core allegations (self-interested party, appropriately hedged as "medium confidence" in the original — correctly not upgraded to fact). Confirmed no Google public rebuttal exists as of fetch date. |
| 9 | mobile-next/mobile-mcp: Apache-2.0, TypeScript, 6,763 stars, iOS+Android | CONFIRMED | `gh repo view mobile-next/mobile-mcp`, fetched 2026-09-20 | None — exact star-count match. |
| 10 | On-device Accessibility Helper reads screen layout only, sends nothing elsewhere; no cloud dependency besides the chosen LLM | CONFIRMED | README `## What ARTEMIS Installs on Your Phone`, fetched 2026-09-20 | None on the direct quote ("It listens only on the phone itself and sends nothing elsewhere"). "No cloud dependency for core execution besides the chosen LLM" is the original researcher's paraphrase, not a verbatim README claim, but it is a reasonable reading — no contradicting evidence found. |
| extra | droidrun/mobilerun: "own benchmark 63% on 116 tasks" | **REFUTED** | https://mobilerun.ai/benchmark and https://github.com/droidrun/mobilerun (fetched 2026-09-20) | Current published number is **91.4% (106/116 tasks)**, and the benchmark is explicitly **AndroidWorld** (the same benchmark Artemis uses), not an unnamed "own benchmark." Repo has **9,420 stars** (more than Artemis's 8,112 and mobile-mcp's 6,763) and is MIT-licensed. The comparison table's "Many (many forks, exact original count unconfirmed)" undercounts this materially. |

### Corrected recommendation

The core recommendation — do not adopt Artemis for omnis (Android-only, wrong OS for both of Logan's clients, test-automation loop latency mismatched to a live-inbox use case) — **stands; none of the refutations above overturn it.** Two adjustments to the supporting detail:

1. **Drop or hedge the "Fusion team, 2026-09-10" attribution** (claim #2) when citing this research elsewhere — it rests on one secondary aggregator (AlphaSignal), not on Google's own README, CONTRIBUTING.md, or a blog post. Cite it as "reported by AlphaSignal," not as a Google-confirmed fact.
2. **Elevate droidrun/mobilerun, not just mobile-mcp, as the reference candidate for §4/§6** ("what to borrow" / future iOS+Android automation). It scores 91.4% on the *same* AndroidWorld benchmark Artemis claims 99%+ on, supports iOS natively, is LLM-agnostic across seven providers, and has the largest star count of the three projects compared (9,420 vs. 8,112 vs. 6,763). If omnis ever needs a macOS/iOS UI-automation fallback for API-less channels (the KakaoTalk scenario flagged in §4/§6), droidrun/mobilerun — not just mobile-mcp — deserves a direct trial, since it already has a public cross-platform AndroidWorld result to compare against Artemis's, whereas mobile-mcp's README does not publish a comparable benchmark number.
