# Account Connection Checklist

In order. Finishing just the three Phase A items (Slack/Gmail/Calendar) completes onboarding — the rest when you need them.

## Phase A — Now (MacBook, ~25 min total)

1. **Slack** (~10 min) — [`slack/README.ko.md`](slack/README.ko.md)
2. **Gmail + Calendar** (~15 min, both from one Google consent) — [`google/README.ko.md`](google/README.ko.md)
3. Verify:
   ```bash
   cp tools/auth-kit/accounts.example.json tools/auth-kit/accounts.local.json
   # open accounts.local.json and fill in teamId/email
   pnpm auth:verify
   ```
   Done once all three rows — `slack`/`gmail`/`gcal` — read `keychain=ok api=ok`.

## Phase B — Later (no adapters yet; console steps only, for a preview)

4. **Outlook** — [`outlook/README.ko.md`](outlook/README.ko.md)
5. **Telegram** — [`telegram/README.ko.md`](telegram/README.ko.md)

## Phase C — At the mini (GUI session required, ~30 min)

6. **KakaoTalk / WhatsApp (Beeper) / LinkedIn / Codex sign-in** —
   [`mini/README.ko.md`](mini/README.ko.md)

## If you get stuck

- `pnpm auth:verify` reporting `keychain=missing`: the `detail` column prints the **name of the missing
  item** verbatim. Check that the name you stored with `tools/auth-kit/keychain-add.sh` matches it
  exactly (see the "Storing in the Keychain" section of each README). Slack needs both the
  `...xoxb.<team_id>` and the `...xoxb.<team_id>.app` item before it reports `keychain=ok`.
- `api=fail`: the token was revoked or the scopes are insufficient — the `detail` column prints the error
  message verbatim (the token value itself is never printed).
- Values are never written down anywhere a second time — if one is wrong, re-run `keychain-add.sh` (`-U`
  overwrites it).
