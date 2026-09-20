# 15 — Threat Model & Security Architecture

## 1. TL;DR

omnis pulls WhatsApp/Telegram/Slack/Kakao/Gmail sessions and agents that reply on Logan's behalf and run code on two devices into a single process. Because the attack surface is "the entire inbox + execution privileges," prompt injection — the #1 item in the OWASP LLM Top 10 2025 — is the core risk (email/DMs are untrusted data). MVP must-haves: store tokens in the macOS Keychain (Tauri keychain plugin), encrypt the message DB with SQLCipher, expose the mini to the tailnet only via Tailscale ACLs (tag-based), a per-channel/per-contact permission model (read/draft/send-approval/send-autonomous), human-in-the-loop by default for outbound, an audit log of every agent action, and a kill switch. WhatsApp/Kakao/LinkedIn are unofficial clients, so the risk of account suspension from ToS violations is real — human-like cadence and rate limits are mandatory. FileVault only protects when macOS is powered off, so SQLCipher is required separately.

## 2. Facts

- Secrets can be stored in and retrieved from the Keychain with the macOS `security` CLI (`add-generic-password`, `find-generic-password`). The `-w` value can end up in shell history, so take care. — https://zottmann.org/2023/04/30/til-how-to.html (fetched 2026-09-20) VERIFIED
- Tauri v2's Stronghold plugin is no longer recommended and is slated for removal (deprecated) in v3; for OS-native keychain integration, use the `tauri-plugin-keyring` family (wrapping the Rust `keyring` crate), leaving Stronghold only for keeping the encryption key itself in the keyring. — https://v2.tauri.app/plugin/stronghold/ , https://github.com/HuakunShen/tauri-plugin-keyring , https://github.com/tauri-apps/tauri/discussions/7846 (fetched 2026-09-20) VERIFIED
- SQLCipher transparently encrypts the entire SQLite file (data + metadata + indexes + journal) with AES-256, and needs no application code changes beyond opening it with PRAGMA key. The default KDF is PBKDF2 with 640,000 iterations. Overhead is 5–15% depending on the operation. — https://github.com/sqlcipher/sqlcipher , https://oneuptime.com/blog/post/2026-02-02-sqlcipher-encryption/view (fetched 2026-09-20) VERIFIED
- FileVault (AES-XTS) provides full protection only while the Mac is powered off; once logged in, disk data is readable as if it were plaintext, so FileVault alone is insufficient for protecting the message DB "while the process is alive" and app-level encryption (SQLCipher) is required separately. — https://support.apple.com/guide/security/volume-encryption-with-filevault-sec4c6dc1b6e/web (fetched 2026-09-20) VERIFIED
- The 1Password CLI (`op`) can inject secrets via `op://vault/item/field` secret references and `op inject`/`op run` without leaving plaintext in files; unattended automation uses `OP_SERVICE_ACCOUNT_TOKEN` environment-variable-based auth. Hermes Agent's own docs also include a 1Password CLI integration skill (an optional security skill). — https://www.1password.dev/cli/secret-references , https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/security/security-1password (fetched 2026-09-20) VERIFIED
- sops+age encrypts only the values in YAML/JSON and leaves keys in plaintext so git diff/review still works, and wraps the data key for multiple recipients (age public keys) to separate access per team/device. It is common for Kubernetes/GitOps, but applies just as well to encrypting local dotfiles/config. — https://www.jonashietala.se/blog/2026/05/31/sops_age_and_sealed_secrets/ (fetched 2026-09-20) VERIFIED
- Tailscale Serve exposes local services to the tailnet only, and identity headers (e.g. `Tailscale-User-Login`) are populated only for real users, not tags; to prevent spoofing, the same header on incoming requests is stripped and then re-injected. ACLs can enforce access control at the device-tag level using either Grants (new) or ACL (legacy) syntax. — https://tailscale.com/docs/features/tailscale-serve , https://tailscale.com/docs/concepts/tailscale-identity , https://tailscale.com/docs/features/access-control/acls (fetched 2026-09-20) VERIFIED
- The OWASP Top 10 for LLM Applications 2025 kept Prompt Injection (LLM01) at #1 for the second consecutive time, notes that RAG or fine-tuning cannot fully stop it, and recommends defense-in-depth: least-privilege tooling + I/O filtering + human approval + adversarial testing. — https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf (fetched 2026-09-20) VERIFIED
- Containment design in Anthropic's own products (Claude Code, Claude Cowork): Claude Code uses an OS sandbox (macOS Seatbelt / Linux bubblewrap) so reads are free, writes are confined to the workspace, and the network is blocked by default. Claude Code's permission approval rate of roughly 93% produced "approval fatigue," so it introduced an auto mode in which a model-based classifier blocks about 83% of pre-identified risky actions. Cowork uses VM (hypervisor) isolation + an egress allowlist proxy. — https://www.anthropic.com/engineering/how-we-contain-claude (fetched 2026-09-20) VERIFIED
- Anthropic's browser-agent prompt-injection defenses consist of (1) RL training on simulated malicious web content, (2) a classifier that scans all untrusted content, and (3) continuous red-teaming; the company states it achieved a 1% attack success rate (ASR) under adaptive Best-of-N attacks — while explicitly noting that "1% is still a meaningful risk." — https://www.anthropic.com/news/prompt-injection-defenses (fetched 2026-09-20) VERIFIED
- OWASP MCP Security Cheat Sheet: tool allowlists must pin not just names but parameter and return schemas (hash pinning); to prevent confused-deputy attacks, verify on every request that the session/token belongs to the current requester, and issue scoped credentials separately per server. OAuth tokens must be stored only in an OS-native credential store (macOS Keychain, etc.) and never placed in plaintext config. Force explicit human confirmation for destructive, financial, or data-sharing operations. — https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html (fetched 2026-09-20) VERIFIED
- Simon Willison's Dual-LLM pattern (2023) separates a Privileged LLM (can call tools, sees only the original user query) from a Quarantined LLM (processes untrusted data but has no tool-calling privileges). Google DeepMind's follow-up, CaMeL, reportedly tracks capabilities/dependencies with a custom interpreter and defended against 67% of injection attacks on the AgentDojo benchmark. — https://simonwillison.net/2025/Apr/11/camel/ (fetched 2026-09-20) VERIFIED
- whatsapp-web.js attaches to the "official version" of WhatsApp Web, so it is known to carry less ban risk than fully reverse-engineered libraries (Baileys, etc.), but it is still an unofficial connection, and the real ban triggers are behavioral patterns — "sending unsolicited messages to people you have never contacted first," accumulation of unanswered messages, and so on (a 2026 update added unanswered-message counting). — https://wwebjs.dev/ , https://wapisimo.dev/blog/en/whatsapp-unofficial-api-ban-risk (fetched 2026-09-20) VERIFIED (the qualitative assessment is based on vendor blogs, so confidence is medium)
- Telegram MTProto user-account automation (Telethon, etc.) can get an account restricted or permanently banned by the server if it is judged "abusive automation" — mass joins, high-frequency sending, scraping, and the like; because the user API, unlike the bot API, is treated as a "person" by the server, maintaining human-like usage patterns lowers the risk. — https://github.com/LonamiWebs/Telethon (fetched 2026-09-20) VERIFIED
- LinkedIn's official User Agreement explicitly prohibits all automation software and scraping, including "headless browsers" and detectable extensions. Violations can escalate from a 24–72 hour connection-request pause up to a permanent restriction, and as of 2026 a "Reputation Gradient" (dynamic limits based on account age, acceptance rate, and history) is reported to be in effect. — https://www.linkedin.com/help/linkedin/answer/a1341387 , https://www.linkedin.com/help/linkedin/answer/a1340567 (fetched 2026-09-20) VERIFIED (the ToS portion is a primary source; the figures and the "Reputation Gradient" term come from vendor blogs, so confidence is medium)
- KakaoTalk automatically detects abnormal usage patterns with its own anti-abuse system and issues usage restrictions, and there is a March 2021 precedent of a mass suspension of KakaoTalk bot accounts and even of the bot owners' primary accounts (responsibility for using unofficial bots lies with the user). — https://talksafety.kakao.com/measure , https://namu.wiki/w/%EC%B9%B4%EC%B9%B4%EC%98%A4%ED%86%A1%20%EB%B4%87 (fetched 2026-09-20) VERIFIED (the precedent comes from a namuwiki source, so confidence is medium)

## 3. Options / Comparison

| Area | Option A | Option B | Option C | Fit for omnis |
|---|---|---|---|---|
| Token storage (macOS) | Direct `security` CLI calls + Keychain | `tauri-plugin-keyring` (if the app is Tauri) | 1Password CLI (`op`) + service account | B if it's a Tauri app; for the CLI/script layer, A or C in parallel |
| config/settings secrets (git-tracked) | sops+age | git-crypt | plaintext .env (not recommended) | sops+age — diffable, easy to separate age recipients per device |
| Message DB encryption | SQLCipher | Relying on FileVault alone | App-level field encryption (optional) | SQLCipher required, FileVault as a supplement |
| mini exposure | Tailscale (ACL + Serve) | VPN (manual WireGuard) | Public IP + reverse proxy | Tailscale — already set up (see vigor); identity headers distinguish agents |
| Prompt injection defense | Dual-LLM / CaMeL-style separation | Single LLM + classifier scanning only | No defense at all | MVP: classifier scan + tool allowlist + human-in-the-loop (single LLM); Dual-LLM separation is Later |
| WhatsApp connection | whatsapp-web.js (unofficial) | WhatsApp Business API (official, paid) | Not used | MVP: whatsapp-web.js (single personal user, low cost) + strict rate limits; consider the Business API once there is funding |
| Telegram connection | MTProto user account (Telethon-style) | Bot API | Both (separate account + bot channels) | user account required (to collect personal DMs); cadence limits mandatory |

## 4. Recommendation for omnis

**Design principle**: the moment omnis puts "the inbox" and "execution privileges" in the same process, it becomes a single point of failure (SPOF) and a single attack surface. Controls must be designed along two separate axes: the channel accounts themselves (ToS/ban) and agent execution privileges (prompt injection).

### Must-have for MVP
1. **Secret storage** — macOS Keychain (all OAuth tokens/API keys); if it's a Tauri app, wrap it with the keyring plugin. Never store plaintext in config files. Effort: S. Risk: low (a mature macOS feature).
2. **Encryption at rest** — move the message store to SQLCipher (if it is SQLite-based, only the file header changes). Assume FileVault is already on, but document that it alone is not enough. Effort: S. Risk: low (5–15% overhead, an already-proven library).
3. **tailnet-only exposure** — restrict the mini's api_server (:8642) and the like with Tailscale ACLs (tag:hub, tag:client), and use `tailscale serve`'s identity header to record in the log which client's which agent made the request. Effort: S (the tailnet is already built with vigor). Risk: low.
4. **Agent permission model** — four levels per channel × contact: `read / draft / send-with-approval / send-autonomous`. The default is always `draft` (suggestion only; sending requires human approval). `send-autonomous` is opt-in and only for whitelisted contacts (e.g. a bot for recurring reports). Effort: M (needs UI + data model). Risk: medium — a bad design is expensive to refactor later, so design the granularity from the start.
5. **outbound human-in-the-loop by default** — every send action is approved by a human who sees the actual content before it goes out (identical to the OWASP MCP cheat sheet's recommendation). Show the full text that will actually be sent, not a "summary." Effort: S~M.
6. **prompt injection minimum defense line** — (a) always tag text coming from the inbox as "data" to separate it from the system prompt, (b) allowlist send/code-execution tools per task (e.g. a "draft a reply to this email" task gets no send tool at all), (c) at least one classifier scan over untrusted content (Anthropic models' own injection resistance plus our own rule-based keyword scan in parallel). Full Dual-LLM adoption is Later. Effort: M. Risk: medium~high — this risk is tied directly to omnis's reason to exist (agents hold broad access), so do not underinvest.
7. **audit log** — record every agent action (read/draft created/send/code execution) in an append-only log (a separate SQLite table is enough) and retain it for at least 90 days. Effort: S.
8. **kill switch** — a single global toggle that immediately stops all autonomous actions (UI button + CLI). Effort: S.
9. **per-channel human-like cadence** — hardcode rate limits + random delays + a "never send unsolicited messages to someone you have not contacted first" rule into automated WhatsApp/Kakao/LinkedIn/Telegram sending. Effort: S. Risk: this is itself a mitigation for ban risk, not a way of avoiding it — state that in the doc.

### Later (post-MVP)
- **Dual-LLM / CaMeL-style separation**: separate the privileged planner LLM from the untrusted-content-handling LLM so that injection cannot contaminate tool calls themselves. Effort: L. Risk: requires architectural rework, but is the strongest defense in the long run.
- **sops+age-based config encryption + git commits**: offsets the risk of putting config on the company GitHub against developer convenience (diffability). Effort: S, but the need is low right now (a solo developer, little pressure for git collaboration).
- **1Password integration**: Hermes Agent already supports a 1Password skill, so Keychain may be enough for a single user — adopt it when sharing across multiple vaults/multiple people becomes necessary. Effort: M.
- **Migration to the WhatsApp Business API**: once the account grows or budget appears, move to the official API to eliminate ban risk at the source. Effort: L (approval process + cost).
- **VM/container-level agent isolation** (the Anthropic Cowork way): since multiple agent sessions run concurrently on the Mac mini, isolate the code-execution agent in a sandbox (bubblewrap, etc.) later. Effort: L.
- **Changes if the hub moves to the MacBook**: (1) the Tailscale ACL shifts from "mini→client" to "peer-to-peer," requiring the private tag structure to be redesigned, (2) where to put the KakaoTalk/LinkedIn sessions (currently resident on the mini) must be re-decided — API-less channels still need "one machine that keeps this session alive," so a fully hub-less setup is effectively impossible unless KakaoTalk and LinkedIn offer official APIs, (3) distributing the SQLCipher key across devices becomes a new problem (today only the single mini needs the key).

## 5. What to borrow

- **Anthropic Claude Code's sandboxing strategy** (Seatbelt/bubblewrap, "free reads, writes limited to the workspace, network blocked by default") applies directly to the code-execution agents (Codex, claude-ds) running on the macOS mini/MacBook — see the "Sandboxing & Isolation" section of https://www.anthropic.com/engineering/how-we-contain-claude.
- **Anthropic's auto-mode classifier idea** ("a 93% approval rate causes approval fatigue → a model-based classifier blocks risky actions up front") — when designing omnis's approval UI, adopt a structure that does not ask every time but auto-filters low-risk actions with a classifier and escalates only high-risk ones to a human.
- **The OWASP MCP Security Cheat Sheet's tool allowlist hash-pinning** (pinning not just names but parameter schemas) — applies as-is if omnis exposes per-channel tools (send_slack, send_whatsapp, etc.) in MCP style.
- **Hermes Agent's 1Password skill docs** (`hermes-agent.nousresearch.com/docs/user-guide/skills/optional/security/security-1password`) — Logan is already running Hermes 24/7 on the mini, so the structure can be ported directly into omnis's secret-management skill.
- **The 1Password CLI's secret reference pattern** (`op://vault/item/field`, `op run`) — apply the pattern of injecting secrets without plaintext in code/config directly to omnis's agent execution scripts (claude-ds invocations, etc.).
- **Tailscale Serve's identity header re-injection approach** (incoming headers are always stripped and then re-injected to prevent spoofing) — a reference implementation for the mechanism that lets omnis reliably log "which client/agent made the request."

## 6. Open questions

- Do we go with whatsapp-web.js (unofficial) for WhatsApp, or move straight to the WhatsApp Business API once budget allows — decide now, or decide after getting hit by one account suspension?
- The concrete criteria for which contacts/situations get `send-autonomous` (e.g. only "teammates who receive recurring reports"? only "formulaic replies to messages that came in first"?) are still undecided — needs to be coordinated with the product brief (a different research file).
- The Mac mini is a single point of failure, so a strategy for recovering the KakaoTalk/LinkedIn sessions if the mini dies (whether re-login is required, how often QR/2FA re-authentication happens) needs separate investigation (out of scope for this document).
- How to implement a Dual-LLM/CaMeL-style architecture on top of the Vercel AI SDK/eve needs to be cross-checked with the SDK research file.
- It has been said that the code will go on the company (Onword Lab) GitHub (line 3 of the brief), but whether the repo is private needs confirmation — if it is public, sops+age encryption must be promoted to the MVP.

## 7. Sources

- https://zottmann.org/2023/04/30/til-how-to.html (macOS Keychain CLI)
- https://v2.tauri.app/plugin/stronghold/
- https://github.com/HuakunShen/tauri-plugin-keyring
- https://github.com/tauri-apps/tauri/discussions/7846
- https://github.com/sqlcipher/sqlcipher
- https://oneuptime.com/blog/post/2026-02-02-sqlcipher-encryption/view
- https://support.apple.com/guide/security/volume-encryption-with-filevault-sec4c6dc1b6e/web
- https://www.1password.dev/cli/secret-references
- https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/security/security-1password
- https://www.jonashietala.se/blog/2026/05/31/sops_age_and_sealed_secrets/
- https://tailscale.com/docs/features/tailscale-serve
- https://tailscale.com/docs/concepts/tailscale-identity
- https://tailscale.com/docs/features/access-control/acls
- https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf
- https://www.anthropic.com/engineering/how-we-contain-claude
- https://www.anthropic.com/news/prompt-injection-defenses
- https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
- https://simonwillison.net/2025/Apr/11/camel/
- https://wwebjs.dev/
- https://wapisimo.dev/blog/en/whatsapp-unofficial-api-ban-risk
- https://github.com/LonamiWebs/Telethon
- https://www.linkedin.com/help/linkedin/answer/a1341387
- https://www.linkedin.com/help/linkedin/answer/a1340567
- https://talksafety.kakao.com/measure
- https://namu.wiki/w/%EC%B9%B4%EC%B9%B4%EC%98%A4%ED%86%A1%20%EB%B4%87
- https://github.com/block/buzz (reference repository — the open-source project mentioned in the brief, description: "A hive mind communication platform", 33,695 stars, Apache-2.0)

(All URLs fetched 2026-09-20)
