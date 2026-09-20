# Mini Operations Runbook (hub · zero-cache · local-agent)

Target: `vigors-mac-mini` (<hub-host>, tailnet `your-tailnet.ts.net`), user `vigor`, repo `/Users/vigor/omnis`.
Everything is **LaunchAgents, no sudo**. From the MacBook, `ssh <hub-user>@<hub-host>` connects without a password.

| | |
|---|---|
| Services | `com.omnis.hub` (127.0.0.1:8787) · `com.omnis.zero-cache` (:4848) · `com.omnis.local-agent` (Codex bridge) |
| plist source | `ops/mini/com.omnis.*.plist` (templates) → `~/Library/LaunchAgents/` (install.sh substitutes them) |
| Entry point | `ops/mini/run.sh <service>` — sources `ops/mini/env.sh` to export Keychain secrets, then execs |
| Logs | `~/Library/Logs/omnis/{hub,zero-cache,local-agent}.{log,err.log}` |
| DB | `postgres://vigor@127.0.0.1:5432/omnis` (miniflux shares this cluster — do not touch it) |
| External exposure | `https://your-hub.your-tailnet.ts.net/…` → 127.0.0.1:8787 (tailnet only, **no prefix strip** — the path arrives exactly as the hub route) |

> **Do not touch the mini's existing infrastructure**: Hermes/omh/buzz (`~/.hermes`, port 8642), colima, miniflux, recap-server (:8090).

## Install (one time)

```bash
# 1) Push the repo from the MacBook
cd <worktree> && rsync -az --delete \
  --exclude node_modules --exclude target --exclude .git --exclude ops/mini/env.sh \
  ./ <hub-user>@<hub-host>:/Users/vigor/omnis/

# 2) On the mini (ssh <hub-user>@<hub-host>)
export PATH=/opt/homebrew/bin:$PATH
npm i -g pnpm@9.12.3                 # with brew node 26's npm
brew install pgvector                # CREATE EXTENSION vector in 0001_extensions.sql
cd /Users/vigor/omnis && pnpm install --prod=false --frozen-lockfile && pnpm build

# 3) DB
createdb -U vigor omnis
psql -U vigor -d omnis -c "CREATE SCHEMA IF NOT EXISTS zero_cvr"
psql -U vigor -d postgres -c "ALTER SYSTEM SET wal_level='logical'" && brew services restart postgresql@17
DATABASE_URL="postgres://vigor@127.0.0.1:5432/omnis" pnpm db:migrate
ZERO_UPSTREAM_DB="postgres://vigor@127.0.0.1:5432/omnis" OMNIS_USER_ID=logan pnpm zero:deploy-permissions
```

### 4) Secrets (A6 §9)

**Keychain is unusable from an ssh shell** — the login session is `Background`, so `security` refuses with
"User interaction is not allowed". Creating items **must run in a GUI session (gui/501)**:
put the script in `/tmp`, run it once via a one-shot LaunchAgent with `launchctl bootstrap gui/501`, then read the result from the log.
(Reads are fine in normal operation because the LaunchAgent runs in gui/501.)

Three items — the names follow the A1/A6 §9 scheme exactly:

| service | Used by |
|---|---|
| `omnis.bridge.token.mini` | hub `OMNIS_BRIDGE_TOKEN` ↔ local-agent reads it directly from Keychain |
| `omnis.zero.auth_secret` | hub `ZERO_AUTH_SECRET` ↔ zero-cache (the values must match) |
| `omnis.zero.admin_password` | zero-cache production mode boot condition |

The account is `281932556+jinhologankim@users.noreply.github.com` for all of them. Values come from `openssl rand -hex 32` (24 for admin).
**Never leave any value in a log, a commit, or shell history.**

### 5) Services

```bash
cd /Users/vigor/omnis && bash ops/mini/install.sh        # all three. A single one can also be passed as an argument
```
install.sh lays down `ops/mini/env.sh` (from `env.sh.example` if absent) and `~/.omnis/local-agent.toml`
(from `local-agent.toml.example` if absent), substitutes the plists, and bootstraps them into `gui/$(id -u)`.
`env.sh` is **not committed** (.gitignore) — every value is a Keychain lookup.

### 6) tailnet exposure

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --set-path=/ http://127.0.0.1:8787
```
Mount it at `/` — because Serve **strips** the prefix given by `--set-path` before handing the request to the backend,
mounting at `/api` would deliver the hub's `/api/zero-token` as `/zero-token` and 404. More specific paths win,
so the existing `/recaps` (:8090) mount stays alive. Check with `serve status`.

## Update (when the code has changed)

```bash
# MacBook
cd <worktree> && rsync -az --delete \
  --exclude node_modules --exclude target --exclude .git --exclude ops/mini/env.sh \
  ./ <hub-user>@<hub-host>:/Users/vigor/omnis/
# mini
ssh <hub-user>@<hub-host> 'export PATH=/opt/homebrew/bin:$PATH; cd /Users/vigor/omnis &&
  pnpm install --prod=false --frozen-lockfile && pnpm build &&
  DATABASE_URL="postgres://vigor@127.0.0.1:5432/omnis" pnpm db:migrate &&
  for s in hub zero-cache local-agent; do launchctl kickstart -k "gui/501/com.omnis.$s"; done'
```
If `packages/kernel/src/zero-schema.ts` or `OMNIS_USER_ID` changed, run `pnpm zero:deploy-permissions` once more
**before** restarting zero-cache — otherwise the queries resolve but return 0 rows.

> `--delete` removes files that exist only on the mini. `ops/mini/env.sh` is in the exclude list, so it survives.
> If you leave out `--exclude dist`, artifacts built on the MacBook overwrite things — just run `pnpm build` again on the mini.

## Re-embedding (when the model or the prefixes changed)

If `EMBED_MODEL`, `EMBED_DOCUMENT_PREFIX` or `EMBED_QUERY_PREFIX` in
`packages/memory/src/embed.ts` changes, **the vectors already stored live in a different space than the new
query vectors** — search silently gets worse. There is no version column (it does not change often enough to
warrant one), so throw the whole lot away at once and backfill.

```bash
ssh <hub-user>@<hub-host> 'psql omnis -c "UPDATE memories SET embedding = NULL WHERE invalidated_at IS NULL"'
```

`drive_poll` (every 10 min) backfills 100 rows per tick via `reembedNulls()` — about 17 hours for 10k rows. If
you are in a hurry, just leave it alone after the SQL above while Ollama is up, rather than restarting
`pnpm --filter @omnis/hub start` on the mini. Check progress with `psql omnis -c "SELECT count(*) FROM memories
WHERE embedding IS NULL AND invalidated_at IS NULL"`.

> While the backfill runs, those rows do not show up in search (the partial HNSW index does not index NULL).
> The prefix rollout of 2026-09-21 (`search_document: ` / `search_query: `) is the first case that needed this.

## Web Push VAPID keys (US-B16)

```bash
bash ops/scripts/gen-vapid.sh --check     # checks existence only, changes nothing
bash ops/scripts/gen-vapid.sh             # creates only when absent (refuses if either one exists)
bash ops/scripts/gen-vapid.sh --force     # rotate (immediately on suspected leak; routinely once a quarter — A6 §9)
```

**The keys live on exactly one machine, the mini.** The hub uses the keys and the hub only runs on the mini —
it is normal for the MacBook's login Keychain to have no `omnis.webpush.*` items, and on the MacBook `--check`
should exit 1 with `missing omnis.webpush.vapid_public` (that is the designed behavior of this command). Do not
generate keys on the MacBook — even if you do, the hub cannot read them, and you have only created one more real secret.

**Generation does not work from an ssh shell** — for the same reason as the "4) Secrets" item above,
`security add-generic-password` is refused in a `Background` session. Generation and rotation on the mini are done
by putting a one-shot LaunchAgent into gui/501 and running it.

### Rotation procedure, 6 steps (A6 §9)

1. **Issue new values** — `bash ops/scripts/gen-vapid.sh --force` (in a gui/501 session). The script generates a
   new P-256 key pair with `node:crypto`. Unlike other secrets that require reissuing from a channel console,
   the issuing authority here is ourselves.
2. **Store** — the same command overwrites Keychain `omnis.webpush.vapid_public` / `…vapid_private`
   (`-U`). In this repo, Keychain takes the place of the `sops secrets/<host>.enc.yaml` step from the original A6 §9.
3. **git commit — not applicable.** The VAPID keys do not exist as files, so there is nothing to commit. If a value
   lands in a diff, a log, or shell history, that itself is the leak. The only thing worth committing is a procedure
   change (this document).
4. **Restart** — `launchctl kickstart -k gui/$(id -u)/com.omnis.hub`. The hub re-reads
   `OMNIS_WEBPUSH_VAPID_PUBLIC`/`…PRIVATE` via `env.sh` (the wiring is US-B17). A full reboot is unnecessary.
5. **Verify** — confirm the restart did not break the service. Check that the healthchecks.io hub job sends a
   successful ping on its next cycle (job wiring is US-B43), and before that confirm `curl -s http://127.0.0.1:8787/health`
   returns `{"ok":true,...}`. If it fails, start with `~/Library/Logs/omnis/hub.log`.
6. **Audit record** — record the rotation event in `audit_log`. **Never put the key values in it** — leave only the
   service names and the time.
   ```bash
   psql -U vigor -d omnis -c "INSERT INTO audit_log (actor, action, target_table, after) \
     VALUES ('me', 'secret.rotate', 'keychain', \
             '{\"services\":[\"omnis.webpush.vapid_public\",\"omnis.webpush.vapid_private\"]}'::jsonb)"
   ```

Rotating invalidates every subscription created with the previous VAPID key — right after rotating, clear
`push_subscriptions` and have the devices resubscribe (the cleanup logic is US-B17).

## Backup · restore drill (US-B41)

Every day at 03:00 the LaunchAgent `com.omnis.backup` runs `ops/scripts/omnis-backup.sh`:
`pg_dump --format=custom` → `$HOME/omnis-var/backup/pg/omnis-YYYYMMDD.dump` → `restic backup` → B2,
then `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune` and cleanup of local dumps older than 7 days.
Success/failure is reported by exit code only (the healthchecks.io wiring is US-B42).

First time only (mini, gui session):

```bash
brew install restic                                    # pg_dump is already in postgresql@17
# 4 Keychain items — do not paste the values, enter them at the prompt (omit -w). Refused from an ssh shell (see "4) Secrets").
for s in omnis.restic.repository omnis.restic.password omnis.b2.account_id omnis.b2.account_key; do
  security add-generic-password -U -s "$s" -a 281932556+jinhologankim@users.noreply.github.com -w
done
restic -r "$(security find-generic-password -s omnis.restic.repository -a 281932556+jinhologankim@users.noreply.github.com -w)" init
bash ops/scripts/omnis-backup.sh --check               # checks pg_dump, restic, and the 4 Keychain items only
ops/mini/install.sh backup                             # schedules 03:00 (no kickstart — it only loads the job)
```

`restic init` is not done by the script — repo creation is a one-time thing, so no existence check is baked into every run.

Quarterly restore drill:

```bash
bash ops/scripts/restore-drill.sh --dry-run   # only checks that the newest dump is readable (restores nothing)
bash ops/scripts/restore-drill.sh             # actually restores into omnis_restore_drill on scratch port 5433 + row count
```

Running it without arguments appends PASS/FAIL to `backup/restore-drills.md`. A scratch instance must be up on
5433 (changeable with `OMNIS_RESTORE_PORT`), and that DB is dropped when the drill finishes.
On FAIL, fix it immediately as Sev1 rather than deferring to the next quarter (A6 §4).

## Health checks

```bash
launchctl print gui/501/com.omnis.hub | grep -E '^\s+(state|pid|last exit code) = '
curl -s http://127.0.0.1:8787/health                         # {"ok":true,"db":"up",...}
curl -s https://your-hub.your-tailnet.ts.net/health       # from the MacBook/iPhone
curl -so /dev/null -w '%{http_code}\n' \
  https://your-hub.your-tailnet.ts.net/api/zero-token       # 200 (the hub route really is /api/zero-token)
curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:4848/   # zero-cache → 200
grep '"bridge connected"' ~/Library/Logs/omnis/hub.log | tail -1   # confirm local-agent registration
psql -U vigor -d omnis -Atc \
  "SELECT slot_name, active, wal_status FROM pg_replication_slots"  # zero_0_a|t|reserved
bash ops/mini/preflight.sh --check   # FileVault · auto-login · pmset (3 no-sleep settings + autorestart=1 auto-boot on power restore) · 4 LaunchAgents · Ollama · slot, all at once (US-B43)
```

The `agent_runtimes` table is **not yet populated in Phase A** — `apps/local-agent/src/main.ts` comes up with an
empty adapter map, so it never sends the `register` notification. Use the single hub log line above to check bridge registration.

## Logs

```bash
tail -f ~/Library/Logs/omnis/hub.log          # one JSON line at a time
tail -50 ~/Library/Logs/omnis/zero-cache.err.log
```
There is no rotation yet (the 30-day logrotate in A6 §8 is Later). When it grows, trim it by hand.

## Rollback

1. Revert code only: run the **Update** procedure above once more, unchanged, from a worktree at the previous commit.
2. Stop services only: `launchctl bootout gui/501/com.omnis.<service>`
3. If zero-cache misbehaves, discard the replica file and restart it (upstream data is not lost):
   ```bash
   launchctl bootout gui/501/com.omnis.zero-cache
   psql -U vigor -d omnis -Atc "SELECT pg_drop_replication_slot('zero_0_a')"
   rm -f ~/omnis-var/zero-replica.db*
   launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.omnis.zero-cache.plist
   ```
4. There is no migration rollback (forward only). If you must revert, it is a `pg_dump` restore — backups are A6 §4, not yet implemented.

## Removal

```bash
for s in hub zero-cache local-agent; do
  launchctl bootout "gui/501/com.omnis.$s" 2>/dev/null
  rm -f ~/Library/LaunchAgents/com.omnis.$s.plist
done
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --https=443 --set-path=/ off   # keep /recaps
psql -U vigor -d omnis -Atc "SELECT pg_drop_replication_slot('zero_0_a')"   # slot first. Otherwise WAL accumulates
dropdb -U vigor omnis
rm -rf /Users/vigor/omnis /Users/vigor/omnis-var ~/.omnis ~/Library/Logs/omnis
# The 3 Keychain items, from a GUI session: security delete-generic-password -s omnis.bridge.token.mini -a 281932556+jinhologankim@users.noreply.github.com
```
`wal_level=logical` is not reverted — reverting it would require `ALTER SYSTEM RESET wal_level` + a Postgres restart,
and miniflux would drop along with it.

## What this deployment actually changed on the mini (2026-09-20)

| Time (UTC) | Change |
|---|---|
| 08:41 | `brew install pgvector` (0.8.6) |
| 08:42 | `createdb omnis`, `CREATE SCHEMA zero_cvr` |
| 08:42:55 | `ALTER SYSTEM SET wal_level='logical'` + `brew services restart postgresql@17` — **miniflux dropped for a few seconds**. Confirmed miniflux connectivity was normal after the restart. brew changed the service label from `homebrew.mxcl.postgresql@17` → `sh.brew.postgresql@17` (brew 7.x behavior, no duplication) |
| 08:43 | Migrations 0001–0008 applied (`omnis` DB) |
| 08:45 | 3 Keychain items created, 3 LaunchAgents bootstrapped |
| 08:45 | `zero:deploy-permissions` (hash 6ed5e84) |
| 08:48 | `tailscale serve --bg --https=443 --set-path=/api http://127.0.0.1:8787` — existing `/recaps` mount unchanged |
| 11:3x | `tailscale serve --bg --set-path=/ http://127.0.0.1:8787` + `--set-path=/api off` — `/api/zero-token` was 404ing because of the `/api` prefix strip. It now mounts at `/` verbatim (`/health` 200, `/api/zero-token` 200, `/recaps` still 200) |

`npm i -g pnpm@9.12.3` was installed at this time too. Postgres's memory parameters (A6 §4) were **left untouched**.
