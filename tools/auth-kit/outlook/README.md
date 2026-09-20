# Outlook / Microsoft 365 Connection (A1 §2.4) — Phase B

**The adapter code does not exist yet** (as of Wave 5, `packages/adapters/` holds only
slack/gmail/google-calendar — there is no outlook directory at all). Below are only the console
steps to follow when Phase B begins — Keychain storage/verify will be filled in here once the
adapter exists.

## Entra ID (Azure AD) app registration

1. https://entra.microsoft.com → **App registrations → New registration**
2. **Account types**: "Accounts in any organizational directory and personal Microsoft accounts"
   (`/common` authority) — a single registration covers personal Outlook.com and corporate M365 (A1 §2.4)
3. **API permissions → Add a permission → Microsoft Graph → Delegated**:
   - `Mail.ReadWrite`
   - `Mail.Send`
   - `Calendars.ReadWrite`
4. Publisher verification is for multi-tenant distributed apps only, so it is not required for a
   personal single-user app (A1 §2.4 verified)
5. One-time consent via the authorization code flow → refresh token issued

## Keychain (applies after the adapter is implemented)

Per the A1 §1.3 scheme, the name is `omnis.outlook.<upn>` (upn = login email). Once the adapter exists:

```bash
tools/auth-kit/keychain-add.sh "omnis.outlook.<upn>" "<upn>"
```

Running this command today will not make `pnpm auth:verify` produce an outlook row — the channel
has not been registered in verify.ts yet (because the adapter itself does not exist).
