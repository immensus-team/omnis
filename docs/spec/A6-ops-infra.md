# A6 — Operations & Infrastructure

Version 1.0 (2026-09-20, pass 2). Basis: `00-omnis-design.md` v1.0 (D1–D16, especially D7·D9·D11·D12), `99-review.md`, `99-review-v2.md`, `A1-channel-adapters.md` §4, `A2-agent-session-bridge.md` §2.1, `research/18-mac-mini-hub-ops.md`, `research/09-agents-as-inbox.md`, `research/13-client-arch-sync.md`, `research/27-gap-event-volume-and-sync-budget.md`, `research/15-security-privacy.md`, `research/25-gap-standalone-and-kakao-session-rule.md`, `research/20-gap-eve-self-host-spike.md`.

This appendix brings master design §15 (Operations), §16 (Phase 0), D11 (separating hub operations), and D12 (redefining standalone) down to an implementable level. Where it conflicts with a decision in the master document, the master wins — this appendix only extends.

## Decisions This Appendix Locks In

| # | Decision | Basis | Fallback |
|---|---|---|---|
| A6-D1 | Mini processes are fixed per the table (§1) as 5 LaunchDaemons (Postgres, omnis-hub, zero-cache, Ollama, healthcheck ping) / 4 LaunchAgents (kmsg watch, Playwright profile, Beeper Desktop, local-agent) | TN2083: daemons cannot connect to the window server (`18`) | None — this is a structural constraint with no alternative |
| A6-D2 | Try FileVault ON first (spike ③; per §2 item 8 this runs before §2 item 1), and only if that result is a fail (automatic login is blocked) turn it OFF, while simultaneously narrowing exposure to tailnet-only (no Funnel, Tailscale ACL only); this switch requires Logan's approval | Whether automatic login is possible with FileVault ON is unconfirmed for macOS 26.6 in primary documentation (`18`) | OFF + tailnet-only + physical security (controlled space) as compensation |
| A6-D3 | Keep an `omnis-reapply-settings` LaunchAgent that re-applies `pmset`, `caffeinate`, and the automatic login setting on every boot/login | macOS updates resetting power settings is common in practice (`18`, UNVERIFIED but stated as operational common sense) | None |
| A6-D4 | Postgres **pinned to 17** + pgvector, with `idle_replication_slot_timeout = '3d'` set explicitly | A default of 0 (disabled) risks unbounded WAL accumulation (`27`); the version aligns with A3/A7 per 99-review §1.2 | The slot healthcheck trips first, so a human can intervene before the 3 days elapse |
| A6-D5 | zero-cache is deployed reduced to a 1.5GB total cap rather than the official recommendation (Replication 2GB + View Syncer 4GB) | omnis is 1 user with 2–3 devices, so throughput ceilings never bind (`27`); the 16GB budget is the real constraint (`18`) | If measurement shows it is insufficient, raise the cap in steps |
| A6-D6 | Ollama ships `nomic-embed-text-v1.5` as a fixed install; the 1–3B classifier is not installed until spike results are in (T0 starts rule-based) | The embedding model is locked in master D6/D10. Candidate classifier model names are absent from the 6 research files | If the spike fails, keep rule-based and escalate only ambiguous cases to T1 (DeepSeek) |
| A6-D7 | The 16GB budget split follows the §7 table: OS 2GB / Postgres 3GB / hub 1GB / zero 1.5GB / Ollama 1GB / kmsg 0.2GB / Playwright 0.8GB / Beeper 0.4GB / healthcheck 0.05GB / local-agent (mini) 0.2GB, with the remaining ~5.8GB as headroom | Sum of individual components' claimed figures; no integrated measurement exists in the research (`18` Open Questions) | Measure with Spike A6-9 and redistribute (required before Phase A ends) |
| A6-D8 | healthchecks.io starts with the 15 jobs in the §8 table (including the added mini local-agent, within the free tier's 20 limit); ntfy topics split into 2 tiers, `omnis-critical`/`omnis-warning` | Free tier limit of 20 jobs (`18`) | Upgrade to Business at $20/month (100 jobs) |
| A6-D9 | The Keychain naming rule follows exactly the dot (`.`) separated scheme `omnis.<channel>.<kind>.<external_id>` that A1 already locked in via code examples (`keychainService: "omnis.slack.xoxp"` etc.) (e.g. `omnis.slack.xoxb.<team_id>`, `omnis.gmail.<email>`, `omnis.telegram.session_key` — a single secret with no external_id stops at `<kind>`). Services that are not channels (Anthropic API key, macbook/mini local-agent session bus token, etc.) extend the same scheme as `omnis.<service>.<kind>`. Existing assets (`deepseek-api` etc.) are reused as-is without regeneration | A1-channel-adapters.md §1.3 AuthRef and the per-Adapter onboarding section's code examples. The hyphen scheme (former A6-D9) conflicted with A1 and was dropped (99-review §1.2) | None |
| A6-D10 | `local-agent` on both the MacBook and the mini is a login-session LaunchAgent (not a root LaunchDaemon) | CLI agents (`claude`/`codex`) depend on the user shell environment and Keychain session (extending the daemon/agent distinction principle in `18`). The mini's local-agent exposes only Codex and Hermes, so the `codex` CLI is what is at stake; `codex app-server` itself is a headless JSON-RPC process that needs no GUI access (`09`), but the CLI execution path still depends on login-shell PATH, nvm, and the Keychain session, exactly as on the MacBook — and moreover, per A6-D1 the mini must keep a GUI session alive at all times anyway for KakaoTalk, Playwright, and Beeper, so adding local-agent to that session costs nothing extra. This reasoning is a deduction from the principle given by `18`/`09`, not a fact stated directly in either file | None |
| A6-D11 | Even in Phase D standalone, the KakaoTalk/LinkedIn capture host stays on the mini by default (demoted to a "capture sidecar"); full retirement is a separate decision | Keeping the mini is the cheapest workaround; switching to MacBook-only creates capture gaps during sleep/travel (`25`) | MacBook clamshell + always-on power — Later, hardware wear risk unverified |
| A6-D12 | Of the 14 Phase 0 (2-week) gates, the 8 A6 runs directly (①~⑧) are locked in with §11 procedures, pass criteria, and a record table; the other 6 (A1-④·⑤, S-A2-1·2, S-A3-2, A7-1) are listed by reference to the owning appendix's original text only. The 2 A6-specific additional spikes (16GB integrated measurement = A6-9, Ollama classifier selection = A6-10) belong to the "16 at Phase entry" list and are required before Phase A ends (99-review §5) | Master §16, 99-review §5 | None |

---

## 1. Mini Process Placement Table

As TN2083 states, **LaunchDaemons run in the global bootstrap namespace and cannot connect to the window server** — launching a GUI-requiring process as a daemon is not a configuration mistake, it is simply impossible (`18`). kmsg, which reads the AX tree of KakaoTalk.app, the resident browser profile for LinkedIn, and Beeper Desktop (an Electron GUI app) must all go in `~/Library/LaunchAgents`, bound to the logged-in user session, while headless API/DB/inference servers go in `/Library/LaunchDaemons`.

| Process | Type | Reason | KeepAlive | Log path | Env var injection |
|---|---|---|---|---|---|
| Postgres | LaunchDaemon | No GUI needed; needed immediately at boot (other services must be able to attach even before login) | `true` | `/usr/local/var/log/postgresql@17.log` | `PGDATA` decrypted via `sops`; the superuser password is replaced by local peer authentication (no remote exposure) |
| omnis-hub (Node) | LaunchDaemon | Kernel API, scheduler, session bus, headless | `true` + `ThrottleInterval 10` | `~/Library/Logs/omnis/hub.log` (separate `StandardOutPath`/`StandardErrorPath`) | A wrapper script decrypts `secrets/mini.enc.yaml` and exports `DATABASE_URL`, channel OAuth client secrets, etc., then execs |
| zero-cache | LaunchDaemon | Postgres replication consumer, headless | `true` | `~/Library/Logs/omnis/zero-cache.log` | `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB` (separate connection, `27`), `ZERO_REPLICA_FILE` |
| Ollama | LaunchDaemon | HTTP inference server, no GUI needed | `true` | `~/Library/Logs/omnis/ollama.log` | `OLLAMA_HOST=127.0.0.1:11434` (not exposed to the tailnet; only the hub calls it) |
| healthcheck ping | LaunchDaemon | A watchdog that must stay alive independently even if every other process dies | `false` (periodic run) + `StartInterval 300` | `~/Library/Logs/omnis/healthcheck.log` | `HC_UUIDS` (list of healthchecks.io ping URLs) |
| kmsg watch | LaunchAgent | Reading KakaoTalk.app's Accessibility (AX) tree requires a window server session (TN2083, `18`) | `true` | `~/Library/Logs/omnis/kmsg.log` | `KMSG_OUTPUT_SOCKET` (local HTTP/Unix socket to the hub) |
| Playwright resident profile (LinkedIn) | LaunchAgent | Keeps a human-like session via a real browser window (non-headless); GUI required | `true` | `~/Library/Logs/omnis/linkedin-bridge.log` | `LINKEDIN_PROFILE_DIR` |
| Beeper Desktop | LaunchAgent | Electron GUI app; provides a local WhatsApp REST/WS API | `true` | `~/Library/Logs/omnis/beeper.log` | The app keeps local state after a one-time QR/login — no separate env needed; Beeper manages its own token |
| local-agent (mini) | LaunchAgent | Codex CLI / Hermes bridge. No GUI access needed, but the dependence on login-shell PATH and Keychain session is the same as on the MacBook (A6-D10) — and the GUI session must be alive at all times for the 3 Agents above anyway, so there is no extra cost | `true` | `~/Library/Logs/omnis/local-agent-mini.log` | Session bus auth token from `secrets/mini.enc.yaml`, `HERMES_BASE_URL=http://127.0.0.1:8642` (local only) |

No separate IPC is designed for communication between Daemons and Agents — omnis-hub already listens on local HTTP (`127.0.0.1:8787`) (8642 is avoided because Hermes `api_server` already uses it, master §4.2/§15), so it is enough for the kmsg/Playwright/Beeper/local-agent side Agents to push events to the hub over HTTP (adopting `18`'s recommendation verbatim: "communication between the two layers already happens over local HTTP, so no additional IPC design is needed"). local-agent is the sole exception, also connecting locally to Hermes (`127.0.0.1:8642`) — this connection is closed within the mini and is not exposed to the tailnet.

**Process supervision tooling**: `18` proposes pm2 as a convenience layer, but the omnis MVP has 8 processes, so managing the launchd plists by hand is not much of a burden — master D11 also does not mention pm2 and specifies only the LaunchDaemon/LaunchAgent split. pm2 is revisited Later at the point where the service count grows and log rotation / crash-loop visibility actually becomes painful (after Phase C, once there are 5+ channel sidecars) (pm2 ultimately generates launchd plists internally, so the daemon/agent split principle itself does not change, `18`).

### plist example 1 — LaunchDaemon (omnis-hub)

```xml
<!-- /Library/LaunchDaemons/ai.onwordlab.omnis-hub.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-hub</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>mini</string>
    <string>/usr/local/bin/node</string>
    <string>/opt/omnis/hub/dist/main.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/Users/logan/Library/Logs/omnis/hub.log</string>
  <key>StandardErrorPath</key><string>/Users/logan/Library/Logs/omnis/hub.err.log</string>
  <key>UserName</key><string>logan</string>
  <key>WorkingDirectory</key><string>/opt/omnis/hub</string>
</dict>
</plist>
```

`omnis-run-with-secrets.sh mini` decrypts `secrets/mini.enc.yaml` with `sops`+`age`, exports the top-level keys as environment variables, then `exec`s the remaining arguments (§9). Even with `UserName` specified, a LaunchDaemon runs in the daemon namespace and still cannot connect to the window server — this entry only decides "which Unix user's privileges files are written with" and is unrelated to GUI access (`18`).

### plist example 2 — LaunchAgent (kmsg watch)

```xml
<!-- ~/Library/LaunchAgents/ai.onwordlab.omnis-kakao-bridge.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-kakao-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>mini</string>
    <string>/usr/local/bin/kmsg</string>
    <string>watch</string>
    <string>--json</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/logan/Library/Logs/omnis/kmsg.log</string>
  <key>StandardErrorPath</key><string>/Users/logan/Library/Logs/omnis/kmsg.err.log</string>
</dict>
</plist>
```

This file lives in `~/Library/LaunchAgents` (the `logan` user's home, not root) and is registered with `launchctl bootstrap gui/$(id -u logan)` — it must be attached to the GUI session namespace (`gui/<uid>`), not the daemon namespace (`system`), to access the window server.

---

## 2. Mini OS Configuration Procedure

1. **Automatic login**: Set System Settings → Users & Groups → Automatic login to the `logan` account. Whether this works with FileVault on is settled by the result of spike ③ (§11) — A6-D2.
2. **Keep the screen unlocked**: Disable the screen saver (System Settings → Lock Screen → "Start Screen Saver when inactive" → Never) and turn off "Require password after screen saver".
3. **`pmset`**: `sudo pmset -c sleep 0 displaysleep 0 disksleep 0` (AC power profile. The mini has no battery, so `-c` suffices rather than `-a`, `18`). It can be reset right after boot and after macOS updates, so it is included in the script in §2 item 5 (the re-apply LaunchAgent).
4. **`caffeinate` redundancy**: Keep a separate LaunchAgent that runs `caffeinate -disu &` at login so the session does not lock even if pmset is reset (`18` recommendation). All four flags are enabled: `-d` (prevent display sleep), `-i` (prevent idle sleep), `-s` (prevent system sleep), `-u` (simulate user activity, which in practice helps prevent screen locking).
5. **Boot-time re-apply LaunchAgent (`omnis-reapply-settings`)**: on every login (a) re-run `pmset -c sleep 0 displaysleep 0 disksleep 0`, (b) check whether a `caffeinate -disu` process is alive and start one if not, (c) check with `dscl` that the automatic login setting is still in place and alert the healthchecks.io `omnis-critical` topic immediately if it has drifted. This is a direct response to the observation that macOS updates resetting power settings is common in practice (`18`).
6. **Screen Sharing over tailnet**: turn on System Settings → General → Sharing → Screen Sharing. Access it from the built-in macOS screen sharing app via `vnc://<mini-hostname>.ts.net` or the tailnet IP (`100.x.x.x`) — Tailscale provides private IPs/MagicDNS, so it works as-is with no port forwarding or extra configuration (the principle checks out; a dedicated macOS guide document remains UNVERIFIED in `18`). Keep macOS's own "Only these users" restriction in place, but the primary line of defense is the Tailscale ACL (§3) — defense in depth.
7. **Unattended update policy**: turn off System Settings → General → Software Update → Automatic Updates (the default). Apply updates manually once a month while Logan is physically present or a Screen Sharing session is open, and verify before and after that the §11 re-apply script works correctly. Rationale: the FileVault-OFF / automatic-login combination is vulnerable to unexpected reboots (`18`), and unattended automatic updates can trigger such a reboot. Condition: if a security compliance requirement appears, turn on only "Install Security Responses and system files" automatically and keep major OS upgrades manual.
8. **FileVault spike procedure**: see §11 spike ③. In ordering, this item must run before item 1 — whether FileVault is on or off affects the automatic login setting itself.

---

## 3. Network

The mini opens no port directly to the public internet. All exposure goes through Tailscale (adopting `15`'s recommendation to "restrict the mini to tailnet-only" verbatim).

**Tailscale ACL example** (device-tag based, Grants syntax — re-confirm the exact current schema against the official Tailscale docs at implementation time; `15` notes that both the Grants (new) and ACL (legacy) syntaxes coexist):

```json
{
  "tagOwners": {
    "tag:hub": ["logan@onwordlab.ai"],
    "tag:client": ["logan@onwordlab.ai"]
  },
  "grants": [
    {
      "src": ["tag:client"],
      "dst": ["tag:hub"],
      "ip": ["tcp:443", "tcp:8787"]
    }
  ],
  "ssh": [
    {
      "action": "check",
      "src": ["tag:client"],
      "dst": ["tag:hub"],
      "users": ["logan"]
    }
  ]
}
```

The mini is tagged `tag:hub`; the MacBook and iPhone are tagged `tag:client`. The Postgres port (5432) and Ollama port (11434) are not placed in `dst` — clients reach only the hub API (bound to `127.0.0.1:8787` only; 8642 is avoided because Hermes `api_server` already uses it — master §4.2/§15) and HTTPS (443, listened on by `tailscale serve`), and Postgres, Ollama, and Hermes are used only through the hub (or the local-agent bridge inside the hub) process (minimizing attack surface, consistent with `15`'s tailnet-only principle).

**`tailscale serve` setup**: expose the hub API and the PWA under the same HTTPS endpoint at different paths.

```bash
sudo tailscale serve --bg --https=443 /api/ localhost:8787/
sudo tailscale serve --bg --https=443 / localhost:5173/   # PWA static serving (build artifact)
```

Tailscale issues `*.ts.net` certificates automatically (`15`). There is an open issue (#19147) where connecting to `<mini-hostname>.ts.net` from iPhone Safari fails with an SSL error, but in practice it has 5 comments and the likely cause was a third-party DoH/private-DNS app interfering with `.ts.net` name resolution (possibly not a Tailscale defect itself, per `13`'s adversarial re-verification). In spike ⑤ (§11), first check whether the iPhone has a DoH app/profile and re-test reproduction after removing it.

**MagicDNS**: leave it on (assumed enabled by default) — `<mini-hostname>.ts.net` is the default access path in spike ⑤. The IP (`100.x.x.x`) is used only as a fallback if MagicDNS fails.

**Funnel**: not used in principle (it exposes to the public internet, consistent with master §15 "Funnel only for the Calendar push spike"). Google Calendar `events.watch` cannot be received tailnet-only, because Google's servers send the webhook to a public HTTPS endpoint — turn it on temporarily with `tailscale funnel --bg 443 on` only during spike ① (§11), and turn it off with `tailscale funnel 443 off` the moment the spike ends (whether pass or fail). If the result is that Funnel must stay on permanently (i.e. push can only be practical with permanent public exposure), that becomes the basis for locking the channel matrix's Calendar fallback (master §8, `events.list` + syncToken polling) as the default — the master already designed it that way.

---

## 4. Postgres Configuration

- **Version**: **pinned to 17** via `brew install postgresql@17` (aligned with A3/A7, 99-review §1.2 — drifting phrasings like "16+" or "latest at install time" are retired). After `brew install pgvector`, run `CREATE EXTENSION vector;` in each DB.
- **Memory parameters (within the 16GB budget, matched to the 3GB Postgres allocation in §7)**:

```ini
# postgresql.conf excerpt
shared_buffers = 2GB
effective_cache_size = 6GB      # estimate including OS page cache, shared with other processes
work_mem = 32MB
maintenance_work_mem = 512MB
max_connections = 40             # headroom for hub + zero-cache + adapters
wal_level = logical              # required for Zero replication
max_wal_senders = 5
max_replication_slots = 5
idle_replication_slot_timeout = '3d'
```

- **`idle_replication_slot_timeout` set explicitly**: the default is 0 (disabled), so if zero-cache dies and is left alone, WAL can accumulate without bound and fill the disk (`27`). 3 days is the default — with KeepAlive=true, launchd restarts zero-cache the moment it crashes, so in normal operation the slot is almost never idle for more than a few seconds, and 3 days is the window in which the slot healthcheck (below) raises the alarm first even in a severe failure scenario like "the mini lost power for several days". Condition: if free disk space narrows below 50GB, shorten it to 1 day.
- **Slot healthcheck**: the healthcheck ping process (§1) queries slot state every 15 minutes with the command below and alerts the `omnis-critical` ntfy topic immediately if `active=false` persists for 10 minutes or more or `wal_status` approaches `lost` (§8, `omnis-pg-slot` job).

```bash
psql -U postgres -d omnis -Atc \
  "SELECT slot_name, active, wal_status, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal FROM pg_replication_slots;"
```
- **Backup**: run `pg_dump --format=custom` daily at 03:00 (local, a low-usage window) writing to `/opt/omnis/backup/pg/omnis-YYYYMMDD.dump`, and back up that file plus the self-model files (`USER.md`/`VOICE.md`/`PROJECTS.md`, git-tracked) and `secrets/*.enc.yaml` together via restic to Backblaze B2 (the `omnis-backup-mini` bucket, S3-compatible endpoint) as an encrypted incremental backup.

```bash
# /usr/local/bin/omnis-backup.sh (LaunchDaemon StartCalendarInterval Hour=3 Minute=0)
pg_dump --format=custom --file="/opt/omnis/backup/pg/omnis-$(date +%Y%m%d).dump" omnis
restic -r b2:omnis-backup-mini:/repo backup \
  /opt/omnis/backup/pg /opt/omnis/self-model /opt/omnis/secrets
restic -r b2:omnis-backup-mini:/repo forget \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
```

The retention policy (7 days / 4 weeks / 6 months) is a reasonable default with no fixed value in the research — adjust it if B2 costs or RPO requirements change.

- **Restore drill**: once a quarter, restore the latest `pg_dump` file into a scratch Postgres instance (separate port, e.g. 5433) with `pg_restore`, run a script that verifies the row counts of key tables (`items`, `threads`, `pending_approvals`) and that the latest `items.sent_at` is recent, then record the result in the drill log (`backup/restore-drills.md`). If it fails, fix it immediately as a Sev1 rather than deferring to the next quarter.

---

## 5. Zero (zero-cache)

- **Placement**: a LaunchDaemon on the mini per the §1 table. Replication Manager and View Syncer are not split into separate processes; they are started together as a single zero-cache process (at 1 user / 2–3 devices, the officially recommended multi-node setup is over-engineering, `27`).
- **Privileges**: create a dedicated role named `zero_replication` in Postgres, grant only the `REPLICATION` attribute, and do not make it a superuser. `ZERO_CVR_DB` (client view record storage) is specified with a separate connection string — it uses a separate schema (`zero_cvr`) in the same Postgres instance but is kept apart from the upstream schema to make the privilege boundary clear (reflecting `27`'s fact that "the CVR DB needs a separate connection").
- **Resource cap**: start at 1.5GB of memory (A6-D5). Zero's quantitative throughput ceiling is not published, but since it is a model that "scales by row count" (`27`), memory footprint is the real constraint at omnis scale rather than hitting a throughput ceiling.
- **Upgrade**: pin the exact version in `package.json` (`rocicorp/mono` is active but has 232 open issues, so there is drift risk, `13`). Before upgrading, start the new zero-cache version against a local scratch Postgres clone first to confirm migration/schema compatibility, and only then swap the binary path the mini's LaunchDaemon plist points at. Rollback is made possible within minutes by keeping the previous version's binary side by side and reverting only the path in the plist.

---

## 6. Ollama

- **Model list**: `nomic-embed-text-v1.5` (768-dimensional, local embeddings, already locked in master D6/D10 — the 274MB model size is cited in `18`'s TL;DR). None of the 6 research files this appendix read name a specific candidate for a 1–3B classifier — **UNVERIFIED — spike** (A6-Spike-10, §11). Until the spike, T0 classification (work/personal, priority) starts rule-based (sender channel default, sender domain, label keyword matching), and only items the rules judge ambiguous are escalated to T1 (DeepSeek) — this follows master §14's tier structure (T0→T1 escalation) exactly and is not a new policy.
- **Memory budget**: the nomic-embed model itself at 274MB plus Ollama runtime overhead is budgeted at a default of 1GB (§7). If the classifier passes the spike and is installed, the additional memory it needs updates the §7 budget using the spike's measurements — no estimated number is hard-coded now.
- **MacBook offloading rule**: models requiring more than 3B parameters or more than 2GB of memory are not put on the mini. This pulls the same principle master §14 states ("30B-class local inference only on the MacBook") down to a 3B boundary — the mini always does lightweight embedding/classification only, and when heavy local inference is needed it uses the MacBook's Ollama instance (the MacBook has 64GB, so there is ample room). `OLLAMA_HOST` is bound to `127.0.0.1` so it is not exposed directly to the tailnet and is called only through the hub.

---

## 7. Resource Budget Table (16GB, M4 mini)

| Component | Memory (estimated) | Basis |
|---|---|---|
| macOS + system overhead | 2.0GB | Typical headless macOS residency; no fixed figure in the research (empirical assumption) |
| Postgres (shared_buffers 2GB + processes) | 3.0GB | Based on the §4 settings |
| omnis-hub (Node) | 1.0GB | Typical Node process figure; no fixed value in the research |
| zero-cache | 1.5GB | A6-D5, reduced from the official recommendation (6GB) |
| Ollama (nomic-embed only) | 1.0GB | 274MB model + runtime (`18`) |
| kmsg watch | 0.2GB | AX polling script, assumed lightweight |
| Playwright resident profile (LinkedIn) | 0.8GB | Resident Chromium profile, typical figure |
| Beeper Desktop (Electron) | 0.4GB | Typical Electron app figure |
| healthcheck ping | 0.05GB | Lightweight cron script |
| local-agent (mini, Codex/Hermes bridge) | 0.2GB | Node process; assumed a lightweight bridge far lighter than the hub (1.0GB) — not a measured value |
| **Subtotal** | **~10.2GB** | |
| Headroom (OS cache, burst, future classifier, Colima if needed) | ~5.8GB | |

**Disk**: the mini's actual SSD capacity is outside this research's scope and therefore unconfirmed — the figures below assume a 512GB configuration (scale proportionally for a different capacity). Postgres data + WAL headroom 100GB, Ollama model cache 10GB, Playwright profile + browser cache 20GB, logs (logrotate, 30-day retention) 10GB, restic local staging (pre-upload cache) 50GB, the rest OS + free space. The disk alert (§8) fires when free space drops below 50GB.

This entire table is **a sum of individual components' claimed figures**, not an integrated measurement (the gap `18`'s Open Questions points at directly). A6-9 (§11, "8-process RSS ≤10GB") keeps its originally defined 8-process basis (Postgres, hub, zero-cache, Ollama, healthcheck, kmsg, Playwright, Beeper) exactly as named — the 0.2GB added for local-agent (mini) by this revision is included in the §7 subtotal, but the A6-9 gate name and pass criterion (≤10GB) are unchanged, and whether the measured value across 9 processes including local-agent exceeds that ceiling is also checked during the same measurement. **Both A6-9 and S-A4-5 (owned by A4, local embedding/classification cache hit ≥60%) are preconditions of the Phase A exit criteria (master §16) and therefore must run within Phase A (99-review §5)** — measure and update this table no later than the Phase A exit determination.

---

## 8. Monitoring

**healthchecks.io check list** (starting with 15 within the free tier's 20-job limit, `18`):

| Job slug | Target | Interval | Fail condition |
|---|---|---|---|
| `omnis-hub` | hub process heartbeat | 5 min | ping missing for 10 min |
| `omnis-postgres` | Postgres connectivity | 5 min | connection failure |
| `omnis-pg-slot` | Replication slot state | 15 min | `active=false` for 10+ min or `wal_status` at risk |
| `omnis-zero-cache` | zero-cache `/health` | 5 min | abnormal response |
| `omnis-ollama` | Ollama `/health` | 10 min | abnormal response |
| `omnis-adapter-slack` | Slack adapter | 15 min | consecutive failures |
| `omnis-adapter-gmail` | Gmail adapter | 15 min | consecutive failures |
| `omnis-adapter-calendar` | Calendar adapter | 15 min | consecutive failures |
| `omnis-adapter-kakao` | kmsg bridge (Phase C~) | 15 min | consecutive failures |
| `omnis-adapter-linkedin` | Playwright bridge (Phase C~) | 30 min (matched to the random low-frequency polling) | consecutive failures |
| `omnis-adapter-whatsapp` | Beeper bridge (Phase C~) | 15 min | consecutive failures |
| `omnis-bridge-macbook` | MacBook `local-agent` heartbeat | 10 min | ping missing for 20 min |
| `omnis-bridge-mini` | mini `local-agent` (Codex/Hermes) heartbeat | 10 min | ping missing for 20 min |
| `omnis-backup-pgdump` | Nightly `pg_dump` success | 1 day | not completed / non-zero exit code |
| `omnis-backup-restic` | Nightly restic backup success | 1 day | not completed / non-zero exit code |

Each job calls `curl -fsS -m 10 --retry 3 https://hc-ping.com/<uuid>` on successful exit, and signals failure explicitly with a `/fail` suffix on failure (reusing `18`'s ping URL pattern verbatim).

**ntfy routing**: run self-hosted ntfy on the mini (free and unlimited, `18`) and split topics into 2 tiers — `omnis-critical` (hub/Postgres/slot/backup failures, pushed to the MacBook and iPhone immediately) / `omnis-warning` (transient failures of individual channel adapters, can wait until the next morning briefing). The structure is: healthchecks.io's failure webhook fires a one-line curl at the mini's ntfy endpoint (`18`).

**Dual alerting into the omnis inbox**: every critical/warning event, separately from the ntfy push, creates an Item with `kind=system` in the `items` table so it also surfaces in omnis's own inbox (implementing master §15's requirement "adapter status also as system Items in the omnis inbox" verbatim) — so that if a person misses the iPhone notification, system status is visible next to the Inbox filter "Needs approval" the next time they open omnis.

---

## 9. Secret Management

**Keychain naming rule**: as locked in by A6-D9, use A1's dot (`.`) separated scheme `omnis.<channel>.<kind>.<external_id>` verbatim — the hyphen scheme conflicted with A1 and was dropped (99-review §1.2). Examples: `omnis.slack.xoxb.<team_id>`, `omnis.slack.xoxp.<team_id>`, `omnis.gmail.<email>`, `omnis.outlook.<upn>`, `omnis.telegram.session_key`, `omnis.beeper.token`, `omnis.whatsmeow.session_key` (all exactly as in A1). Services that are not channels extend it as `omnis.<service>.<kind>`: `omnis.anthropic.api_key`. The local-agent's session bus token uses the literals A2 §2.1 already locked in, `omnis.bridge.token.macbook` and `omnis.bridge.token.mini` (the former `omnis.macbook.session_bus_token`/`omnis.mini.session_bus_token` conflicted with A2 and were dropped, 99-review §4-4). The Account field is the fixed, non-identifying label `omnis`; it is never transmitted externally and exists only as the local Keychain item's owner label. **Lookups go by service name alone** — `security find-generic-password -s <service> -w`, where `<service>` is the full dot-separated name above, with **no `-a` argument** — so an item is found whatever account it happens to be stored under (including the personal label older installs stamped on it). Given that the `-w` value can remain in shell history (`15`), always call it from inside a script and never type it directly into an interactive shell.

**Existing asset reuse rule**: the DeepSeek API key already exists as the Keychain item `deepseek-api` (Logan's existing setup) — omnis does not regenerate it and reads it as-is with `security find-generic-password -s deepseek-api -w`. The new naming rule applies only to secrets omnis newly issues, and does not force a rename of assets already managed under a different name.

**sops+age file layout**: separated per device.

```
secrets/
  mini.enc.yaml       # mini only: DATABASE_URL, ZERO_*, channel OAuth client secret
  macbook.enc.yaml     # MacBook local-agent only: session bus auth token
  .sops.yaml           # age recipient rules (per-file recipient separation)
```

In `.sops.yaml`, `mini.enc.yaml` registers only the mini's age public key as a recipient, and `macbook.enc.yaml` registers only the MacBook's age public key — so compromising one device does not decrypt the other device's secrets. Only the values are encrypted; the keys (field names) remain plaintext, making git diff review possible (`15`). The `omnis-run-with-secrets.sh <host>` wrapper decrypts the relevant file at execution time and exports it as environment variables — the exact `sops` subcommand (e.g. `exec-env` or `-d` plus parsing) is confirmed at implementation time via `sops --help` (this part alone is UNVERIFIED — no spike needed; a non-blocking item checkable within 5 minutes during implementation).

**Rotation procedure**: (1) issue a new value (reissue from the channel console or generate a new API key), (2) open with `sops secrets/<host>.enc.yaml`, replace the value, and save (automatic re-encryption), (3) git commit, (4) restart only the affected LaunchDaemon/Agent with `launchctl kickstart -k` (no full reboot needed), (5) after restart, verify the corresponding healthchecks.io job is sending normal pings to confirm the rotation did not break the service, (6) record the rotation event in `audit_log`. The periodic rotation cadence follows each channel's expiry policy (OAuth refresh tokens renew automatically), while API keys (DeepSeek, Anthropic) default to immediate rotation on suspected leak plus quarterly for routine rotation.

---

## 10. `local-agent` Installation & Autostart (MacBook & mini)

`local-agent` is a bridge daemon that registers agent runtime sessions with the hub's session bus (master §7 "session bus"). The MacBook's exposes Claude Code, Codex, claude-ds, and Hermes; the mini's exposes only Codex and Hermes (master §4.2 "one local-agent on each of the MacBook and the mini"). Both processes depend on the login shell environment (nvm/node version, CLI tool PATH, user-session access to the macOS Keychain), so they are installed as **a login-session LaunchAgent, not a root LaunchDaemon** (A6-D10).

### 10.1 MacBook

```xml
<!-- ~/Library/LaunchAgents/ai.onwordlab.omnis-local-agent.plist (MacBook) -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-local-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>macbook</string>
    <string>/usr/local/bin/node</string>
    <string>/opt/omnis/local-agent/dist/main.js</string>
    <string>--hub</string>
    <string>https://<mini-hostname>.ts.net/api</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/logan/Library/Logs/omnis/local-agent.log</string>
  <key>StandardErrorPath</key><string>/Users/logan/Library/Logs/omnis/local-agent.err.log</string>
</dict>
</plist>
```

The install script (`scripts/install-local-agent.sh`) automates (1) copying the plist to `~/Library/LaunchAgents/`, (2) registering with `launchctl bootstrap gui/$(id -u)`, and (3) verifying that `omnis-local-agent` sends its first ping to the healthchecks.io `omnis-bridge-macbook` job. If the MacBook sleeps or reboots, it restarts automatically at login, and even after a restart it reattaches in-progress agent sessions via the `--resume` approach (the `session_key`/`session_id` separation in master §9).

The `--hub` argument in the plist above points at the same value as the `hub_url` field in `~/.omnis/local-agent.toml` (A2 §2.1) — the precedence between the two configuration sources (the CLI argument overrides the TOML) has A2 §2.1 as its source of truth, and this section only cites it (99-review §2-3).

### 10.2 Mini

The mini's `local-agent` is the new LaunchAgent row in the §1 table (A6-D1). It bridges only the Codex CLI (`app-server` JSON-RPC, master §9) and Hermes (`127.0.0.1:8642`, local only) — Claude Code and claude-ds exist only on the MacBook. GUI access itself is not needed (`codex app-server` is headless, `09`), but CLI execution depends on login-shell PATH and the Keychain session for the same reason as on the MacBook (A6-D10), and on the mini the GUI session is already on at all times for kmsg, Playwright, and Beeper because of A6-D1, so adding it to this session costs nothing extra.

```xml
<!-- ~/Library/LaunchAgents/ai.onwordlab.omnis-local-agent.plist (mini) -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-local-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>mini</string>
    <string>/usr/local/bin/node</string>
    <string>/opt/omnis/local-agent/dist/main.js</string>
    <string>--hub</string>
    <string>http://127.0.0.1:8787</string>
    <string>--runtimes</string>
    <string>codex,hermes</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/logan/Library/Logs/omnis/local-agent-mini.log</string>
  <key>StandardErrorPath</key><string>/Users/logan/Library/Logs/omnis/local-agent-mini.err.log</string>
</dict>
</plist>
```

Because the mini is the same machine as the hub, `--hub` points directly at `127.0.0.1:8787` (the hub's local binding) rather than Tailscale — there is no need to traverse the tailnet. The install procedure uses the same script as the MacBook (`scripts/install-local-agent.sh mini`), but the first ping is verified against the `omnis-bridge-mini` healthchecks.io job (§8). Placing it in `~/Library/LaunchAgents` (the `logan` user's home, not root) and registering with `launchctl bootstrap gui/$(id -u logan)` is the same principle as the §1 kmsg example.

---

## 11. Phase 0 Spike Execution Procedure

**Phase 0 is 2 weeks** (master §16). There are 14 gates that forbid starting Phase A before passing, of which A6 directly owns the execution procedure for 8 (①~⑧, A6-D12) and A1, A2, A3, and A7 own the remaining 6 — §11.1 below lists all 14 per master §16 and 99-review §5 (procedures and a record table are provided only for A6's). §11.2 covers the additional 16 "at Phase entry" (run at each Phase's entry point, with pass criteria following the owning appendix's original text verbatim, 99-review §5).

### 11.1 Phase 0's 14 Gates (no Phase A start before passing)

| # | Gate | Pass criterion | Owning appendix |
|---|---|---|---|
| ① Calendar `events.watch` via Funnel | handshake + 1 notification | A6 (procedure below) |
| ② Beeper + WhatsApp secondary-number send | 200 + received + no penalty for 24h | A6 (procedure below) |
| ③ FileVault ON + automatic login | GUI session after reboot with no manual intervention | A6 (procedure below) |
| ④ kmsg read on mini | 48h continuous, 0 permission re-prompts | A6 (procedure below) |
| ⑤ Tailscale Serve HTTPS @ iPhone | 0 SSL errors | A6 (procedure below) |
| ⑥ Zero + Postgres | propagation ≤2s (G5) | A6 (procedure below) |
| ⑦ Codex app-server pin + 1 turn | 0 protocol errors | A6 (procedure below) |
| ⑧ Ollama nomic-embed throughput | 1,000 sentences ≤120s, p95 ≤300ms | A6 (procedure below) |
| A1-④ Slack Socket Mode 1 turn | ≤5s (G1) | A1 |
| A1-⑤ Gmail watch + Pub/Sub | `historyId` received | A1 |
| S-A2-1 `claude -p --bare` hook injection | approval gate appears | A2 |
| S-A2-2 `--permission-mode` ↔ profile mapping | 3 profiles locked in | A2 |
| S-A3-2 Zero replication of `vector`/`tsvector`/`uuid[]`/generated columns | replication + query succeed | A3 |
| A7-1 `worktrunk` dry run | create/remove round trip | A7 |

**FileVault decision rule (③)**: in ordering, run ③ before §2 item 1 (setting up automatic login). If it passes, keep FileVault ON. If it fails (automatic login is blocked), immediately turn FileVault OFF and simultaneously narrow exposure to tailnet-only (no Funnel, Tailscale ACL only, §3), and this switch must go through Logan's approval (A6-D2). The ③ row's procedure and fallback below implement this rule verbatim.

**Source of truth for pass criteria**: of the 14 gates above, ①~⑧ (Calendar/Beeper/FileVault/kmsg/Tailscale Serve/Zero+Postgres/Codex/Ollama), for which A6 issues procedures directly, including A1-④ (Slack) and A1-⑤ (Gmail), have §11.3's procedure and pass criterion table as their source of truth — even though A1-channel-adapters.md §4 has its own pass criterion wording for the same channels (Calendar, Beeper, kmsg, Slack, Gmail), for those 5 gates A1's table follows §11.3, and where the wording differs §11.3 wins (99-review §4-2). Gates owned exclusively by A1 (Outlook A1-⑥, Telegram A1-⑦, LinkedIn A1-⑧, S-A2-1·2, S-A3-2, A7-1) continue to have the owning appendix's original text as their source of truth.

### 11.2 The 16 at Phase Entry (at each Phase's entry point; pass criteria from the owning appendix's original text)

A1-⑥ Outlook webhook · A1-⑦ Telegram QR · A1-⑧ LinkedIn notification-email parsing · S-A2-3~6 · S-A3-1·3·5 · S-A4-1 (**=A6-10**, §6 Ollama classifier selection, recall ≥0.9, false positives ≤0.15, p95 ≤800ms) · S-A4-2 · S-A4-4 · **S-A4-5** (owned by A4, cache-hit ≥60%) · **A6-9** (§7, 8-process RSS sum ≤10GB) · A7-2 Tauri UI tests.

**A6-9 and S-A4-5 are preconditions of the Phase A exit criteria (master §16), so they are not deferred to "Phase entry" but must run within Phase A** (99-review §5) — the other 14 can be run at each one's own Phase (B/C, etc.) entry point.

### 11.3 A6's 8 Owned Spikes — Procedures

For most failures the fallback is the fallback path already defined in the master's channel matrix (§8) — the spike confirms whether the optimal path holds; the master already designed things so the product is not blocked if it fails.

| # | Spike | Procedure | Pass criterion | Fallback on fail |
|---|---|---|---|---|
| ① | Calendar `events.watch` via Funnel | `tailscale funnel --bg 443 on` → register an `events.watch` channel via the Google Calendar API (webhook URL = the Funnel endpoint) → create/modify a test event → confirm webhook receipt → `tailscale funnel 443 off` immediately on completion | webhook arrives within 1 minute of the event change | `events.list` + syncToken polling every 1–5 min (already specified as the default path in master §8) |
| ② | Beeper token issuance + WhatsApp secondary-number send | Install Beeper Desktop and QR-pair (with the secondary number, the Q2 default) → confirm token issuance via the local REST API → send 1 test message from the secondary number | token issued + send succeeded + no account penalty signal within 24 hours | whatsmeow Go sidecar (master D4 fallback) |
| ③ | Automatic login with FileVault on (run before §2 item 1 — the decision rule is in §11.1) | Turn on FileVault → set the automatic login account → reboot → observe whether a GUI session is reached without a login screen | login session reached after reboot with no manual intervention | FileVault OFF + tailnet-only exposure + physical security as compensation, Logan's approval required (A6-D2) |
| ④ | kmsg read on mini | Install kmsg → run `kmsg watch --json` → grant Accessibility permission → observe continuous JSON events for 24–48 hours | 48 hours of continuous normal events with no permission re-prompt | None (master §8's KakaoTalk path is kmsg as the single option; the alternative, a Notification Center DB trigger + OCR, is already specified) |
| ⑤ | Tailscale Serve HTTPS from iPhone Safari | First check for and remove any DoH/private-DNS app or profile on the iPhone → connect to `<mini-hostname>.ts.net` in Safari | page loads with no SSL error | Re-check the MagicDNS name → if it still fails, move the TailscaleKit validation forward to Phase D (`13`) |
| ⑥ | Zero + Postgres startup | Start local Postgres (with pgvector) → connect zero-cache (§5 settings) → insert a test row → measure change propagation time in a client subscription | zero-cache starts normally + change propagates within 2 seconds (G5) | PowerSync (master D7 fallback, noting the issue that self-hosting requires MongoDB, `27`) |
| ⑦ | Codex app-server pin + 1-turn round trip | Run a pinned version of `codex app-server` → send a 1-turn request over JSON-RPC → confirm receipt of `item/started` through `item/completed` | 1 turn completes with no protocol errors | Re-pin the version and work around it with capabilities-based feature detection (master §9) |
| ⑧ | Ollama `nomic-embed` throughput | Load `nomic-embed-text-v1.5` into Ollama → measure batched embedding time for a 100-item sample of inbox messages | throughput confirmed to absorb the estimated ~2,000 items/day (`27`) inflow without real-time delay | Move batching to the nightly off-peak window (combined with master §14's off-peak principle for after 19:00 KST) or offload to the MacBook |

### Result Record Table (blank form)

| # | Spike | Run date | Result (Pass/Fail) | Measurement | Notes |
|---|---|---|---|---|---|
| ① | Calendar watch/Funnel | | | | |
| ② | Beeper/WhatsApp secondary number | | | | |
| ③ | FileVault + automatic login | | | | |
| ④ | kmsg read | | | | |
| ⑤ | Serve HTTPS/iPhone | | | | |
| ⑥ | Zero+Postgres | | | | |
| ⑦ | Codex app-server | | | | |
| ⑧ | Ollama nomic-embed | | | | |
| A6-9 (additional) | 16GB integrated memory measurement (§7) | | | | sum of RSS with 8 processes running simultaneously |
| A6-10 (additional) | Ollama 1–3B classifier selection (§6) | | | | record candidate model names, throughput, memory |

This table must be filled in before judging the Phase A exit criteria (master §16 "G1, G2, G4, G5 satisfied for 3 channels + 2 runtimes") — ⑥ and A6-9 in particular are preconditions for G5 (2-second sync) and the §7 budget.

---

## 12. What Changes on the standalone (Phase D) Transition

Master D12/§4.2 has already honestly redefined it as "Slack/Gmail/Outlook/Telegram/WhatsApp/Calendar + 4 agent sessions are fully hub-less; KakaoTalk and LinkedIn require one always-on Mac" (`25`). This table lays out concretely what that transition changes for each operational item in §1–10.

| Item | Phase A–C (mini hub) | Phase D (standalone) | Notes |
|---|---|---|---|
| Postgres location | mini LaunchDaemon | instance embedded in the MacBook app bundle | master §4.2 |
| zero-cache | mini LaunchDaemon | process embedded in the MacBook app | the client-server protocol itself does not change (`13`) |
| omnis-hub | mini LaunchDaemon | the same code runs inside the MacBook app (master "the hub is the same code whether on the Mac mini or inside the MacBook app") | |
| KakaoTalk/LinkedIn capture host | mini (same machine as the hub) | **still the mini** — role reduced to a "capture sidecar" (A6-D11, matching master §19 Q8's default: "run the mini alongside as a KakaoTalk/LinkedIn capture sidecar") | `25`'s Option E; full retirement is a separate decision |
| Tailscale ACL structure | `tag:client → tag:hub` (mini-centric, one-way) | redesigned peer-to-peer (the MacBook is both hub and client) + the mini is re-tagged as `tag:kakao-sidecar` | `15` Later section |
| SQLCipher/secret key distribution | the key exists only on the mini | simplified to the question of "which device the Postgres server runs on" (since the Zero+Postgres layer is already chosen, no separate key-sync logic is needed) | `25` §4; not built now, per YAGNI |
| Backup target | mini's restic → B2 | MacBook's restic → B2 (paths only) | |
| Monitored targets | all 15 jobs in §8 | Postgres/hub/zero/`omnis-bridge-macbook` carry the "MacBook" label; only the kakao/linkedin jobs and `omnis-bridge-mini` (if a local-agent remains on the mini) keep the "mini (sidecar)" label | |
| Resource budget | shared across the mini's 16GB (§7) | only part of the MacBook's 64GB is used (ample room); the mini keeps only kmsg + Playwright, so of the §7 budget's 10GB only kmsg (0.2GB) + Playwright (0.8GB) remain and the rest is returned | |
| iPhone access path | Tailscale Serve (mini) | Tailscale Serve (MacBook) + evaluate embedding TailscaleKit natively (`13` v2 recommendation) | |
| Impact of MacBook sleep/travel | not applicable (the mini is always on) | since Postgres/hub/zero are also on the MacBook, everything stops when the MacBook sleeps — clamshell + always-on power required; while genuinely traveling it is offline (triage only from the local cache) | a new risk raised by `25`; the master has not yet stated this trade-off (decisions_needed) |

The real cost of the standalone transition is mostly migration work — "moving what was on the mini over to the MacBook" — not redesign, because the Zero+Postgres+Tailscale combination was used unchanged from Phase A (`13`, the shared conclusion of `25`). "Whether to keep running the mini alongside" is already settled by master §19 Q8's default (keep the mini alongside), so it is no longer decisions_needed — the capture host row in the table above is that implementation. Only one separate question remains that this appendix still does not decide for you: whether to accept that **the MacBook itself**, once Postgres/hub/zero have moved onto it, becomes the only always-on node, making MacBook sleep and travel synonymous with service downtime (operating the MacBook on constant power in clamshell mode) — this remains decisions_needed independently of Q8 (the same item as "Later, hardware wear risk unverified" in A6-D11's fallback cell).

---

## Review Notes (2026-09-20)

This section records substantive issues that were not fixed inline. For the items below that require a decision, only a review was done; no values were changed.

| # | Issue | Severity | Basis | Status |
|---|---|---|---|---|
| 2 | **The "no containers" principle is not explicitly reconfirmed anywhere in A6's body.** Master §15 states "no containers (native processes). Colima only if needed," but A6 mentions this only in passing, inside the headroom parenthetical of the §7 resource table (`Colima if needed`). Nowhere in this appendix is it explained when Colima becomes necessary or why native processes are the default — this does not hinder implementability, but it falls short of this document's own purpose of bringing master decisions "down to an implementable level." | minor | 00-omnis-design.md §15, A6-ops-infra.md §7 | Unresolved — outside the fix list's scope; expanding the content without UNVERIFIED would require separate research, so it was skipped this pass |
| 3 | **The `decisions_needed` tag is not defined anywhere in the master or other appendices.** A6-D2's fallback cell and §12's closing paragraph use this tag, as in "Logan's approval required — decisions_needed," but master §19 (open questions) and the other appendices have no such convention. It is unclear whether this is a mere in-document label or a list that should actually be collected in a README/issue tracker. | minor | A6-ops-infra.md A6-D2, §12 | Unresolved — outside the fix list's scope. However, §12's "keep the mini alongside vs MacBook-only" item was resolved this pass by master §19 Q8's default, narrowing the remaining decisions_needed to a single item: "whether the MacBook runs on constant power in clamshell mode" |
| 4 | **The scope of the `SQLCipher/secret key distribution` row (§12 table) is ambiguous.** Master §13 classifies SQLCipher-grade message body column encryption as "Later" (not required for MVP), yet A6 §12's row puts SQLCipher in its title while the body only discusses "which device the Postgres server runs on" and never mentions SQLCipher's own Phase A–C/D status. | minor | A6-ops-infra.md §12, 00-omnis-design.md §13 | Unresolved — outside the fix list's scope |
| 5 | **`research/20-gap-eve-self-host-spike.md`, cited as a basis in the appendix's opening line, is not referenced anywhere in the body.** The body's backtick citations are only six: `09`/`13`/`15`/`18`/`25`/`27` (`09` was added to §10.2 this pass). Either clarify which decision `20` actually influenced, or remove it from the opening basis list. | minor | A6-ops-infra.md lines 1–3 | Unresolved — outside the fix list's scope |

Resolved (this v0.95 pass, removed): former item 1, "the Keychain naming rule conflicts with A1" — A6-D9 was rewritten to A1's dot (`.`) separated scheme `omnis.<channel>.<kind>.<external_id>` and the §9 body was rewritten with the same scheme (fix #1).

Resolved (v1.0 pass 2, removed): former item 1, "the local-agent hub address configuration path is described differently in the two appendices" — a one-line citation was added to §10.1 stating that A2 §2.1 is the source of truth for "the CLI argument overrides the TOML," making the criterion explicit (99-review §2-3). Whether the same wording is actually written on A2's side is A2's own fix pass's responsibility.

Already fixed inline (earlier pass): (a) `ai.onwardlab.*` / `logan@onwardlab.ai` were unified to `onwordlab` to match the spelling `Onword` used by master D14/A8 (§1, §3, §10) — it was a spelling inconsistency between appendices. (b) §2's reference "the re-apply script in §2.5," which read like a nonexistent subsection, was corrected to "§2 item 5 (the re-apply LaunchAgent)" to make the reference clear.

---

## Change History (v0.95, 2026-09-20)

1. Rewrote the Keychain naming rule (A6-D9, §9) to A1's dot (`.`) separated scheme `omnis.<channel>.<kind>.<external_id>` — the hyphen scheme conflicted with A1 and was dropped (99-review §1.2).
2. Changed the hub local port to `127.0.0.1:8787` throughout (§1, §3 ACL and `tailscale serve`) and stated in the body that 8642 is reserved for Hermes `api_server`.
3. Pinned the Postgres version to 17 (§4, removing the "latest at install time" phrasing) and added the slot healthcheck command (the `psql` query) to §4 alongside `idle_replication_slot_timeout='3d'` (A6-D4, unchanged).
4. Added the mini `local-agent` (Codex + Hermes bridge) to the §1 process table, §7 resource table, §8 monitoring table, and §10.2. Decided on a LaunchAgent (extending A6-D10) — A6-D10's existing rationale that Codex CLI execution depends on the login shell/Keychain session was applied deductively to the mini (a deduction from the principle given by `18`/`09`, not a fact stated directly in either file), and since the mini already keeps a GUI session alive at all times because of A6-D1, this was decided without a spike marker on the basis that there is no extra cost.
5. Stated that Phase 0 is 2 weeks and listed all 14 gates in §11.1 (A6's 8 + A1/A2/A3/A7's 6) with pass criteria per master §16 and 99-review §5, and added the "at Phase entry" list of 16 in §11.2. Reflected the FileVault decision rule (run ③ first → on fail, OFF + tailnet-only + Logan's approval) in A6-D2, §11.1, and the ③ row of §11.3.
6. Stated in §7 and §11.2 that A6-9 (8-process RSS ≤10GB) and S-A4-5 (cache-hit ≥60%, owned by A4) are preconditions of the Phase A exit criteria and therefore must run within Phase A.
7. Added a citation of master §19 Q8's default (keep the mini alongside) to the capture host row of the §12 standalone table, and removed "whether to keep the mini alongside" from the decisions_needed list in the closing paragraph (already resolved by Q8) — narrowing the remaining decisions_needed to just "whether the MacBook runs on constant power in clamshell mode."
8. Removed former item 1 (Keychain conflict) from the review notes (resolved by fix #1). The remaining 5 items are outside this fix list's scope and were left as-is, with an "Unresolved" reason added to each in the table.

### v1.0 (2026-09-20, pass 2)

1. Corrected the channel spike numbers in §11.1, §11.2, and A6-D12 to match A1's actual labels (A1-channel-adapters.md §4, A1-D10: `A1-①` Calendar, `②` Beeper, `③` kmsg, `④` Slack, `⑤` Gmail, `⑥` Outlook, `⑦` Telegram, `⑧` LinkedIn) — §11.1's "A1-① Slack / A1-② Gmail" became "A1-④ Slack / A1-⑤ Gmail," §11.2's "A1-③ Outlook · ④ Telegram · ⑤ LinkedIn" became "A1-⑥ Outlook · ⑦ Telegram · ⑧ LinkedIn," and A6-D12's "A1-①·②" became "A1-④·⑤" (99-review-v2 §4-2). Added a "source of truth for pass criteria" paragraph to §11.1 making it explicit that for the 5 gates A6 and A1 both cover (Calendar/Beeper/kmsg/Slack/Gmail), §11.3 is the source of truth and A1-channel-adapters.md §4 follows §11.3 where the wording differs.
2. Replaced the local-agent session bus token Keychain names in §9 with A2 §2.1's locked-in literals `omnis.bridge.token.macbook`/`omnis.bridge.token.mini` (the former `omnis.macbook.session_bus_token`/`omnis.mini.session_bus_token` conflicted with A2 and were dropped, 99-review-v2 §4-4).
3. Added a one-line citation to §10.1: "the `--hub` argument and `hub_url` in A2 §2.1's `local-agent.toml` point at the same value, and A2 §2.1 is the source of truth for the precedence between the two sources (the CLI overrides the TOML)" (the `--hub` argument itself is unchanged, 99-review-v2 §2-3). With this citation, former review note item 1 (unclear local-agent configuration source) was resolved and removed from the table.
4. Bumped the version to 1.0 and added `99-review-v2.md`, `A1-channel-adapters.md` §4, and `A2-agent-session-bridge.md` §2.1 to the opening basis list.

**Not covered in this pass**: the remaining items in rev2 §2/§3/§4 (the one Web Push variant, A7 US-A02/A04, A5 §2.5, the schedule source of truth, etc.) are owned by other appendices and thus outside A6's scope. rev2 §3-1 (the MacBook local-file ingestion host, owned by A4 §10.1), §2-2 (A1 §16's 8 channels), and §2-4 (threads.person_id, owned by A5) are also not items A6 touches and are left as-is.
