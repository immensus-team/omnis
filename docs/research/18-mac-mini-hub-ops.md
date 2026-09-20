# 18 — Running a 24/7 Hub on a Headless macOS Mac Mini (M4, 16GB)

## 1. TL;DR

When using a Mac mini (M4, 16GB, macOS 26.6) as an always-on headless hub, the core constraint is this: Apple's official documentation confirms that launchd's **LaunchDaemons cannot connect to the GUI (window server)** — apps that need a screen, such as KakaoTalk.app or a browser profile for LinkedIn, must be launched as a **LaunchAgent in the logged-in user session**. The precondition is therefore automatic login (FileVault off or instant unlock required) + `pmset -c sleep 0` + `caffeinate`, so that the session is never logged out or locked. Node/Bun services (APIs with ports, etc.) are adequately handled by launchd KeepAlive, but log rotation and process-group management are more convenient with pm2 (though pm2 on macOS also ends up registered with launchd). Docker Desktop has paid triggers, so Colima (free, MIT, runs on Lima — consistent with the brief's existing Lima VM) is sensible. For backups, restic (encrypted + dedup, BSD license) + low-cost cloud object storage; for monitoring, healthchecks.io free tier (20 jobs) + self-hosted ntfy (free, one curl line) is the biggest win.

## 2. Facts

- launchd **LaunchDaemons run in the global bootstrap namespace and cannot connect to the window server** — running a GUI app as a daemon is architecturally impossible, as Apple TN2083 states explicitly ("How can I launch a GUI application from my daemon? The answer is that you can't"). Work that requires a GUI must be split out into a **LaunchAgent (GUI type)** tied to a login session, and daemon↔agent communication is recommended over a Unix domain socket. VERIFIED — [Apple TN2083: Daemons and Agents](https://developer.apple.com/library/archive/technotes/tn2083/_index.html), accessed 2026-09-20.
- launchd placement rules: `~/Library/LaunchAgents` (individual user), `/Library/LaunchAgents` (all-user agents), `/Library/LaunchDaemons` (system, runs at boot without login). A LaunchAgent starts when the user logs in and runs only while that user is logged in; a LaunchDaemon runs at boot regardless of whether anyone is logged in. `KeepAlive` controls whether it keeps running, and although on-demand (false) is Apple's recommended default, an always-on service can set it to `true`. Periodic execution uses `StartInterval` (in seconds) or `StartCalendarInterval`. VERIFIED — [Apple: Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html), accessed 2026-09-20.
- `pmset -c` is the flag that specifies power settings for AC power (charger connected); a headless always-on Mac disables system sleep, display sleep, and disk spin-down with `sudo pmset -c sleep 0 displaysleep 0 disksleep 0`. VERIFIED — [ss64 pmset reference](https://ss64.com/mac/pmset.html), accessed 2026-09-20.
- On macOS (`darwin`), running `pm2 startup` **internally generates a launchd plist** to restore processes after a reboot, and `pm2 save` must be run to save the current process list before the startup hook takes effect. VERIFIED — [PM2 runtime startup-hook docs](https://pm2.io/docs/runtime/guide/startup-hook/), accessed 2026-09-20. (Log rotation details need to be confirmed on the separate pm2-logrotate module page — this lookup did not obtain the specific values, UNVERIFIED)
- **Colima** is a container runtime CLI that runs on Lima, supporting Docker/Containerd/Incus, MIT license, official Apple Silicon support (from macOS 13+, up to Rosetta 2 emulation and GPU-accelerated AI workloads), default VM spec 2 CPU / 2GiB memory / 100GiB disk (customizable). VERIFIED — [Colima GitHub README](https://github.com/abiosoft/colima), accessed 2026-09-20.
- **OrbStack** is an Apple Silicon-optimized Docker/Linux VM alternative; it claims "under 0.1% background CPU usage on Apple Silicon" and has published its own benchmark (17 minutes vs 45 minutes) showing development-environment provisioning far faster than Docker Desktop. Pricing information requires a separate page (not obtained in this lookup; the existence of a free personal tier is industry common knowledge but could not be confirmed from a primary source in this session — UNVERIFIED). VERIFIED (performance claims only) — [OrbStack homepage](https://orbstack.dev/), accessed 2026-09-20.
- **Docker Desktop**'s Personal plan is completely free ($0/month, 1 user, limits such as 100 Hub pulls per hour), and becomes paid starting at Pro ($9–11/month) when team collaboration, SSO, audit logs, etc. are needed. omnis is single-user, so the free tier is sufficient, but Colima/OrbStack are lighter to begin with. VERIFIED — [Docker pricing page](https://www.docker.com/pricing/), accessed 2026-09-20.
- **restic** is a single executable, needs no server, does incremental backup (transfers only changes), encrypts the entire process, is BSD 2-Clause licensed, supports macOS/Linux/BSD/Windows, and guarantees repository compatibility within a major version after v1.0.0. VERIFIED — [restic.net](https://restic.net/), accessed 2026-09-20.
- **healthchecks.io**'s free (Hobbyist) tier includes **20 job monitors and 100 logs per job**; paid Business is $20/month (100 jobs, 1000 logs, SMS/phone credits included). A self-hosted (Docker) deployment option also exists in the official documentation. VERIFIED — [healthchecks.io pricing](https://healthchecks.io/pricing/), [healthchecks.io docs](https://healthchecks.io/docs/), accessed 2026-09-20.
- **ntfy** is an open-source service that sends push notifications with a single HTTP PUT/POST line (`curl -d "message" ntfy.sh/topic`), and it has a separate self-hosting-only installation guide (running it directly on the Mac mini is completely free and unlimited). The exact license wording was not confirmed in this lookup (UNVERIFIED; commonly known to be Apache-2.0, but no primary source obtained). VERIFIED (functionality) — [ntfy docs](https://docs.ntfy.sh/), accessed 2026-09-20.
- **Beeper** supports WhatsApp, Instagram, Telegram, Signal, Messenger, X, Google Messages/Chat/Voice, LinkedIn, Discord, and Slack, but **KakaoTalk is not in the supported list** — most are characterized by "on-device connections" (messages go directly between the device and the network without passing through Beeper's servers). That is, in omnis, KakaoTalk cannot be replaced by Beeper, and KakaoTalk.app itself must remain running in the GUI session while being captured via the accessibility API or screen automation. VERIFIED — [beeper.com](https://www.beeper.com/), accessed 2026-09-20.
- In Tailscale's official documentation, a dedicated guide page for using macOS Screen Sharing/VNC over the tailnet could not be identified in this lookup (documentation index, `/kb/1092/*` family) — the fact that macOS built-in Screen Sharing (`vnc://<tailscale-ip>` or `<hostname>.ts.net`) can be used as-is without port forwarding, because Tailscale provides private IPs/MagicDNS, is valid given Tailscale's basic operating principle, but since it could not be confirmed via a dedicated tutorial URL in this session, it is **UNVERIFIED** (a specific macOS Screen Sharing guide document). The only thing confirmed about the Tailscale docs is the note that they were last updated as of 2026-02-04. — [tailscale.com/kb/1092/remote-desktop-access](https://tailscale.com/kb/1092/remote-desktop-access), accessed 2026-09-20.

## 3. Options / Comparison

### Process supervision: launchd directly vs pm2

| | launchd KeepAlive directly | pm2 (with launchd registered on top) |
|---|---|---|
| Automatic recovery after reboot | Yes (built into LaunchDaemon/Agent) | Yes (`pm2 startup` + `pm2 save`, internally generates a launchd plist) |
| Log rotation | None (requires manual `newsyslog` configuration) | `pm2-logrotate` module (ecosystem-proven; details need separate confirmation) |
| Seeing multiple Node processes at a glance (`pm2 list`, `pm2 monit`) | None (each plist must be checked separately with `launchctl list`) | Yes |
| Granularity of crash-loop backoff control | About `ThrottleInterval` per plist | pm2 exposes restart counts/delays more finely |
| Added dependencies | 0 | 1 npm package |
| Pure API/workers that need no GUI | Suitable | Suitable, more convenient |

### Container runtime: OrbStack vs Colima vs Docker Desktop (including the native alternative)

| | Docker Desktop | Colima | OrbStack | Native (without containers) |
|---|---|---|---|---|
| License/cost | Free for personal use, paid for teams/enterprise ($9+/month) | Free, MIT | Claimed free personal tier but not confirmed from a primary source in this lookup (UNVERIFIED) | Free |
| Apple Silicon | Supported | Official support, Rosetta 2 / GPU acceleration | Claims "optimized" (benchmarks self-published) | N/A |
| Relationship to the existing Lima VM | Separate VM engine (its own hypervisor) | **Built on Lima itself** ("Colima = Containers on Lima") | Its own lightweight VM | — |
| Memory footprint (important on a 16GB Mac) | Relatively heavy | Default 2GiB VM (adjustable) | Claims "under 0.1% idle CPU" | Lightest (no VM at all) |
| Fit for omnis | Includes unnecessary features (team collaboration, etc.) | Overlaps with the Lima already present, so consolidation is easy | Adds a separate VM engine (redundant with Lima) | postgres installed natively via brew is lighter |

### Remote access: Screen Sharing/VNC vs SSH-only

| | SSH (terminal only) | Screen Sharing/VNC over Tailscale |
|---|---|---|
| Checking/controlling the KakaoTalk/browser GUI | Not possible | Possible |
| Bandwidth/latency | Low | Heavier, since it streams the screen |
| Need to expose ports over Tailscale | Not needed (SSH only) | Not needed (direct via private IP/MagicDNS, no public port forwarding — valid given Tailscale's own characteristics; dedicated guide UNVERIFIED in this lookup) |
| Locked-screen problem | Irrelevant | **If the screen is locked, GUI automation is blocked — automatic login + disabling the screen lock are prerequisites** |

## 4. Recommendation for omnis

**Separate daemon and agent clearly in the launchd architecture (impact M, risk low).** Backends that need no screen — Postgres, the Hermes api_server (:8642), the bridge server — go under `/Library/LaunchDaemons` (root, starts immediately at boot, no login needed). Things that need a GUI — KakaoTalk.app, the browser profile for LinkedIn — must be split into the logged-in user's `~/Library/LaunchAgents` (tied to the GUI session); TN2083 makes it explicit that "you can't launch a GUI app from a daemon", so this is a constraint, not a choice. Communication between the two layers is already done over local HTTP (:8642 and the like), so no additional IPC design is needed.

**Never lock the GUI session (mandatory, S, risk: degraded physical security).** Enable automatic login (System Settings → Users & Groups) + `sudo pmset -c sleep 0 displaysleep 0 disksleep 0` + disable the screen saver/lock. With FileVault enabled, automatic login is usually blocked (industry common knowledge; confirmation from Apple primary documentation failed in this lookup — marked UNVERIFIED), so either turn FileVault off or consider an alternative (APFS volume encryption + separate keychain unlock). Trade-off: anyone with physical access is left unprotected — if the premise that the Mac mini sits on a Tailscale-only network in a space with controlled physical access (home/office) breaks down, this recommendation should be revisited. Add a single LaunchAgent that auto-runs `caffeinate -disu &` at login, so that even if pmset settings are reset by a system update, there is a second safety net.

**Don't install Docker Desktop fresh for containers; consolidate on the existing Lima base (impact M, effort S).** The brief already said a Lima VM is running, so the biggest win is to layer only a Docker CLI-compatible runtime on top of it with Colima (free, MIT, Lima-native) — Docker Desktop carries GUI overhead and license-policy change risk (there is precedent for a switch to paid based on company size in the past) even on the free personal tier, and OrbStack is a separate VM engine that overlaps with Lima. Under a 16GB RAM budget, the right move is to avoid spinning up "one more VM".

**Unify process supervision on pm2, and hand logs to pm2-logrotate (impact S, effort S).** Instead of hand-writing a launchd plist per service, one `pm2 start ecosystem.config.js` plus `pm2 startup && pm2 save` automates reboot recovery. Since pm2 also ends up registered with launchd, the daemon/agent separation principle must still be maintained (wrapping a GUI-requiring process in pm2 still won't launch it from the daemon session).

**Backup: restic + low-cost object storage; Time Machine only as a local snapshot supplement (impact M, effort S).** For postgres, run `pg_dump` or WAL archiving, then encrypted incremental backup with restic, targeting low-cost S3-compatible storage such as Backblaze B2 (matching the cost-sensitive requirement). Time Machine comes free as a whole-system snapshot safety net if you attach one more local disk and turn it on, so there is no reason to skip it, but it is not the mainstay of offsite backup.

**Monitoring: healthchecks.io free tier (20 jobs) + self-hosted ntfy (impact M, effort S, cost 0).** Each launchd/pm2 service periodically pings healthchecks.io (cron-style dead-man's-switch), and on failure ntfy pushes a one-line curl notification to the MacBook/iPhone immediately. Both can be self-hosted on the Mac mini itself (ntfy has an official self-host guide), minimizing external dependency while keeping cost near zero.

**Risk summary**: ToS risk is low (the account-suspension risk of KakaoTalk/LinkedIn automation itself is outside this report's scope and must be covered in a separate research document). Maintenance risk is greatest for "maintaining automatic login + an unlocked screen state" — macOS updates resetting pmset/automatic-login settings is common in practice (not confirmed from a primary source in this lookup, UNVERIFIED, but operating common sense), so placing a LaunchAgent/script that reapplies the settings at boot is recommended.

## 5. What to Borrow

- **The Daemon/Agent separation pattern** applied as-is to the omnis service layout design: `/Library/LaunchDaemons/ai.onwardlab.omnis-api.plist` (postgres connection, Hermes bridge, Slack/Gmail pollers, etc. — headless) + `~/Library/LaunchAgents/ai.onwardlab.omnis-kakao-bridge.plist` (KakaoTalk.app accessibility capture, requires a login session) — reference: the "split your program into multiple components" section of [Apple TN2083](https://developer.apple.com/library/archive/technotes/tn2083/_index.html).
- Put **pm2 ecosystem.config.js** at the omnis repo root and define all Node/Bun services (bridge, API, embedding worker) in one file — `pm2 startup` registers it with launchd automatically, so there is no need to hand-write multiple plists. Reference: [PM2 startup-hook docs](https://pm2.io/docs/runtime/guide/startup-hook/).
- Merge the **Colima config file** (`~/.colima/default/colima.yaml`) with the brief's Lima VM settings and consider running the embedding-model container (local model serving) inside this VM — Lima is already running, so there is no need to create a new VM.
- The **healthchecks.io ping URL pattern** (`https://hc-ping.com/<uuid>/start`, `/fail`, exit code suffix) can be reused as-is for omnis's "agent session died" detection — if Claude Code/Codex CLI/DeepSeek sessions send a heartbeat ping periodically, omnis can receive an "agent session died" notification in its own inbox via a healthchecks webhook.
- The **ntfy curl pattern** (`curl -d "message" <self-hosted URL>/topic`) can be borrowed as-is as the minimal implementation of omnis's "context-aware reply draft notification" feature — as a temporary channel before building dedicated push infrastructure (APNs and the like).

## 6. Open Questions

- Whether automatic login actually works with FileVault enabled on macOS 26.6 (whether the settings UI blocks it, or whether it is still possible) — not confirmed from Apple primary documentation in this session. Direct testing needed.
- OrbStack's actual pricing policy (whether a free tier exists and what its limits are) needs re-confirmation from a primary source (`orbstack.dev/pricing`) — this lookup only saw the homepage.
- Whether a dedicated macOS Screen Sharing/VNC guide actually exists in Tailscale's official documentation (identifying the URL), and whether GUI automation (Accessibility API, etc.) works while the screen is "locked" with Screen Sharing enabled — this determines the practical success or failure of KakaoTalk capture.
- pm2-logrotate's default behavior on macOS (file size threshold, whether it compresses) and whether duplicate rotation occurs when run alongside launchd's own stdout/stderr redirection (`StandardOutPath`).
- Measured memory usage when Hermes + postgres + Lima/Colima VM + a local embedding model are all stacked at once within a 16GB RAM budget — this report only collected individual claims per component and has no integrated measurement (a separate benchmark is needed).
- Whether reading KakaoTalk.app via the Accessibility API carries any risk of violating Kakao's ToS — outside this report's scope, separate investigation needed.

## 7. Sources

- [Apple TN2083: Daemons and Agents](https://developer.apple.com/library/archive/technotes/tn2083/_index.html) — accessed 2026-09-20
- [Apple: Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) — accessed 2026-09-20
- [ss64 pmset reference](https://ss64.com/mac/pmset.html) — accessed 2026-09-20
- [PM2 runtime startup-hook docs](https://pm2.io/docs/runtime/guide/startup-hook/) — accessed 2026-09-20
- [Colima GitHub README](https://github.com/abiosoft/colima) — accessed 2026-09-20
- [OrbStack homepage](https://orbstack.dev/) — accessed 2026-09-20
- [Docker pricing page](https://www.docker.com/pricing/) — accessed 2026-09-20
- [restic.net](https://restic.net/) — accessed 2026-09-20
- [healthchecks.io pricing](https://healthchecks.io/pricing/) — accessed 2026-09-20
- [healthchecks.io docs](https://healthchecks.io/docs/) — accessed 2026-09-20
- [ntfy docs](https://docs.ntfy.sh/) — accessed 2026-09-20
- [Beeper homepage](https://www.beeper.com/) — accessed 2026-09-20
- [Tailscale remote-desktop-access KB index](https://tailscale.com/kb/1092/remote-desktop-access) — accessed 2026-09-20 (documentation index only; no detailed guide reached)
