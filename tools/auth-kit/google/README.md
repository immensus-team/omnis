# Google connection — Gmail + Calendar (A1 §2.2, §2.3)

Estimated time: 15 minutes. **A single consent covers both Gmail and Calendar** — the same Cloud
project, the same OAuth client, and the same refresh token are reused
(comment in `packages/adapters/google-calendar/src/index.ts`: *"the caller passes
`omnis.gmail.<email>` to auth.keychainService verbatim (reuse)"*). Repeat this document from the
beginning for each additional account you connect.

## 1. Cloud project + APIs

1. https://console.cloud.google.com → create a new project (or select an existing project)
2. Enable the following under **APIs & Services → Library**:
   - Gmail API
   - Google Calendar API
   - Cloud Pub/Sub API (for Gmail push, A1 §2.2)

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External**
3. Add the `gmail.modify` and `calendar` scopes
4. Add your own email under Test users, then save
5. **You must publish to Production (Publish)** — leaving it in Testing status makes the refresh
   token expire after exactly 7 days (A1 §2.2 verified). **Publishing status → PUBLISH APP**

## 3. OAuth Desktop client

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Desktop app**
3. Once created, the **Client ID** and **Client secret** are shown — copy both

## 4. Pub/Sub topic (Gmail push, A1 §2.2)

```bash
gcloud pubsub topics create omnis-gmail
gcloud pubsub subscriptions create omnis-gmail-pull --topic=omnis-gmail
gcloud pubsub topics add-iam-policy-binding omnis-gmail \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

(Because it is a pull subscription, no public endpoint is needed — the mini polls outbound only,
A1 §2.2.)

## 5. Issuing a refresh token

The code does not yet have an in-app OAuth flow (`OAuthClient.connect()` in
`apps/desktop/src/screens/Onboarding.tsx` is only an interface injected for tests; there is no real
implementation — see "Verified / Not verified" below). Instead, obtain one as a one-off through
Google's official **OAuth 2.0 Playground**:

1. https://developers.google.com/oauthplayground
2. Settings (gear icon, top right) → check **Use your own OAuth credentials** → paste the Client
   ID/secret from step 3
3. Under **Step 1** on the left, type these directly into the scope input field:
   `https://www.googleapis.com/auth/gmail.modify` and
   `https://www.googleapis.com/auth/calendar`, one per line → **Authorize APIs** → sign in and
   consent with your own account
4. Under **Step 2**, **Exchange authorization code for tokens** → copy the **Refresh token** value
   (the access token can be discarded — a new one is issued on expiry, so `verify.ts` refreshes with
   the refresh token every time)

## 6. Storing in the Keychain

```bash
# refresh token — the name the adapter actually reads (shared by Gmail and Calendar, A1 §1.3)
tools/auth-kit/keychain-add.sh "omnis.gmail.<email>" "<email>"

# OAuth client — an entry that is not in the spec table (the client is an app-wide secret rather
# than a per-account one, so the omnis.<service>.<kind> extension rule applies as-is, A6 §9).
# hub/desktop have no wiring that reads this value from config yet (unwired as of Wave 5), so
# verify.ts reads it directly from here for the time being.
tools/auth-kit/keychain-add.sh omnis.google.oauth_client_id
tools/auth-kit/keychain-add.sh omnis.google.oauth_client_secret
```

`<email>` is your Gmail address verbatim (for example, `281932556+jinhologankim@users.noreply.github.com`).

## 7. Verification

```bash
pnpm auth:verify
```

If the `gmail`/`gcal` rows show `keychain=ok api=ok`, you are done.

## Verified / Not verified

- The only Keychain entry the code actually reads: `omnis.gmail.<email>` (shared by Gmail and
  Calendar) — verified
  (`packages/adapters/gmail/src/keychain.ts`, `packages/adapters/google-calendar/src/index.ts`).
- The OAuth client id/secret are values injected into the adapter constructor
  (`GmailAdapterDeps.oauthClientId/oauthClientSecret`), but neither hub nor desktop has any wiring
  that reads this value from config or env yet (confirmed as of Wave 5; there are no Google-related
  fields in `apps/hub/src/config.ts`). The `omnis.google.oauth_client_*` Keychain names are a
  provisional convention this kit chose arbitrarily — they may change to official names in the wave
  where the hub wiring lands.
- We expected the Onboarding screen (`apps/desktop/src/screens/Onboarding.tsx`) to have a "path that
  reads the downloaded client JSON", but in reality there is only the injected interface
  `OAuthClient.connect()` and no implementation — so this document substitutes the manual OAuth
  Playground path (see §5 above).
