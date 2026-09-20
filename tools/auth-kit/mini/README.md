# What to do on the mini — KakaoTalk / WhatsApp / LinkedIn / Codex

These four require a GUI session, so they must be done in front of the mini's screen (or via Screen
Sharing) — an SSH shell will not work (the Keychain is also GUI-session-only, `ops/mini/RUNBOOK.md`
§4). The prerequisites (automatic login, no screen lock, `pmset`/`caffeinate`) must already be
applied mini-wide — that procedure is not repeated here; `docs/spec/A6-ops-infra.md` §2 (the
`omnis-reapply-settings` LaunchAgent) is the source of truth.

## KakaoTalk (kmsg, A1 §2.8)

1. Log in normally to KakaoTalk.app on the mini, **Automatic login On**. 2FA is a one-time new-device
   registration plus a 4-digit mobile security code for each sub-device connection (official Kakao
   policy).
2. `brew install channprj/tap/kmsg`
3. **Accessibility permission**: System Settings → Privacy & Security → Accessibility → check the
   terminal (or whatever process runs kmsg). kmsg reads the KakaoTalk.app UI through the AX API —
   without this permission nothing works.
4. Do **not** use `kmsg auth login` (the feature that stores the password in kmsg's own store) —
   simply keeping KakaoTalk.app itself logged in is enough (A1 §2.8, "minimize secrets").
5. Check: `kmsg chats --json && kmsg read <chat_id> --background-safe --json` (A1-③ spike,
   §4). KakaoTalk.app must not lose focus for this to be normal.
6. Do not open send from the start — **open it on an approval basis after 2 weeks of stable read**
   (A1 §2.8, master Q3 default).

No Keychain entry — only KakaoTalk.app's own login is used (A1 §1.3 table).

## WhatsApp — Beeper (A1 §2.6) + secondary-number pilot

1. Install the Beeper Desktop app (free, public beta) → pair a WhatsApp account inside it via QR
   — **pilot with a secondary number first** (master Q2 default, avoiding the risk of the primary
   number's account being suspended).
2. Settings → Integrations → issue a Bearer token for the Desktop API
3. Settings → Integrations → Advanced → enable **Remote Access**
4. Tunnel through **Tailscale only** (Beeper has no tunnel of its own; do not use Funnel/Cloudflare —
   reuse the existing tailnet ACLs, A1 §2.6)
5. Store:
   ```bash
   tools/auth-kit/keychain-add.sh omnis.beeper.token
   ```
6. **personal use only** — no bulk sending, no automatic replies (Beeper official docs warning,
   A1 §2.6).

The whatsmeow fallback (A1 §2.7) is only for when the A1-② spike fails — until then, leave it alone.

## LinkedIn (persistent Playwright profile, A1 §2.9)

1. `playwright install chromium` on the mini
2. Launch Chromium through Playwright and **log in to LinkedIn manually once** (2FA included)
3. Preserve that profile directory (cookies/localStorage) as-is — **minimize re-logins**
   (a design choice to avoid the 20-second session-death bug in `mautrix/linkedin#55`, A1 §2.9)
4. Do not store the credentials themselves — no Keychain entry (A1 §1.3 table). The profile directory
   is itself a secret, so handle it with care when backing up or migrating.
5. Poll at a randomized 5–15 minute interval — no bulk profile views (account-suspension risk,
   A1 §2.9).

## Codex CLI login

The mini's `local-agent` bridges Codex (A6 §10.2). Codex CLI's own authentication is required:

```bash
codex login
```

A browser OAuth window opens — run this in a mini GUI session (headless `codex app-server` reuses the
authentication already present in the login shell session, A6-D10). To check whether `codex app-server`
responds correctly over JSON-RPC after login, use the A6 §11 spike ⑦ procedure
(`codex app-server generate-json-schema`).

## Verification

`pnpm auth:verify` does not check these four — KakaoTalk/LinkedIn have no Keychain entries, and
Beeper/Codex have no API round-trip check logic in verify.ts yet (only Slack/Gmail/Calendar are wired,
`tools/auth-kit/verify.ts`). Verify each one individually through the "Check" step of its procedure
(the kmsg command above, the successful LinkedIn login screen, the `codex app-server` spike).
