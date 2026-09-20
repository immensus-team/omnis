# Telegram (mtcute) Connection (A1 §2.5) — Phase B

**The adapter code does not exist yet** — there is no telegram directory under
`packages/adapters/`, and `mtcute` is not imported anywhere in the repository (a full
`grep -ri mtcute` as of Wave 5 returns nothing). The interactive login flow (QR or phone+code) is
**not implemented at all** — below are only the console steps to follow when Phase B begins, and
this kit contains no runnable script.

## Issuing `api_id`/`api_hash`

1. Log in at https://my.telegram.org
2. **API development tools** → create an app → `api_id`/`api_hash` issued
3. **Never distribute publicly** (A1 §2.5 verified) — do not commit these values to code; keep them
   in Keychain only

## Login (Phase B, after the adapter is implemented)

A1 §2.5 design: initialize the mtcute client → first pairing is either QR login (render the QR on
the omnis screen → scan it with the iPhone) or phone+code (if 2FA is enabled, additionally enter
the cloud password) → save the mtcute built-in SQLite session file locally, and keep only the
encryption key wrapping that file in Keychain.

## Keychain (applies after the adapter is implemented)

A1 §1.3: `omnis.telegram.session_key` (external_id omitted because multi-account is not supported).

```bash
tools/auth-kit/keychain-add.sh omnis.telegram.session_key
```

Running this command today will not make `pnpm auth:verify` produce a telegram row — with no
adapter there is no API call to verify against in the first place.
