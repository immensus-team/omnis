# omnis — Things that need Logan's hands (2026-09-20)

Wave 0 (kernel, DB, protocol, design tokens, unattended spikes) is being run by agents. Below are only the things agents can't do. Detailed procedures for each item are prepared as checklists and scripts under the corresponding Task in `docs/superpowers/plans/2026-09-20-phase-0-spikes.md` (created in Wave 1). Ordered by impact on getting development started.

## A. Decisions that need an answer (proceeding with defaults; tell me if you want to change them)

| # | Question | Current default | Rationale location |
|---|---|---|---|
| Q1 | Start with iPhone as a PWA (Phase B), native in Phase D | PWA | Master §19 |
| Q4 | Scope of personal inbox bodies sent to DeepSeek | personal, finance, legal, health, VIP go to Anthropic; everything else to DeepSeek | §14 |
| Q13 | Execution mode for delegated Claude Code | Decided by the Gate ⑪ result. `--bare` bills against the API key, so the subscription can't be used | §19, tools/spikes/_probes |
| Q10 | Scope of automatic delegated execution | Auto-suggest + single approval. Fully autonomous only when per-runtime and per-repo allow rules are enabled | §11 |
| Q11 | VIP drafts once the cost ceiling is reached | Keep generating from a 10% reserve | §14 |
| Q9 | License | Apache-2.0 (LICENSE file already committed) | §19 |
| — | The 4 default auto-archive rules | The rules in §11. Taste is the answer here, so adjust after the first week's digest | §11 |

## B. On-site and account work (7 gates)

| Gate | What | Why Logan | On failure |
|---|---|---|---|
| ③ FileVault + auto-login (Mac mini) | Set up auto-login in front of the Mac mini per the checklist, then observe a reboot | The login screen right after a reboot isn't visible remotely | FileVault OFF + tailnet-only, requires Logan's approval |
| ④ kmsg read (Mac mini) | Run `run.sh`, then Allow the System Settings → Accessibility permission once, observe for 48 hours | The initial accessibility permission grant requires a GUI click | Notification Center DB + OCR fallback |
| ⑤ Tailscale Serve HTTPS | I'll handle the setup on the Mac mini side. Open it in iPhone Safari and check whether there are SSL errors | Verification on real hardware | Recheck MagicDNS → move TailscaleKit up into Phase D |
| ⑨ Slack Socket Mode | Create and install the app from a manifest at api.slack.com/apps, store the 2 tokens in Keychain, 1 test DM | Installing a workspace app requires Logan's account | Events API + Funnel review |
| ⑩ Gmail watch + Pub/Sub | Create a GCP project, enable the Gmail API, 1 OAuth consent, 1 test email | Only the account owner can do this | `history.list` polling every 1 minute (no loss of functionality) |
| ① Calendar push via Funnel | 1 Calendar OAuth consent, approval to open the Funnel briefly | Decision on public internet exposure | syncToken polling every 1–5 min (already the default path) |
| ② Beeper + WhatsApp secondary number | Install Beeper Desktop on the Mac mini, pair via QR with the secondary-number phone, store the token in Keychain, test send | Physical QR | whatsmeow Go sidecar |

Prerequisites: a phone holding the secondary number (②), 30 minutes sitting in front of the Mac mini (③④), a GCP billing account (⑩, free tier).

## C. Things that don't need doing now
- Connecting the real WhatsApp number (Q2), KakaoTalk send (Q3, after 14 days of stable read) — Phase C.
- iPhone native app, public README — Phase D.
