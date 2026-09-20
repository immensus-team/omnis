# Slack Connection (A1 §2.1)

Estimated time: 10 minutes.

## 1. Create the app (from a manifest)

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. Select a workspace → paste the contents of `tools/auth-kit/slack/manifest.yaml` → **Create**
3. Left menu **Socket Mode**: confirm it is already enabled by the manifest. You still need to
   create an **App-Level Token** — **Basic Information → App-Level Tokens → Generate Token**,
   scope `connections:write`, name anything (e.g. `socket`). The issued token looks like
   `xapp-...` — that is the App-Level Token.

## 2. Install

1. **OAuth & Permissions** → **Install to Workspace** → **Allow** on the permission review screen
   (installing into your own workspace, so it is approved immediately, A1 §2.1)
2. After installation, two tokens appear on this screen:
   - **Bot User OAuth Token** — `xoxb-...`
   - **User OAuth Token** — `xoxp-...`

## 3. Copy the three tokens

| Token | Format | Where |
|---|---|---|
| Bot (xoxb) | `xoxb-...` | OAuth & Permissions |
| User (xoxp) | `xoxp-...` | OAuth & Permissions |
| App-Level | `xapp-...` | Basic Information → App-Level Tokens |

Also note the workspace's **Team ID** (the value starting with `T` in the OAuth & Permissions
page URL or in workspace settings → About).

## 4. Store in Keychain

Use exactly the names the adapter code (`packages/adapters/slack/src/index.ts` `connect()`) reads —
replace `<team_id>` with the Team ID you noted above, then run:

```bash
tools/auth-kit/keychain-add.sh "omnis.slack.xoxb.<team_id>" "<team_id>"
# paste xoxb-... at the value prompt

tools/auth-kit/keychain-add.sh "omnis.slack.xoxb.<team_id>.app" "<team_id>"
# paste xapp-... at the value prompt
```

(The xoxp user token is not used by the v1 send path yet — `packages/adapters/slack/src/index.ts`
currently reads only xoxb. If it becomes necessary, add `omnis.slack.xoxp.<team_id>` the same way.)

Never leave the values in shell history or logs — `keychain-add.sh` reads them only through a
`read -s` prompt (A6 §9).

## 5. Verify

```bash
pnpm auth:verify
```

You are done when the `slack` row shows `keychain=ok api=ok` — `keychain=ok` means **both** of the
two entries from step 4 (`...xoxb.<team_id>` and `...xoxb.<team_id>.app`) are present. If you added
only one, `keychain=missing` appears and the `detail` column prints the name of the missing entry.
If `api=fail`, the token was revoked or pasted incorrectly — start over from steps 1–2.
