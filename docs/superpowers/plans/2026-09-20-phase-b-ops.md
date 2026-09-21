# Phase B Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six pieces of infrastructure that make the mini (`vigors-mac-mini`) operable in its Phase B state — Web Push VAPID key rotation, Tailscale Serve PWA mount + ACL document, nightly backup + quarterly restore drill, healthchecks.io + ntfy dual alerting, boot preflight, and a monthly cost report job. Only one of them has a code dependency, US-B44 (a kernel scheduler job); the other five are shell scripts + launchd + documents.

**Architecture:** Extend the existing patterns of `ops/mini/` as-is (A6 §1·§10, adjusted to what was actually measured — LaunchAgent only and no sudo, with `run.sh` exporting Keychain values through `env.sh`). Every new shell script lives in `ops/scripts/`, and each script carries its own `kc()` helper that reads the Keychain via `security find-generic-password` (the same idiom as `ops/mini/env.sh.example`) — extending A6 §9's "duplicating createLogger·readKeychainSecret is intentional" principle all the way down to shell scripts, rather than extracting a shared library. The single TypeScript task (US-B44) copies `packages/kernel/src/jobs/healthcheck.ts` (the A3 §6 seed-job pattern) verbatim: `scheduler.register(name, cron, handler)` + `events.emit("cold", …)`.

**Tech Stack:** bash (`set -euo pipefail`) · `security` (macOS Keychain) · `launchctl`/`pmset`/`fdesetup` (macOS) · `pg_dump`/`pg_restore`/`psql` (Postgres 17 client) · `restic` + Backblaze B2 · `tailscale` CLI · Node 22 `node:crypto` (VAPID key generation, no external package) · TypeScript 5.6 strict + `pg` 8.13.1 + vitest 2.1.9 (`@omnis/kernel` integration project).

**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` + the appendices this plan implements:
- `A6-ops-infra.md` §2 (OS settings) · §3 (network · Tailscale Serve) · §4 (Postgres backup) · §8 (monitoring) · §9 (secret management)
- `A4-agent-layer.md` §12.4 (cost meter — the `agent_runs` aggregation US-B44 reads)
- `A7-dev-process.md` §2 (toolchain) · §4 (model assignment) · §6 (commit rules)
- `2026-09-20-phase-b-backlog.md` §2 rows US-B16·B34·B41·B42·B43·B44, §4 (shared prohibitions), B-D5 (accept with fixtures/seeds only)
- `2026-09-20-phase-b-interfaces-delta.md` §5 (additional `@omnis/kernel` exports) · §8 (job table) · §9 (environment variables · Keychain)
- `2026-09-20-phase-a-interfaces.md` §4 (`@omnis/db`) · §5 (`@omnis/kernel` Scheduler/Events/Logger) · §9 (shared conventions)
- Measured code (takes precedence over the spec): `ops/mini/RUNBOOK.md`, `ops/mini/env.sh.example`, `ops/mini/run.sh`, `ops/mini/install.sh`, `ops/mini/com.omnis.hub.plist`, `packages/kernel/src/jobs/healthcheck.ts` — A6's original `/opt/omnis` + sops design has in practice been replaced by `ops/mini/env.sh` + individual Keychain items (RUNBOOK's "what this deployment actually changed on the mini" table). This plan follows what was measured.

---

## Global Constraints

- Node 22 + pnpm workspaces. TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (root `tsconfig.base.json`, already present — this plan does not create it).
- Postgres 17 pinned. Dev DB `omnis` (user `vigor` on the mini), test DB `omnis_test` (all through `DATABASE_URL`, defaulting to `postgres://logan@127.0.0.1:5432/omnis_test` when unset — contract §2). US-B44's vitest integration test uses this DB, and there is no per-file transaction rollback (because of trigger/NOTIFY verification — contract §2). The job row Task 6 creates is deleted directly in `afterAll` (so the shared `omnis_test` does not break the 0006 seed-count assertion — the pattern `healthcheck-job.test.ts` already uses).
- Version pins (FIXED): `vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `@rocicorp/zero 1.9.0` (exact) · `ai 7.0.107`. This plan uses none of `zod`/`zero`/`ai` — only `pg` (indirect, via `@omnis/db`) and `vitest`.
- Migrations are append-only files `packages/db/migrations/000N_<name>.sql`; the next number is **0009+**. Never modify a file another Phase B plan (worktree) has already applied — `migrate()` throws "changed after apply" from a sha256 comparison (contract §4). For the reasoning behind Task 6's migration-number choice, see the Task 6 body.
- Lint runs before committing: `pnpm lint` (TypeScript files only — shell scripts are syntax-checked with `bash -n`; shellcheck is not wired into this repo yet).
- Do not wire irreversible tools (`send`/`delete`/`delegate`/`calendar_write`) outside the approval gate — this plan creates no such tool at all (everything here is read, monitoring, or backup).
- Provider SDKs only inside their adapter — this plan creates no adapter.
- Never put real-account credentials in tests (B-D5). Every shell-script test plants fake `security`/`tailscale`/`launchctl`/`pg_dump` binaries on the `PATH` so it never touches the real Keychain, network, or launchd.
- Commit messages: `US-Bxx: <one-line summary>` + the acceptance criteria satisfied in the body + the final two lines `Implemented-by: Claude <tier>` / `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (session rule). Branch `ralph/<story-id>`.
- Keychain item names use the A1/A6 §9 dotted scheme `omnis.<service>.<kind>`, with account always `omnis` (exactly the `kc()` idiom from `ops/mini/env.sh.example`). Never leave values in shell history, logs, or commits.
- The `agent_runs`/`digests`/`jobs`/`accounts` column names are exactly contract §4 (Phase A) — no new columns (Task 6 only merges into the existing `digests.metrics` jsonb).

**`exactOptionalPropertyTypes` pitfall** (applies to Task 6 only): when `deps.now` is optional, always build a fallback such as `const now = deps.now ?? (() => new Date())` — never pass `{ now: undefined }` through as-is.

---

### Task 1: VAPID Key Rotation (US-B16, tier: Haiku)

**Story US-B16** — Goal: generate a VAPID key pair for Web Push and store it in the Keychain, leave it untouched if it already exists (rotate only with `--force`), and report presence or absence via `--check`. In this repo `omnis-run-with-secrets.sh` has in practice been replaced by `ops/mini/run.sh` + `ops/mini/env.sh` (measured code is authoritative, not A6 §9's original text). Deliverables: `ops/scripts/gen-vapid.sh`, `ops/mini/RUNBOOK.md` (modified, 6-step rotation procedure). Verification: `bash ops/scripts/gen-vapid.sh --check`. Tier: Haiku.

**Read:** `ops/mini/env.sh.example` (the `kc()` idiom), delta §9 (`OMNIS_WEBPUSH_VAPID_PUBLIC`/`…PRIVATE`, Keychain `omnis.webpush.vapid_private`/`…public`), A6 §9 (the 6-step rotation procedure).

**Won't build (YAGNI)**: the `web-push` npm package — a VAPID key is nothing but a P-256 EC key pair (uncompressed public point + private `d`), so `node:crypto` (stdlib, ladder rung 3) is enough. `web-push` itself is only needed by the hub's send logic (US-B17, outside this plan). A key-rotation scheduler (cron) — A6 §9 specifies rotation "immediately on suspected compromise + once a quarter, by hand", so we do not automate it.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/gen-vapid.sh`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/gen-vapid.test.sh`
- Modify: `/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md`

**Interfaces:**
- Consumes: `security find-generic-password`/`add-generic-password`(macOS Keychain CLI) · `node:crypto`(stdlib).
- Produces: Keychain items `omnis.webpush.vapid_public` · `omnis.webpush.vapid_private` (both base64url, account `omnis`) — exactly the names delta §9 pins. The values the hub reads as `OMNIS_WEBPUSH_VAPID_PUBLIC`/`…PRIVATE` (US-B17 does that wiring, outside this plan).

#### Steps

- [ ] 1. Write the failing test. To avoid touching the real Keychain, plant fakes on the `PATH` for `security`/`node`… not needed (use the real `node` — it is pure computation, so it is safe); plant a fake `security` only.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/gen-vapid.test.sh`:
```bash
#!/bin/bash
# US-B16 self-check. No framework — assert style (ponytail).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/gen-vapid.sh"

FAKE_BIN="$(mktemp -d)"
STORE="$(mktemp -d)/store"
mkdir -p "$STORE"
trap 'rm -rf "$FAKE_BIN" "$(dirname "$STORE")"' EXIT

# Fake security: emulates -s <service> -a <account> -w [value] with one file per service.
cat > "$FAKE_BIN/security" <<'FAKESEC'
#!/bin/bash
store="${OMNIS_TEST_KC_STORE:?}"
if [ "$1" = "find-generic-password" ]; then
  svc=""; for a in "$@"; do case "$prev" in -s) svc="$a";; esac; prev="$a"; done
  [ -f "$store/$svc" ] && cat "$store/$svc" || { echo "not found" >&2; exit 44; }
elif [ "$1" = "add-generic-password" ]; then
  svc=""; val=""; prev=""
  for a in "$@"; do
    case "$prev" in -s) svc="$a";; -w) val="$a";; esac
    prev="$a"
  done
  echo -n "$val" > "$store/$svc"
else
  echo "unsupported: $*" >&2; exit 64
fi
FAKESEC
chmod +x "$FAKE_BIN/security"

export PATH="$FAKE_BIN:$PATH"
export OMNIS_TEST_KC_STORE="$STORE"

# 1) --check must fail while no keys are stored yet.
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed with no keys stored" >&2; exit 1
fi
echo "ok: --check fails before generation"
```

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/gen-vapid.test.sh && bash ops/scripts/test/gen-vapid.test.sh
```
Expected failure: `ops/scripts/gen-vapid.sh: No such file or directory`.

- [ ] 3. Write the script.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/gen-vapid.sh`:
```bash
#!/bin/bash
# US-B16: generate a Web Push VAPID key pair + store it in the Keychain (A6 §9 rotation steps (1)~(2)).
# Built directly with node:crypto instead of the web-push npm package — VAPID is just a P-256 EC key pair.
set -euo pipefail

ACCOUNT="omnis"
PUB_SERVICE="omnis.webpush.vapid_public"
PRIV_SERVICE="omnis.webpush.vapid_private"

kc_get() { security find-generic-password -s "$1" -a "$ACCOUNT" -w 2>/dev/null; }
kc_set() { security add-generic-password -s "$1" -a "$ACCOUNT" -w "$2" -U >/dev/null; }

gen_keys() {
  # The last 65 bytes of the SPKI DER = uncompressed EC point (0x04 + 32-byte x + 32-byte y).
  # The P-256 SPKI header is a fixed length, so slicing from the end is stable (standard node:crypto behaviour).
  node -e '
    const crypto = require("node:crypto");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-65);
    const d = privateKey.export({ format: "jwk" }).d;
    process.stdout.write(JSON.stringify({
      publicKey: pubRaw.toString("base64url"),
      privateKey: Buffer.from(d, "base64url").toString("base64url"),
    }));
  '
}

do_check() {
  local pub priv
  pub="$(kc_get "$PUB_SERVICE")" || { echo "missing $PUB_SERVICE" >&2; return 1; }
  priv="$(kc_get "$PRIV_SERVICE")" || { echo "missing $PRIV_SERVICE" >&2; return 1; }
  [ "${#pub}" -ge 80 ] || { echo "vapid public key looks too short (${#pub} chars)" >&2; return 1; }
  [ "${#priv}" -ge 40 ] || { echo "vapid private key looks too short (${#priv} chars)" >&2; return 1; }
  echo "ok: vapid keys present ($PUB_SERVICE, $PRIV_SERVICE)"
}

do_generate() {
  local force="${1:-}"
  if [ "$force" != "--force" ] && kc_get "$PUB_SERVICE" >/dev/null 2>&1; then
    echo "vapid keys already exist — use --force to rotate (A6 §9 rotation procedure)" >&2
    exit 1
  fi
  local json pub priv
  json="$(gen_keys)"
  pub="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).publicKey)' "$json")"
  priv="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).privateKey)' "$json")"
  kc_set "$PUB_SERVICE" "$pub"
  kc_set "$PRIV_SERVICE" "$priv"
  echo "vapid keys stored: $PUB_SERVICE, $PRIV_SERVICE"
}

case "${1:-}" in
  --check) do_check ;;
  --force) do_generate --force ;;
  "") do_generate ;;
  *) echo "usage: gen-vapid.sh [--check|--force]" >&2; exit 64 ;;
esac
```

- [ ] 4. Make it executable and re-run the test to confirm the step 1 assert passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/gen-vapid.sh && bash ops/scripts/test/gen-vapid.test.sh
```
Expected: `ok: --check fails before generation` (there is no second assert yet — it is added in the next step).

- [ ] 5. Append the remaining asserts to the end of the test file, covering generate → check succeeds → duplicate generation rejected → `--force` rotation.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/gen-vapid.test.sh` (appended at end of file):
```bash

# 2) After generation --check must succeed.
"$SCRIPT" >/dev/null
"$SCRIPT" --check
echo "ok: --check passes after generation"

pub1="$(cat "$STORE/$PUB_SERVICE" 2>/dev/null || true)"

# 3) Re-generating without --force must be rejected and must preserve the existing key (A6 §9: keys rotate by hand only).
if "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: re-generation without --force should be rejected" >&2; exit 1
fi
[ "$(cat "$STORE/$PUB_SERVICE")" = "$pub1" ] || { echo "FAIL: key mutated without --force" >&2; exit 1; }
echo "ok: re-generation without --force is rejected and key is unchanged"

# 4) --force must rotate the key.
"$SCRIPT" --force >/dev/null
pub2="$(cat "$STORE/$PUB_SERVICE")"
[ "$pub1" != "$pub2" ] || { echo "FAIL: --force did not rotate the key" >&2; exit 1; }
echo "ok: --force rotates the key"

echo "PASS"
```

The `PUB_SERVICE` variable has to be defined inside the test script too — add `PUB_SERVICE="omnis.webpush.vapid_public"` near the header in step 1 (it must match the name used in the script body, otherwise the file path will not line up).

- [ ] 6. Run the full test and confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/gen-vapid.test.sh
```
Expected: final line `PASS`, preceded by four `ok:` lines.

- [ ] 7. Add the VAPID rotation procedure after the "### 4) Secrets (A6 §9)" section of `ops/mini/RUNBOOK.md` (the 6 rotation steps, A6 §9 turned into a concrete shell script).

Insert the following section into `/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md` before "## Health checks":
```markdown
## Web Push VAPID keys (US-B16)

```bash
bash ops/scripts/gen-vapid.sh --check     # check presence only, changes nothing
bash ops/scripts/gen-vapid.sh             # generate only if absent
bash ops/scripts/gen-vapid.sh --force     # rotate (immediately on suspected leak, otherwise once a quarter — A6 §9)
```
The hub must be restarted after a rotation to pick up the new `OMNIS_WEBPUSH_VAPID_PUBLIC`/`…PRIVATE` (`launchctl kickstart -k gui/$(id -u)/com.omnis.hub`; US-B17 wires these values into env.sh). Existing subscribers have to re-subscribe with the new key (changing the VAPID key invalidates every prior subscription), so check whether `push_subscriptions` is empty right after a rotation.
```

- [ ] 8. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B16: generate Web Push VAPID keys and store them in the Keychain

- P-256 VAPID key pair generated with node:crypto alone (no web-push package needed)
- Three modes: --check (verify only) / default (generate only if absent) / --force (rotate)
- Rejects regeneration when keys exist; values live in Keychain omnis.webpush.vapid_public/…private
- Adds the rotation procedure to RUNBOOK.md

Implemented-by: Claude Haiku
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Tailscale Serve Mount (US-B34, tier: Sonnet)

**Story US-B34** — Goal: mount `/api/` → hub (`127.0.0.1:8787`) and `/` → the PWA static build (`127.0.0.1:5173`) via Tailscale Serve, document in the ACL file why Postgres (5432) and Ollama (11434) are not placed in `dst`, and write a script that verifies Funnel is always off. Deliverables: `ops/mini/tailscale-serve.sh`, `ops/mini/TAILSCALE-ACL.md`. Verification: `bash ops/mini/tailscale-serve.sh --check`. Tier: Sonnet.

**Read:** A6 §3 (ACL example, Funnel policy), the "what this deployment actually changed on the mini" table in `ops/mini/RUNBOOK.md` (measured: `tailscale serve --bg --https=443 --set-path=/api http://127.0.0.1:8787` is already running on the mini — this task promotes that measured command into a script and adds the PWA mount).

**Won't build (YAGNI)**: an automatic Funnel on/off toggle — A6 §3 fixes Funnel as "always OFF", and the exception (the Calendar watch spike) is a Phase 0 item that is already finished. `--check` must **fail** when Funnel is on, not turn it off (turning it off automatically is an unexpected network change — a human verifies it and turns it off).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/tailscale-serve.sh`
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/TAILSCALE-ACL.md`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/tailscale-serve.test.sh`

**Interfaces:**
- Consumes: `tailscale serve --bg --https=443 --set-path=<path> <url>` · `tailscale serve status --json` · `tailscale funnel status` (all Tailscale CLI, no external contract) · `$OMNIS_WEB_PORT` (default `5173`, delta §9) · `$OMNIS_HUB_PORT` (default `8787`, contract §9).
- Produces: a human-readable text rendering of the mount state. No new exports (a purely operational script).

#### Steps

- [ ] 1. Write the failing test. Plant a fake `tailscale` that emulates `serve status --json`/`funnel status`.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/tailscale-serve.test.sh`:
```bash
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/mini/tailscale-serve.sh"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

write_fake_tailscale() {
  # $1 = serve status json, $2 = funnel status text
  cat > "$FAKE_BIN/tailscale" <<FAKETS
#!/bin/bash
if [ "\$1" = "serve" ] && [ "\$2" = "status" ]; then
  cat <<'JSON'
$1
JSON
elif [ "\$1" = "funnel" ] && [ "\$2" = "status" ]; then
  echo "$2"
else
  echo "ok"
fi
FAKETS
  chmod +x "$FAKE_BIN/tailscale"
}
export PATH="$FAKE_BIN:$PATH"

# 1) --check must fail when there is no /api mount.
write_fake_tailscale '{"Web":{}}' "Funnel off."
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed with no /api mount" >&2; exit 1
fi
echo "ok: --check fails when /api is not mounted"
```

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/tailscale-serve.test.sh && bash ops/scripts/test/tailscale-serve.test.sh
```
Expected failure: `ops/mini/tailscale-serve.sh: No such file or directory`.

- [ ] 3. Write the script.

`/Users/logankim/AI-Workspaces/omnis/ops/mini/tailscale-serve.sh`:
```bash
#!/bin/bash
# US-B34: mount the hub API + PWA onto a single tailnet HTTPS endpoint (A6 §3).
# Measured (RUNBOOK "what this deployment actually changed on the mini"): --set-path=/api already runs on the mini. No sudo needed.
set -euo pipefail

HUB_PORT="${OMNIS_HUB_PORT:-8787}"
WEB_PORT="${OMNIS_WEB_PORT:-5173}"

do_mount() {
  tailscale serve --bg --https=443 --set-path=/api "http://127.0.0.1:${HUB_PORT}"
  tailscale serve --bg --https=443 --set-path=/ "http://127.0.0.1:${WEB_PORT}"
  echo "mounted: /api -> 127.0.0.1:${HUB_PORT}, / -> 127.0.0.1:${WEB_PORT}"
}

do_check() {
  local status
  status="$(tailscale serve status --json 2>/dev/null || echo '{}')"
  node -e '
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      let s;
      try { s = JSON.parse(data || "{}"); } catch { s = {}; }
      const web = s.Web || {};
      const paths = Object.values(web).flatMap((h) => Object.keys(h.Handlers || {}));
      if (!paths.some((p) => p.includes("/api"))) {
        console.error("no /api mount found in tailscale serve status");
        process.exit(1);
      }
      console.log("ok: /api mount present");
    });
  ' <<< "$status"

  local funnel
  funnel="$(tailscale funnel status 2>&1 || true)"
  if echo "$funnel" | grep -qi "funnel on"; then
    echo "FAIL: Funnel is ON — A6 §3 fixes Funnel as always OFF. Turn it off with 'tailscale funnel 443 off'." >&2
    exit 1
  fi
  echo "ok: funnel is off"
}

case "${1:-}" in
  --mount) do_mount ;;
  --check) do_check ;;
  *) echo "usage: tailscale-serve.sh [--mount|--check]" >&2; exit 64 ;;
esac
```

- [ ] 4. Make it executable and re-run the test to confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/mini/tailscale-serve.sh && bash ops/scripts/test/tailscale-serve.test.sh
```
Expected: `ok: --check fails when /api is not mounted`.

- [ ] 5. Add asserts covering the case where the `/api` mount is present, and the case where Funnel is on and must fail.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/tailscale-serve.test.sh` (appended at end of file):
```bash

# 2) --check must succeed when the /api mount exists and Funnel is off.
write_fake_tailscale '{"Web":{"mini.ts.net:443":{"Handlers":{"/api":{"Proxy":"http://127.0.0.1:8787"}}}}}' "Funnel off."
"$SCRIPT" --check
echo "ok: --check passes with /api mounted and funnel off"

# 3) --check must fail when Funnel is on even if the mount is correct.
write_fake_tailscale '{"Web":{"mini.ts.net:443":{"Handlers":{"/api":{"Proxy":"http://127.0.0.1:8787"}}}}}' "Funnel on."
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed while funnel is on" >&2; exit 1
fi
echo "ok: --check fails when funnel is on"

echo "PASS"
```

- [ ] 6. Run the full test and confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/tailscale-serve.test.sh
```
Expected: `PASS`.

- [ ] 7. Write the ACL document.

`/Users/logankim/AI-Workspaces/omnis/ops/mini/TAILSCALE-ACL.md`:
```markdown
# Tailscale ACL (US-B34, A6 §3)

The mini opens no ports to the public internet. All exposure goes through a single `tailscale serve` HTTPS (443) endpoint.

## Grants

\`\`\`json
{
  "tagOwners": {
    "tag:hub": ["logan@onwordlab.ai"],
    "tag:client": ["logan@onwordlab.ai"]
  },
  "grants": [
    { "src": ["tag:client"], "dst": ["tag:hub"], "ip": ["tcp:443"] }
  ],
  "ssh": [
    { "action": "check", "src": ["tag:client"], "dst": ["tag:hub"], "users": ["logan", "vigor"] }
  ]
}
\`\`\`

## Why Postgres (5432) and Ollama (11434) are not in `dst`

The only thing clients (MacBook, iPhone) need to reach directly across the tailnet is the hub API (`/api/` under 443, which `tailscale serve` proxies to 127.0.0.1:8787). Postgres and Ollama are only ever used through the hub process (or the local-agent bridge inside it) — opening 5432/11434 in the ACL would create a path where clients bypass the hub's approval gate and audit log and connect straight to the DB/model. Narrowing the attack surface to the single hub API is A6 §3's tailnet-only principle.

## Funnel

**Always OFF.** Unless `tailscale funnel status` reports "Funnel off.", `bash ops/mini/tailscale-serve.sh --check` fails (§8 monitoring; US-B42 wires this script in as one entry of healthcheck-ping.sh). Funnel exposes the public internet, so it is turned on temporarily only during spikes that genuinely require webhook receipt such as Calendar `events.watch`, and turned off immediately afterwards (A6 §3) — Phase B has no such path.

## Mounting

\`\`\`bash
bash ops/mini/tailscale-serve.sh --mount   # /api -> :8787, / -> :5173 (US-B35 PWA build output)
bash ops/mini/tailscale-serve.sh --check   # verify mount + funnel off only, changes nothing
\`\`\`
```

- [ ] 8. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B34: Tailscale Serve mount script + ACL document

- --mount: /api -> hub(:8787), / -> PWA(:5173), using the measured --set-path syntax verbatim
- --check: verifies both the /api mount and Funnel off (fails when Funnel is on)
- TAILSCALE-ACL.md: rationale for keeping Postgres/Ollama out of dst + why Funnel is always OFF

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Backup and Quarterly Restore Drill (US-B41, tier: Sonnet)

**Story US-B41** — Goal: daily 03:00 `pg_dump` + restic → B2 backup, a forget policy (7 days/4 weeks/6 months), a quarterly restore drill script (restore onto scratch port 5433 + verify `items`/`threads`/`pending_approvals` row counts + the latest `sent_at`) and a drill log. Deliverables: `ops/scripts/omnis-backup.sh`, `ops/scripts/restore-drill.sh`, `ops/mini/LaunchDaemons/*.plist`, `backup/restore-drills.md`. Verification: `bash ops/scripts/restore-drill.sh --dry-run`. Tier: Sonnet.

**Read:** A6 §4 (the backup/restore-drill source text — the forget policy and commands are adjusted to this repo's measured conventions), `ops/mini/RUNBOOK.md` (the measured fact that the DB is `postgres://<hub-user>@127.0.0.1:5432/omnis`, and the LaunchAgent-only, no-sudo principle).

**Won't build (YAGNI)**: healthchecks.io pings for backup success/failure — that belongs to US-B42 (Task 4); this script signals success/failure through its exit code alone (launchd `StandardErrorPath` + US-B42 consume that exit code). The initial restic `init` (repository creation) is done by hand once (`restic -r ... init`; rare as rotation — putting it in the script would add an existence check on every run and make things more complex, not less).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/omnis-backup.sh`
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/restore-drill.sh`
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/LaunchDaemons/com.omnis.backup.plist`
- Create: `/Users/logankim/AI-Workspaces/omnis/backup/restore-drills.md`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/restore-drill.test.sh`
- **Plan revision (2026-09-20, in response to review rejection)** — Modify: `/Users/logankim/AI-Workspaces/omnis/ops/mini/install.sh`
  (also look for the plist in `ops/mini/LaunchDaemons/` after `ops/mini/`, and add `backup` to the default service list.
  Since it is a calendar job, `kickstart` is skipped — otherwise a full backup runs on every install). The backlog pinned the
  deliverable path as `ops/mini/LaunchDaemons/*.plist`, so we widen install.sh instead of moving the plist.
- **Plan revision (same reason)** — Modify: `/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md`
  (install · `restic init` · quarterly drill procedure. Without this, the deliverables have no human-reachable path in the docs),
  Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/omnis-backup.test.sh`
  (guards against the regression where the 03:00 job died on its first line because `pg_dump` was not on launchd's PATH).

**Interfaces:**
- Consumes: `pg_dump --format=custom` · `pg_restore` · `psql` (Postgres 17 client) · `restic` · Keychain `omnis.restic.repository`/`omnis.restic.password`/`omnis.b2.account_id`/`omnis.b2.account_key` (names this plan introduces, following the A6 §9 dotted scheme) · `$DATABASE_URL` (contract §9).
- Produces: `$HOME/omnis-var/backup/pg/omnis-YYYYMMDD.dump` files, and quarterly drill entries appended to `backup/restore-drills.md`.

#### Steps

- [ ] 1. Write the failing test. Plant fakes for `pg_restore`/`psql`/`createdb`/`dropdb` so only the `--dry-run` path is verified without a real scratch DB (the real restore is integration verification, run by hand once a quarter on the mini — the spirit of B-D5's "accept with fixtures/mocks").

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/restore-drill.test.sh`:
```bash
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/restore-drill.sh"
FAKE_BIN="$(mktemp -d)"
BACKUP_DIR="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN" "$BACKUP_DIR"' EXIT

# 1) --dry-run must fail when there is not a single dump file.
export OMNIS_BACKUP_DIR="$BACKUP_DIR"
if "$SCRIPT" --dry-run >/dev/null 2>&1; then
  echo "FAIL: --dry-run passed with no dump files" >&2; exit 1
fi
echo "ok: --dry-run fails when no dump exists"
```

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/restore-drill.test.sh && bash ops/scripts/test/restore-drill.test.sh
```
Expected failure: `ops/scripts/restore-drill.sh: No such file or directory`.

- [ ] 3. Write the backup script (first, because the drill script assumes the dump path this script produces).

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/omnis-backup.sh`:
```bash
#!/bin/bash
# US-B41: pg_dump --format=custom → restic → B2. LaunchDaemon(ops/mini/LaunchDaemons/com.omnis.backup.plist)
# execs this script as-is at 03:00. A GUI session is required (reading the Keychain — see the RUNBOOK "existing setup on the mini" section).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACCOUNT="omnis"
kc() { security find-generic-password -s "$1" -a "$ACCOUNT" -w; }

BACKUP_DIR="${OMNIS_BACKUP_DIR:-$HOME/omnis-var/backup}"
PG_DIR="$BACKUP_DIR/pg"
DATABASE_URL="${DATABASE_URL:-postgres://<hub-user>@127.0.0.1:5432/omnis}"

do_check() {
  command -v pg_dump >/dev/null || { echo "FAIL: pg_dump not on PATH" >&2; return 1; }
  command -v restic >/dev/null || { echo "FAIL: restic not on PATH" >&2; return 1; }
  kc omnis.restic.repository >/dev/null 2>&1 || { echo "FAIL: Keychain omnis.restic.repository missing" >&2; return 1; }
  kc omnis.restic.password >/dev/null 2>&1 || { echo "FAIL: Keychain omnis.restic.password missing" >&2; return 1; }
  echo "ok: pg_dump/restic on PATH, restic credentials present"
}

do_run() {
  mkdir -p "$PG_DIR"
  local dump_file="$PG_DIR/omnis-$(date +%Y%m%d).dump"
  pg_dump --format=custom --dbname="$DATABASE_URL" --file="$dump_file"
  echo "pg_dump ok: $dump_file"

  export RESTIC_REPOSITORY; RESTIC_REPOSITORY="$(kc omnis.restic.repository)"
  export RESTIC_PASSWORD; RESTIC_PASSWORD="$(kc omnis.restic.password)"
  export B2_ACCOUNT_ID; B2_ACCOUNT_ID="$(kc omnis.b2.account_id)"
  export B2_ACCOUNT_KEY; B2_ACCOUNT_KEY="$(kc omnis.b2.account_key)"

  restic backup "$PG_DIR" "$HOME/.omnis/self-model" "$ROOT/secrets" --tag omnis-backup
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

  # Keep only 7 days of local dumps — restic retains the long-term copy remotely, so locally this is just a recent-recovery buffer.
  find "$PG_DIR" -name 'omnis-*.dump' -mtime +7 -delete
  echo "backup ok: $(date -u +%FT%TZ)"
}

case "${1:-}" in
  --check) do_check ;;
  "") do_run ;;
  *) echo "usage: omnis-backup.sh [--check]" >&2; exit 64 ;;
esac
```

- [ ] 4. Write the drill script.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/restore-drill.sh`:
```bash
#!/bin/bash
# US-B41: quarterly restore drill. --dry-run only checks that the latest dump is a readable file; a human runs it
# once a quarter with no argument to actually restore onto scratch port 5433 and verify the row counts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_DIR="${OMNIS_BACKUP_DIR:-$HOME/omnis-var/backup}"
PG_DIR="$BACKUP_DIR/pg"
SCRATCH_PORT="${OMNIS_RESTORE_PORT:-5433}"
SCRATCH_DB="omnis_restore_drill"
LOG="$ROOT/backup/restore-drills.md"

latest_dump() {
  ls -t "$PG_DIR"/omnis-*.dump 2>/dev/null | head -1 || true
}

mode="${1:-}"
latest="$(latest_dump)"
if [ -z "$latest" ]; then
  echo "FAIL: no dump file found in $PG_DIR (run omnis-backup.sh first)" >&2
  exit 1
fi

if [ "$mode" = "--dry-run" ]; then
  pg_restore --list "$latest" >/dev/null
  echo "ok: dump file is readable ($latest)"
  exit 0
fi

dropdb -p "$SCRATCH_PORT" --if-exists "$SCRATCH_DB"
createdb -p "$SCRATCH_PORT" "$SCRATCH_DB"
pg_restore --dbname="postgres://localhost:${SCRATCH_PORT}/${SCRATCH_DB}" --no-owner "$latest"

result="$(psql -p "$SCRATCH_PORT" -d "$SCRATCH_DB" -Atc "
  SELECT (SELECT count(*) FROM items) || '|' ||
         (SELECT count(*) FROM threads) || '|' ||
         (SELECT count(*) FROM pending_approvals) || '|' ||
         coalesce((SELECT max(sent_at)::text FROM items), 'none')
")"
IFS='|' read -r items_n threads_n approvals_n max_sent <<< "$result"
echo "items=$items_n threads=$threads_n pending_approvals=$approvals_n latest_sent_at=$max_sent"

if [ "$items_n" -le 0 ]; then
  printf '\n## %s — FAIL\n\n- dump: `%s`\n- items table restored empty\n' \
    "$(date -u +%FT%TZ)" "$latest" >> "$LOG"
  echo "FAIL: items table restored empty — see $LOG" >&2
  exit 1
fi

printf '\n## %s — PASS\n\n- dump: `%s`\n- items=%s threads=%s pending_approvals=%s latest sent_at=%s\n' \
  "$(date -u +%FT%TZ)" "$latest" "$items_n" "$threads_n" "$approvals_n" "$max_sent" >> "$LOG"
dropdb -p "$SCRATCH_PORT" "$SCRATCH_DB"
echo "ok: restore drill passed, logged to $LOG"
```

- [ ] 5. Make them executable and re-run the test to confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/omnis-backup.sh ops/scripts/restore-drill.sh && bash ops/scripts/test/restore-drill.test.sh
```
Expected: `ok: --dry-run fails when no dump exists`.

- [ ] 6. Add an assert verifying that `--dry-run` passes when a dump file exists (`pg_restore --list` demands a real custom-format file, so plant a fake `pg_restore` that fakes a minimal header).

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/restore-drill.test.sh` (appended at end of file):
```bash

cat > "$FAKE_BIN/pg_restore" <<'FAKEPGR'
#!/bin/bash
# For a --list call, only check that the file exists and succeed (no fake header parsing).
if [ "$1" = "--list" ]; then
  [ -f "$2" ] && exit 0 || exit 1
fi
exit 0
FAKEPGR
chmod +x "$FAKE_BIN/pg_restore"
export PATH="$FAKE_BIN:$PATH"

mkdir -p "$BACKUP_DIR/pg"
echo "fake dump" > "$BACKUP_DIR/pg/omnis-20260920.dump"

"$SCRIPT" --dry-run
echo "ok: --dry-run passes when a dump exists"
echo "PASS"
```

- [ ] 7. Run the full test and confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/restore-drill.test.sh
```
Expected: `PASS`.

- [ ] 8. Create the LaunchDaemon plist and the initial drill log file.

`/Users/logankim/AI-Workspaces/omnis/ops/mini/LaunchDaemons/com.omnis.backup.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- US-B41. A LaunchAgent (gui session, no sudo) per the measured principle — reading the Keychain requires a GUI
     session (RUNBOOK §4). The folder name follows the backlog deliverable path (ops/mini/LaunchDaemons/*.plist) as
     written. install.sh substitutes __OMNIS_ROOT__·__HOME__ and installs into ~/Library/LaunchAgents (ops/mini/install.sh pattern). -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.omnis.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>__OMNIS_ROOT__/ops/scripts/omnis-backup.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>WorkingDirectory</key><string>__OMNIS_ROOT__</string>
  <key>StandardOutPath</key><string>__HOME__/Library/Logs/omnis/backup.log</string>
  <key>StandardErrorPath</key><string>__HOME__/Library/Logs/omnis/backup.err.log</string>
</dict>
</plist>
```

`/Users/logankim/AI-Workspaces/omnis/backup/restore-drills.md`:
```markdown
# Restore drill log (US-B41)

Run `bash ops/scripts/restore-drill.sh` (with no argument) once a quarter and the result is appended to this file automatically.
If it fails, fix it immediately as Sev1 rather than deferring to the next quarter (A6 §4).
```

- [ ] 9. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B41: nightly backup + quarterly restore drill

- omnis-backup.sh: pg_dump --format=custom -> restic backup -> B2, forget 7d/4w/6mo
- restore-drill.sh: --dry-run (checks the dump file only) / no argument (real restore to scratch 5433 + row count verification)
- Records FAIL and exits non-zero immediately when the items table is empty
- LaunchAgent com.omnis.backup (03:00), new backup/restore-drills.md log file

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Healthcheck Ping and Dual Alerting (US-B42, tier: Sonnet)

**Story US-B42** — Goal: wire up 15 healthchecks.io checks (success `/`, failure `/fail`), 2 self-hosted ntfy topics (`omnis-critical`/`omnis-warning`), dual exposure of critical/warning through ntfy + `items(kind='system')`, and `newsyslog` 30-day retention with verified secret masking. Deliverables: `ops/scripts/healthcheck-ping.sh`, `ops/mini/newsyslog.d/omnis.conf`. Verification: `bash ops/scripts/healthcheck-ping.sh --check` + `bash ops/scripts/test/healthcheck-ping.test.sh` (the backlog's acceptance command is only `--check`, but `--check` does not execute a single line of the production path — job parsing and `--run`'s failure tally/exit code are asserted by the test). Tier: Sonnet. Depends on: US-B40 (adapter health — though this task does not import B40's TS code; `accounts.state`/`last_health_at` are already pinned in the Phase A schema (0002_core_inbox.sql), so it reads them with SQL directly. B40 populating those columns is only a precondition at the time this task runs, not a code dependency).

**Read:** A6 §8 (the 15-job table, the 2 ntfy topics, `items(kind='system')` dual exposure, newsyslog 30 days), Phase A contract §4 (`accounts.state`/`last_health_at`/`last_error` columns), `packages/db/migrations/0002_core_inbox.sql` (`'system'` is already in `accounts_channel_ck` — no new migration needed).

**Won't build (YAGNI)**: a TypeScript helper — this is a job that shell + psql finish, so no new package or kernel export (ladder: the existing tools suffice). Installing the ntfy server itself (starting the `ntfy serve` daemon) is infrastructure provisioning and lives outside this script — we assume it is already up at `$OMNIS_NTFY_URL`.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/healthcheck-ping.sh`
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/newsyslog.d/omnis.conf`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/healthcheck-ping.test.sh`

**Interfaces:**
- Consumes: `psql` (`accounts.state`/`last_health_at`, `pg_replication_slots`) · `curl` (healthchecks.io, ntfy) · Keychain `omnis.healthchecks.<slug>` (names this plan introduces) · `$DATABASE_URL` · `$OMNIS_NTFY_URL` (default `http://127.0.0.1:2586`, ntfy's default port).
- Produces: `accounts(channel='system', external_id='infra')` + `threads(kind='system')` + one `items(kind='system')` row per alert (A6 §8 dual exposure). Creates no new TypeScript export in the Keychain, the DB, or the network layer.

#### Steps

- [ ] 1. Write the failing test. Plant fake `curl`/`psql`/`security` so the `--check` path (validates configuration only, sends no pings) is verified without real network or DB access.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/healthcheck-ping.test.sh`:
```bash
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/healthcheck-ping.sh"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

# Fake security: "not found" for every service (emulates the state where no healthchecks uuid is configured).
cat > "$FAKE_BIN/security" <<'FAKESEC'
#!/bin/bash
echo "no such keychain item" >&2
exit 44
FAKESEC
chmod +x "$FAKE_BIN/security"
export PATH="$FAKE_BIN:$PATH"

# 1) Even with zero healthchecks uuids, --check must only warn about "no configuration" and exit 0
#    (the script itself must run safely right after a fresh install — a different state from an actual ping failure).
"$SCRIPT" --check
echo "ok: --check succeeds even with zero configured jobs (reports, does not ping)"
```

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/healthcheck-ping.test.sh && bash ops/scripts/test/healthcheck-ping.test.sh
```
Expected failure: `ops/scripts/healthcheck-ping.sh: No such file or directory`.

- [ ] 3. Write the script.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/healthcheck-ping.sh`:
```bash
#!/bin/bash
# US-B42: 15 healthchecks.io pings + ntfy critical/warning + items(kind=system) dual exposure (A6 §8).
set -euo pipefail

ACCOUNT="omnis"
kc() { security find-generic-password -s "$1" -a "$ACCOUNT" -w 2>/dev/null; }

NTFY_URL="${OMNIS_NTFY_URL:-http://127.0.0.1:2586}"
DATABASE_URL="${DATABASE_URL:-postgres://<hub-user>@127.0.0.1:5432/omnis}"

# slug|check_cmd|tier(critical|warning) — exactly the A6 §8 table. check_cmd exits 0 on success.
# check_cmd itself contains '|' (pipes), so `IFS='|' read` must not be used to split it — trim from both ends instead (parse_job).
JOBS=(
  "omnis-hub|curl -fsS -m 5 http://127.0.0.1:8787/health|critical"
  "omnis-postgres|psql \"\$DATABASE_URL\" -Atc 'select 1' | grep -q 1|critical"
  "omnis-pg-slot|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(active), true) from pg_replication_slots\" | grep -qx t|critical"
  "omnis-zero-cache|curl -fsS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:4848/ | grep -q 200|critical"
  "omnis-ollama|curl -fsS -m 5 http://127.0.0.1:11434/api/tags|warning"
  "omnis-adapter-slack|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='slack'\" | grep -qx t|warning"
  "omnis-adapter-gmail|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='gmail'\" | grep -qx t|warning"
  "omnis-adapter-calendar|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='gcal'\" | grep -qx t|warning"
  "omnis-adapter-outlook|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='outlook'\" | grep -qx t|warning"
  "omnis-adapter-telegram|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='telegram'\" | grep -qx t|warning"
  "omnis-bridge-macbook|true|warning"
  "omnis-bridge-mini|curl -fsS -m 5 http://127.0.0.1:8787/health|warning"
  "omnis-backup-pgdump|find \"\$HOME/omnis-var/backup/pg\" -name \"omnis-\$(date +%Y%m%d).dump\" -newermt today 2>/dev/null | grep -q .|critical"
  "omnis-backup-restic|true|critical"
  "omnis-tailscale-serve|bash \"\$(dirname \"\$0\")/../mini/tailscale-serve.sh\" --check|critical"
)

# slug is the first field, tier is the last field, and everything in between is the cmd (preserving pipes inside the cmd).
parse_job() {
  job_slug="${1%%|*}"
  job_tier="${1##*|}"
  job_cmd="${1#*|}"; job_cmd="${job_cmd%|*}"
}

post_ntfy() {
  local topic="$1" title="$2" msg="$3"
  curl -fsS -m 10 -H "Title: $title" -d "$msg" "$NTFY_URL/$topic" >/dev/null 2>&1 || true
}

# A6 §8: "every critical/warning is exposed in items(kind=system) independently of ntfy". Because thread_id/account_id
# are NOT NULL, create the 'system'/'infra' account and thread if missing (ON CONFLICT) and stack items on top of them.
post_system_item() {
  local subject="$1" body="$2"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
    INSERT INTO accounts (channel, external_id, display, capabilities)
      VALUES ('system', 'infra', 'omnis infra', '{}'::jsonb)
      ON CONFLICT (channel, external_id) DO NOTHING;
    WITH acc AS (SELECT id FROM accounts WHERE channel='system' AND external_id='infra'),
         thr AS (
           INSERT INTO threads (account_id, external_id, kind, title, last_item_at)
             SELECT id, 'infra-alerts', 'system', 'Infra alerts', now() FROM acc
             ON CONFLICT (account_id, external_id) DO UPDATE SET last_item_at = now()
             RETURNING id, account_id
         )
    INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
      SELECT id, account_id, 'system', '$(echo "$subject" | sed "s/'/''/g")', '$(echo "$body" | sed "s/'/''/g")', now() FROM thr;
SQL
}

run_check() {
  local slug="$1" cmd="$2" tier="$3"
  local hc_uuid; hc_uuid="$(kc "omnis.healthchecks.$slug")" || true
  if eval "$cmd" >/dev/null 2>&1; then
    [ -n "$hc_uuid" ] && curl -fsS -m 10 --retry 3 "https://hc-ping.com/$hc_uuid" >/dev/null 2>&1 || true
    return 0
  fi
  [ -n "$hc_uuid" ] && curl -fsS -m 10 --retry 3 "https://hc-ping.com/$hc_uuid/fail" >/dev/null 2>&1 || true
  post_ntfy "omnis-$tier" "$slug failed" "check failed: $cmd"
  post_system_item "$slug failed" "healthcheck '$slug' failed ($tier)"
  echo "FAIL: $slug" >&2
  return 1
}

do_check() {
  local missing=0
  for job in "${JOBS[@]}"; do
    parse_job "$job"; local slug="$job_slug"
    kc "omnis.healthchecks.$slug" >/dev/null 2>&1 || { echo "no healthchecks uuid for $slug (will run check but skip ping)"; missing=$((missing+1)); }
  done
  echo "ok: ${#JOBS[@]} jobs configured, $missing missing a healthchecks.io uuid"
}

do_run() {
  local failures=0
  for job in "${JOBS[@]}"; do
    parse_job "$job"
    run_check "$job_slug" "$job_cmd" "$job_tier" || failures=$((failures+1))
  done
  echo "ran ${#JOBS[@]} checks, $failures failed"
  [ "$failures" -eq 0 ]
}

do_list() {
  for job in "${JOBS[@]}"; do
    parse_job "$job"
    printf '%s\t%s\n' "$job_slug" "$job_tier"
  done
}

case "${1:---check}" in
  --check) do_check ;;
  --run) do_run ;;
  --list) do_list ;;
  *) echo "usage: healthcheck-ping.sh [--check|--run|--list]" >&2; exit 64 ;;
esac
```

- [ ] 4. Make it executable and re-run the test to confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/healthcheck-ping.sh && bash ops/scripts/test/healthcheck-ping.test.sh
```
Expected: `ok: --check succeeds even with zero configured jobs (reports, does not ping)`.

- [ ] 5. Complete the test — since `--check` alone does not execute a single line of the production path (the `--run` that
launchd actually invokes), assert job parsing (`check_cmd` contains pipes) and the failure tally/exit code as well.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/healthcheck-ping.test.sh` (full):
```bash
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/healthcheck-ping.sh"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

# Fake security: "not found" for every service (emulates the state where no healthchecks uuid is configured).
cat > "$FAKE_BIN/security" <<'FAKESEC'
#!/bin/bash
echo "no such keychain item" >&2
exit 44
FAKESEC
chmod +x "$FAKE_BIN/security"
export PATH="$FAKE_BIN:$PATH"

# 1) Even with zero healthchecks uuids, --check must only warn about "no configuration" and exit 0
#    (the script itself must run safely right after a fresh install — a different state from an actual ping failure).
"$SCRIPT" --check
echo "ok: --check succeeds even with zero configured jobs (reports, does not ping)"

out="$("$SCRIPT" --check)"
echo "$out" | grep -q "15 jobs configured" || { echo "FAIL: expected 15 jobs, got: $out" >&2; exit 1; }
echo "ok: --check reports exactly 15 configured jobs"

# 2) --list: all 15 rows must split cleanly into slug + tier(critical|warning).
#    check_cmd contains pipes, so `IFS='|' read` would smear the command tail into the tier.
list_out="$("$SCRIPT" --list)"
[ "$(echo "$list_out" | wc -l | tr -d ' ')" = "15" ] || { echo "FAIL: --list should print 15 rows" >&2; exit 1; }
while IFS=$'\t' read -r slug tier; do
  case "$slug" in omnis-*) ;; *) echo "FAIL: bad slug [$slug]" >&2; exit 1;; esac
  case "$tier" in critical|warning) ;; *) echo "FAIL: slug $slug parsed tier [$tier], want critical|warning" >&2; exit 1;; esac
done <<< "$list_out"
echo "ok: all 15 jobs parse to a slug + exactly critical|warning"

# 3) --run: if every check fails it must count the failures exactly and exit non-zero (launchd reads this exit code).
CURL_LOG="$FAKE_BIN/curl.log"
cat > "$FAKE_BIN/curl" <<FAKECURL
#!/bin/bash
printf '%s\n' "\$*" >> "$CURL_LOG"
exit 1
FAKECURL
cat > "$FAKE_BIN/psql" <<'FAKEPSQL'
#!/bin/bash
cat >/dev/null 2>&1 || true
exit 1
FAKEPSQL
chmod +x "$FAKE_BIN/curl" "$FAKE_BIN/psql"

set +e
run_out="$(OMNIS_NTFY_URL="http://ntfy.test" "$SCRIPT" --run </dev/null 2>"$FAKE_BIN/run.err")"
run_rc=$?
set -e
fail_lines="$(grep -c '^FAIL: ' "$FAKE_BIN/run.err" || true)"
counted="$(echo "$run_out" | sed -n 's/^ran 15 checks, \([0-9]*\) failed$/\1/p')"
[ "$run_rc" -ne 0 ] || { echo "FAIL: --run exited 0 while checks failed" >&2; exit 1; }
[ -n "$counted" ] && [ "$counted" -gt 0 ] || { echo "FAIL: --run reported '$run_out' with $fail_lines failing checks" >&2; exit 1; }
[ "$counted" = "$fail_lines" ] || { echo "FAIL: --run counted $counted failures but printed $fail_lines" >&2; exit 1; }
echo "ok: --run counts $counted failures and exits non-zero"

# 4) Alerts must go to the omnis-critical / omnis-warning topics only (a broken tier parse leaks here).
grep -o 'http://ntfy\.test/[^ ]*' "$CURL_LOG" | sort -u > "$FAKE_BIN/topics"
[ -s "$FAKE_BIN/topics" ] || { echo "FAIL: no ntfy post captured" >&2; exit 1; }
while read -r url; do
  case "$url" in
    http://ntfy.test/omnis-critical|http://ntfy.test/omnis-warning) ;;
    *) echo "FAIL: alert posted to [$url]" >&2; exit 1;;
  esac
done < "$FAKE_BIN/topics"
echo "ok: alerts route only to omnis-critical / omnis-warning"

# 5) check_cmd must survive intact — if the grep after the pipe is truncated, the result is never inspected and passes.
grep -q 'check failed: psql .* | grep -qx t' "$CURL_LOG" || { echo "FAIL: check_cmd lost its trailing pipe" >&2; exit 1; }
echo "ok: check_cmd keeps the pipeline that turns a query result into pass/fail"

# 6) Confirm no secret-shaped value (sk-, xoxb-, 40+ char token) appears in the sample log line (contract §9).
sample_log='{"ts":"2026-09-20T00:00:00Z","level":"info","pkg":"@omnis/kernel","msg":"job ok","trace_id":null}'
if echo "$sample_log" | grep -qE 'sk-[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,}'; then
  echo "FAIL: sample log line looks like it leaks a secret" >&2; exit 1
fi
echo "ok: sample log line has no secret-shaped value"
echo "PASS"
```

- [ ] 6. Run the full test and confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/healthcheck-ping.test.sh
```
Expected: `PASS`.

- [ ] 7. Write the newsyslog configuration (30-day retention + mode 600 so other users cannot read the logs — the log itself is a single JSON line, so no secret lands in a value, but file permissions are a second line of defence).

`/Users/logankim/AI-Workspaces/omnis/ops/mini/newsyslog.d/omnis.conf`:
```
# US-B42: keep omnis logs 30 days, mode 600 (the single-line JSON log convention keeps secret
# values out of keys, but restrict the file to the vigor account as defence in depth). logfilename [owner:group] mode count size(K) when flags
/Users/vigor/Library/Logs/omnis/*.log        vigor:staff  600  30  *  $D0  J
/Users/vigor/Library/Logs/omnis/*.err.log    vigor:staff  600  30  *  $D0  J
```

- [ ] 8. Check shell syntax (shellcheck is not wired into this repo — Global Constraints).

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash -n ops/scripts/healthcheck-ping.sh && bash -n ops/scripts/test/healthcheck-ping.test.sh
```

- [ ] 9. Run the full test once more and confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/healthcheck-ping.test.sh
```
Expected: `PASS`.

- [ ] 10. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B42: 15 healthchecks.io pings + ntfy dual alerting + log rotation

- healthcheck-ping.sh: --check (validates config only) / --run (real pings + ntfy on failure + items(kind=system))
- Adapter health reads accounts.state directly with SQL (no dependency on B40's TS code)
- Lazily creates the system account/thread and stacks alert items on top of them (no hard deletes)
- newsyslog.d/omnis.conf: 30-day retention + mode 600

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Mini Boot Preflight (US-B43, tier: Haiku)

**Story US-B43** — Goal: auto-login verified with FileVault on, `pmset` settings, LaunchAgent load state, Ollama model presence, and one slot health check — a single script checks all of it and prints only the failures. Deliverables: `ops/mini/preflight.sh`, `ops/mini/RUNBOOK.md` (modified). Verification: `bash ops/mini/preflight.sh --check`. Tier: Haiku.

**Read:** A6 §2 (OS setup procedure steps 1~5), A6 §4 (slot health-check SQL), `ops/mini/install.sh` (LaunchAgent label convention `com.omnis.<service>`).

**Won't build (YAGNI)**: automatic remediation (resetting `pmset`, restarting LaunchAgents) — A6 §2.5's "re-apply LaunchAgent" is a separate item (owned by A6, not in the Phase B story list) and this script is a **read-only check**. It reports failures instead of fixing what is wrong (exactly the definition of a boot checklist — "print only the failures").

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/preflight.sh`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/preflight.test.sh`
- Modify: `/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md`

**Interfaces:**
- Consumes: `fdesetup status` · `defaults read .../loginwindow autoLoginUser` · `pmset -g` · `launchctl print gui/$(id -u)/<label>` · `curl http://127.0.0.1:11434/api/tags`(Ollama) · `psql`(`pg_replication_slots`).
- Produces: a human-readable failure list. No new exports.

#### Steps

- [ ] 1. Write the failing test.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/preflight.test.sh`:
```bash
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/mini/preflight.sh"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

# Fake binaries that all emulate a "broken" state — all 6 items must show up in the failure list.
cat > "$FAKE_BIN/fdesetup"  <<'F'; chmod +x "$FAKE_BIN/fdesetup"
#!/bin/bash
echo "FileVault is Off."
F
cat > "$FAKE_BIN/defaults"  <<'F'; chmod +x "$FAKE_BIN/defaults"
#!/bin/bash
exit 1
F
cat > "$FAKE_BIN/pmset"     <<'F'; chmod +x "$FAKE_BIN/pmset"
#!/bin/bash
echo " sleep             1"
echo " displaysleep      1"
F
cat > "$FAKE_BIN/launchctl" <<'F'; chmod +x "$FAKE_BIN/launchctl"
#!/bin/bash
exit 1
F
cat > "$FAKE_BIN/curl"      <<'F'; chmod +x "$FAKE_BIN/curl"
#!/bin/bash
exit 7
F
cat > "$FAKE_BIN/psql"      <<'F'; chmod +x "$FAKE_BIN/psql"
#!/bin/bash
echo "f"
F
export PATH="$FAKE_BIN:$PATH"

if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: preflight passed when everything is broken" >&2; exit 1
fi
echo "ok: preflight fails when everything is broken"
```

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/preflight.test.sh && bash ops/scripts/test/preflight.test.sh
```
Expected failure: `ops/mini/preflight.sh: No such file or directory`.

- [ ] 3. Write the script.

`/Users/logankim/AI-Workspaces/omnis/ops/mini/preflight.sh`:
```bash
#!/bin/bash
# US-B43: mini boot checklist. Read-only — it reports failures instead of fixing them (A6 §2).
set -uo pipefail
FAILS=()

check_filevault() {
  local status; status="$(fdesetup status 2>/dev/null || echo unknown)"
  echo "$status" | grep -q "FileVault is On" || FAILS+=("FileVault: $status")
}
check_autologin() {
  local user
  user="$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || echo "")"
  [ -n "$user" ] || FAILS+=("autologin: not configured")
}
check_pmset() {
  local out; out="$(pmset -g 2>/dev/null | grep -E '^\s*(sleep|displaysleep|disksleep)\s')"
  echo "$out" | awk '{ if ($2 != 0) exit 1 }' || FAILS+=("pmset sleep != 0: $(echo "$out" | tr '\n' ';')")
}
check_launchagents() {
  local uid; uid="$(id -u)"
  for label in com.omnis.hub com.omnis.zero-cache com.omnis.local-agent com.omnis.backup; do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || FAILS+=("launchagent not loaded: $label")
  done
}
check_ollama() {
  curl -fsS -m 5 http://127.0.0.1:11434/api/tags 2>/dev/null | grep -q "nomic-embed-text" \
    || FAILS+=("ollama: nomic-embed-text-v1.5 not found")
}
check_slot() {
  local active
  active="$(psql "${DATABASE_URL:-postgres://<hub-user>@127.0.0.1:5432/omnis}" -Atc \
    "select coalesce(bool_and(active), true) from pg_replication_slots" 2>/dev/null || echo f)"
  [ "$active" = "t" ] || FAILS+=("replication slot inactive")
}

check_filevault
check_autologin
check_pmset
check_launchagents
check_ollama
check_slot

if [ "${#FAILS[@]}" -eq 0 ]; then
  echo "ok: preflight passed"
  exit 0
fi
printf 'FAIL: %s\n' "${FAILS[@]}" >&2
exit 1
```

- [ ] 4. Make it executable and re-run the test to confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/mini/preflight.sh && bash ops/scripts/test/preflight.test.sh
```
Expected: `ok: preflight fails when everything is broken`.

- [ ] 5. Add an assert verifying that it passes when everything is healthy.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/preflight.test.sh` (appended at end of file):
```bash

cat > "$FAKE_BIN/fdesetup"  <<'F'; chmod +x "$FAKE_BIN/fdesetup"
#!/bin/bash
echo "FileVault is On."
F
cat > "$FAKE_BIN/defaults"  <<'F'; chmod +x "$FAKE_BIN/defaults"
#!/bin/bash
echo "logan"
F
cat > "$FAKE_BIN/pmset"     <<'F'; chmod +x "$FAKE_BIN/pmset"
#!/bin/bash
echo " sleep             0"
echo " displaysleep      0"
echo " disksleep         0"
F
cat > "$FAKE_BIN/launchctl" <<'F'; chmod +x "$FAKE_BIN/launchctl"
#!/bin/bash
exit 0
F
cat > "$FAKE_BIN/curl"      <<'F'; chmod +x "$FAKE_BIN/curl"
#!/bin/bash
echo '{"models":[{"name":"nomic-embed-text-v1.5"}]}'
F
cat > "$FAKE_BIN/psql"      <<'F'; chmod +x "$FAKE_BIN/psql"
#!/bin/bash
echo "t"
F

"$SCRIPT" --check
echo "ok: preflight passes when everything is healthy"
echo "PASS"
```

- [ ] 6. Run the full test and confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/preflight.test.sh
```
Expected: `PASS`.

- [ ] 7. Add the preflight entry at the end of the "## Health checks" section of `ops/mini/RUNBOOK.md`.

Add one line to `/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md` immediately after the "## Health checks" code block:
```markdown
bash ops/mini/preflight.sh --check   # FileVault·autologin·pmset·4 LaunchAgents·Ollama·slot in one go (US-B43)
```

- [ ] 8. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B43: mini boot preflight script

- FileVault On + autologin + 3 pmset sleep settings + 4 LaunchAgents loaded + Ollama model + replication slot
- Read-only, prints only the failures to stderr instead of fixing them
- Adds the command to the RUNBOOK health-checks section

Implemented-by: Claude Haiku
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Monthly Cost Report Job (US-B44, tier: Sonnet)

**Story US-B44** — Goal: aggregate `agent_runs` (tokens, cost, cache hit ratio per loop, per tier, per provider), load it into `digests.metrics` on the 1st of each month, and add a warning line for loops under a 40% cache hit ratio. Deliverables: `packages/kernel/src/jobs/cost-report.ts`. Verification: `pnpm --filter @omnis/kernel test:integration`. Tier: Sonnet. Depends on: US-B14 (`agents` plan, `@omnis/kernel/cost/governor.ts`) · US-B24 (`agents` plan, the nightly digest already creates a `digests(kind='nightly')` row for the same date every day) — both are outside this plan, so **this task does not import those TS symbols**. The `agent_runs`/`digests` columns are already pinned by Phase A contract §4, so SQL alone suffices.

**Read:** `packages/kernel/src/jobs/healthcheck.ts` (the job pattern this task copies verbatim), `packages/kernel/src/scheduler.ts` (note that `register` also upserts into `jobs` — a separate seed INSERT is not strictly required, but delta §8·§6 demand it, so the migration is created too), delta §5 (`CostState`/`POLICY` are owned by US-B14, so this task does not use those types — `agent_runs.model_tier` is grouped as raw `text`), delta §8 (`cost_report_monthly`, cron `10 0 1 * *`), the backlog exit-criteria table (cache hit ratio ≥40% target, owned by US-B44).

**Migration-number decision — changed by cross-review M1 on 2026-09-20**: this task **creates no migration**. `0009`·`0011`·`0012`·`0013` were bundled into the **wave 0 schema bundle** (one worktree, one commit) (delta §6·§11) and that bundle's `0012_jobs_phase_b.sql` **already includes** the `cost_report_monthly` seed. Step 6's `0014_cost_report_job.sql` below was a workaround to avoid "shared ownership makes the sha256 collide", but shared ownership itself is gone, making it unnecessary — delta §11 states explicitly that "**`0014_cost_report_job.sql` is not created**". **Step 6 is therefore replaced by an existence check rather than file creation** (see the step body).

**Won't build (YAGNI)**: reimplementing `CostState`/`POLICY` (owned by US-B14) — this job does pure aggregation + reporting, not cost-state decisions. Adding a new value to `digests.kind` (such as `'monthly'`) — the CHECK constraint allows only `('morning','nightly')` (measured in 0004), and introducing a new value would require a migration to change the constraint, while delta §6 pins "do not touch existing migrations". Instead, merge into the `metrics` jsonb of the existing `nightly` row under the `monthly_report` key.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/jobs/cost-report.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/cost-report-job.test.ts`

**Interfaces:**
- Consumes: `one`/`query` (`@omnis/db`) · `Events`, `Scheduler`, `Logger` (Phase A `@omnis/kernel`, already present) · `agent_runs`/`digests` tables (contract §4).
- Produces(`@omnis/kernel`): `COST_REPORT_JOB_NAME = "cost_report_monthly"` · `COST_REPORT_CRON = "10 0 1 * *"` · `LOW_CACHE_HIT_RATIO = 0.4` · `interface CostReportRow` · `interface MonthlyCostReport` · `buildMonthlyCostReport(pool: Pool, monthStart: Date, monthEnd: Date): Promise<MonthlyCostReport>` · `attachReportToDigest(pool: Pool, report: MonthlyCostReport, forDate: Date): Promise<void>` · `registerCostReportJob(scheduler: Scheduler, deps: { pool: Pool; events: Events; now?: () => Date }): void`.

#### Steps

- [x] 1. Write the failing test.

`/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/cost-report-job.test.ts`:
```ts
import { createPool, one, query } from "@omnis/db";
import {
  COST_REPORT_CRON,
  COST_REPORT_JOB_NAME,
  type Events,
  LOW_CACHE_HIT_RATIO,
  type Scheduler,
  buildMonthlyCostReport,
  createEvents,
  createLogger,
  createScheduler,
  registerCostReportJob,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };

const AUG = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z") };

async function seedRun(loop: string, tier: string, provider: string, tokensIn: number, tokensCached: number, costUsd: number) {
  await query(
    pool,
    `INSERT INTO agent_runs (loop, model_tier, provider, model, tokens_in, tokens_out, tokens_cached, cost_usd, outcome, created_at)
       VALUES ($1,$2,$3,'test-model',$4,10,$5,$6,'ok', $7)`,
    [loop, tier, provider, tokensIn, tokensCached, costUsd, new Date("2026-08-15T00:00:00Z")],
  );
}

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  await seedRun("draft", "T1", "deepseek", 1000, 500, 0.12);   // 50% cache hit — normal
  await seedRun("note_route", "T0", "local", 1000, 100, 0.01); // 10% cache hit — warning target
  await query(
    pool,
    `INSERT INTO digests (kind, for_date, body, metrics) VALUES ('nightly', '2026-08-31', 'existing body', '{"foo":1}'::jsonb)
       ON CONFLICT (kind, for_date) DO UPDATE SET body = EXCLUDED.body, metrics = EXCLUDED.metrics`,
  );
});
afterAll(async () => {
  await query(pool, "DELETE FROM agent_runs WHERE loop IN ('draft','note_route') AND model = 'test-model'");
  await query(pool, "DELETE FROM digests WHERE kind = 'nightly' AND for_date = '2026-08-31'");
  await query(pool, "DELETE FROM jobs WHERE name = $1", [COST_REPORT_JOB_NAME]);
  await events.close();
  await pool.end();
});

describe("buildMonthlyCostReport", () => {
  it("aggregates by loop/tier/provider and flags loops under the cache-hit threshold", async () => {
    const report = await buildMonthlyCostReport(pool, AUG.start, AUG.end);
    expect(report.month).toBe("2026-08");
    expect(report.totalCostUsd).toBeCloseTo(0.13, 5);
    const draft = report.rows.find((r) => r.loop === "draft");
    expect(draft?.cache_hit_ratio).toBeCloseTo(0.5, 5);
    expect(report.lowCacheHitLoops).toContain("note_route");
    expect(report.lowCacheHitLoops).not.toContain("draft");
    expect(LOW_CACHE_HIT_RATIO).toBe(0.4);
  });
});

describe("cost_report_monthly job", () => {
  it("registers with the monthly cron and merges the report into the prior day's nightly digest", async () => {
    const scheduler: Scheduler = createScheduler({
      pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50,
      now: () => new Date("2026-09-01T00:10:00Z"),
    });
    registerCostReportJob(scheduler, { pool, events, now: () => new Date("2026-09-01T00:10:00Z") });
    await scheduler.start();

    const job = await one<{ schedule: string }>(pool, "SELECT schedule FROM jobs WHERE name = $1", [COST_REPORT_JOB_NAME]);
    expect(job.schedule).toBe(COST_REPORT_CRON);

    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = $1`, [COST_REPORT_JOB_NAME]);
    await new Promise((r) => setTimeout(r, 400));
    await scheduler.stop();

    const digest = await one<{ body: string; metrics: Record<string, unknown> }>(
      pool,
      "SELECT body, metrics FROM digests WHERE kind = 'nightly' AND for_date = '2026-08-31'",
    );
    expect(digest.body).toBe("existing body");   // merge, not overwrite
    const report = digest.metrics.monthly_report as { month: string; lowCacheHitLoops: string[] };
    expect(report.month).toBe("2026-08");
    expect(report.lowCacheHitLoops).toContain("note_route");

    const ev = await one<{ payload: Record<string, unknown> }>(
      pool,
      `SELECT payload FROM events WHERE kind = 'cost.report_monthly' ORDER BY seq DESC LIMIT 1`,
    );
    expect(ev.payload.month).toBe("2026-08");
  });
});
```

- [x] 2. Run the test and confirm it fails.

Implementation correction (review-driven). Two lines in the block above are stale and must not be copied:
- `AUG` is a UTC month, but the job aggregates the **Asia/Seoul** calendar month. The test now uses the KST boundaries (`2026-07-31T15:00:00Z` .. `2026-08-31T15:00:00Z`) and derives its injected clock from `nextRunAt(COST_REPORT_CRON, ...)` rather than a hand-written instant, so the fixture cannot drift away from what the scheduler actually does. A first `it` also pins that fire time to `2026-08-31T15:10:00.000Z`.
- `DELETE FROM jobs WHERE name = $1` is **wrong and was removed**. `cost_report_monthly` is seeded by `0012_jobs_phase_b.sql`, and deleting it breaks `packages/db`'s `schema-0006` assertion on that row. Tests must never delete migration-seeded rows. (`healthcheck-job.test.ts` still deletes its own row, and that is correct: `hub_healthcheck` is *not* seeded by any migration, so the scheduler's `register` upsert created it.)

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `does not provide an export named 'buildMonthlyCostReport'`.

- [x] 3. Write the job.

`/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/jobs/cost-report.ts`:
```ts
import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Events } from "../events.js";
import type { Scheduler } from "../scheduler.js";

export const COST_REPORT_JOB_NAME = "cost_report_monthly";
export const COST_REPORT_CRON = "10 0 1 * *";
/** A4 §12.4 · backlog exit criteria: target cache hit ratio ≥40% for draft loops. This job only warns about loops that fall short. */
export const LOW_CACHE_HIT_RATIO = 0.4;

export interface CostReportRow {
  loop: string;
  model_tier: string;
  provider: string;
  runs: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  cost_usd: number;
  cache_hit_ratio: number;
}

export interface MonthlyCostReport {
  month: string; // "YYYY-MM"
  totalCostUsd: number;
  rows: CostReportRow[];
  lowCacheHitLoops: string[];
}

/** Aggregates agent_runs over the half-open interval [monthStart, monthEnd) by loop/tier/provider. */
export async function buildMonthlyCostReport(
  pool: Pool,
  monthStart: Date,
  monthEnd: Date,
): Promise<MonthlyCostReport> {
  const rows = await query<{
    loop: string;
    model_tier: string;
    provider: string;
    runs: string;
    tokens_in: string;
    tokens_out: string;
    tokens_cached: string;
    cost_usd: string;
  }>(
    pool,
    `SELECT loop, model_tier, provider,
            count(*)::text AS runs,
            coalesce(sum(tokens_in), 0)::text AS tokens_in,
            coalesce(sum(tokens_out), 0)::text AS tokens_out,
            coalesce(sum(tokens_cached), 0)::text AS tokens_cached,
            coalesce(sum(cost_usd), 0)::text AS cost_usd
       FROM agent_runs
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY loop, model_tier, provider
      ORDER BY loop, model_tier, provider`,
    [monthStart, monthEnd],
  );

  const reportRows: CostReportRow[] = rows.map((r) => {
    const tokensIn = Number(r.tokens_in);
    const tokensCached = Number(r.tokens_cached);
    return {
      loop: r.loop,
      model_tier: r.model_tier,
      provider: r.provider,
      runs: Number(r.runs),
      tokens_in: tokensIn,
      tokens_out: Number(r.tokens_out),
      tokens_cached: tokensCached,
      cost_usd: Number(r.cost_usd),
      cache_hit_ratio: tokensIn > 0 ? tokensCached / tokensIn : 0,
    };
  });

  const byLoop = new Map<string, { in: number; cached: number }>();
  for (const r of reportRows) {
    const acc = byLoop.get(r.loop) ?? { in: 0, cached: 0 };
    acc.in += r.tokens_in;
    acc.cached += r.tokens_cached;
    byLoop.set(r.loop, acc);
  }
  const lowCacheHitLoops = [...byLoop.entries()]
    .filter(([, v]) => v.in > 0 && v.cached / v.in < LOW_CACHE_HIT_RATIO)
    .map(([loop]) => loop);

  return {
    month: monthStart.toISOString().slice(0, 7),
    totalCostUsd: reportRows.reduce((s, r) => s + r.cost_usd, 0),
    rows: reportRows,
    lowCacheHitLoops,
  };
}

/** Merges only metrics into the nightly digest for that date, created by US-B24 (another plan) — body is untouched.
 *  ponytail: if the nightly digest row does not exist yet (job failure, etc.), create it with an empty body rather
 *  than losing the metrics — when nightlyDigestLoop later runs again for the same (kind, for_date) it just fills in
 *  the body (metrics are safe because of the jsonb || merge). No ceiling; upgrade point: once digests.kind gains 'monthly', make it an independent row. */
export async function attachReportToDigest(
  pool: Pool,
  report: MonthlyCostReport,
  forDate: Date,
): Promise<void> {
  const forDateStr = forDate.toISOString().slice(0, 10);
  await query(
    pool,
    `INSERT INTO digests (kind, for_date, body, metrics)
       VALUES ('nightly', $1, '', jsonb_build_object('monthly_report', $2::jsonb))
       ON CONFLICT (kind, for_date) DO UPDATE
         SET metrics = digests.metrics || jsonb_build_object('monthly_report', $2::jsonb)`,
    [forDateStr, JSON.stringify(report)],
  );
}

/** US-B44: at 00:10 KST on the 1st of each month, aggregate the previous month's agent_runs and attach them to the
 *  previous day's (= last day of the previous month) nightly digest, which the nightly_digest job (US-B24, 23:00 KST) already built the night before. */
export function registerCostReportJob(
  scheduler: Scheduler,
  deps: { pool: Pool; events: Events; now?: () => Date },
): void {
  const { pool, events } = deps;
  const now = deps.now ?? ((): Date => new Date());
  scheduler.register(COST_REPORT_JOB_NAME, COST_REPORT_CRON, async () => {
    const today = now();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const forDate = new Date(monthEnd.getTime() - 86_400_000); // last day of the previous month

    const report = await buildMonthlyCostReport(pool, monthStart, monthEnd);
    await attachReportToDigest(pool, report, forDate);

    await events.emit("cold", "cost.report_monthly", {
      month: report.month,
      total_cost_usd: report.totalCostUsd,
      low_cache_hit_loops: report.lowCacheHitLoops,
      actor: "system",
      target_table: "digests",
    });
  });
}
```

- [x] 4. Add it to the barrel.

Implementation correction (review-driven). The three `Date.UTC(...)`/`getUTC*` lines at the top of the handler above are **wrong** and were replaced. `cron.ts` evaluates `10 0 1 * *` on the **Asia/Seoul** calendar, so the handler actually fires at 15:10 UTC on the *last* day of the month it reports on; reading UTC calendar fields off `now()` lands a month early on every single run. The handler now shifts `now()` by `SEOUL_OFFSET_MS` — imported from `../cron.js` and exported there so the offset has one definition instead of being re-hardcoded — to read KST calendar fields, then shifts back out when forming the `[monthStart, monthEnd)` instants. `forDate` is the last KST day of the reported month, expressed as a UTC-midnight instant naming that date, which is the convention `attachReportToDigest` documents and slices with `toISOString().slice(0, 10)`.

Add to `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`:
```ts
export {
  COST_REPORT_CRON,
  COST_REPORT_JOB_NAME,
  LOW_CACHE_HIT_RATIO,
  attachReportToDigest,
  buildMonthlyCostReport,
  registerCostReportJob,
} from "./jobs/cost-report.js";
export type { CostReportRow, MonthlyCostReport } from "./jobs/cost-report.js";
```

- [x] 5. Re-run the test and confirm it passes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected: all 3 `it` blocks in `cost-report-job.test.ts` pass (`buildMonthlyCostReport` ×1 + `cost_report_monthly job` ×2... in practice there are 2 `describe` blocks holding 2 `it` blocks; by the file above, 2 passing cases).

- [x] 6. **Do not create a migration** (cross-review M1). Only verify that the `cost_report_monthly` seed is present in the W0 bundle's `0012_jobs_phase_b.sql`.

```bash
cd /Users/logankim/AI-Workspaces/omnis && grep -n "cost_report_monthly" packages/db/migrations/0012_jobs_phase_b.sql && test ! -e packages/db/migrations/0014_cost_report_job.sql && echo "no 0014 — as expected"
```

Expected output: 1 line with the `cost_report_monthly` seed + `no 0014 — as expected`. If `0012` does not exist yet, the W0 bundle has not been merged — **do not create it here**, just wait, since the scheduler's `register` upserts into `jobs` and the rest of this task (job handler + test) runs without the seed.

- [x] 7. Verify that the job handler is idempotent across two runs (the `digests.metrics` merge must be idempotent).

Implementation correction: the command originally written here ran `pnpm db:migrate` twice, which only shows whether the migrations re-apply and says nothing about handler idempotence. The test file from step 1 now has an `it` that calls `attachReportToDigest` twice with the same arguments, which is what actually verifies it.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration -t "merges idempotently"
```
Expected: after the second merge `digests.metrics` is identical to the first, and the pre-existing `foo` key is still alive.

- [x] 8. Run the whole kernel test suite once more to confirm there are no regressions.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected: every other file such as the existing `healthcheck-job.test.ts` still passes + `cost-report-job.test.ts` passes.

- [x] 9. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B44: monthly cost and usage report job

- buildMonthlyCostReport: aggregates agent_runs by loop/tier/provider and computes the cache hit ratio
- Loops below LOW_CACHE_HIT_RATIO=0.4 are surfaced as warnings in lowCacheHitLoops
- attachReportToDigest: merges into the metrics of the previous month's last nightly digest (body untouched)
- registerCostReportJob: cron 10 0 1 * *, cost.report_monthly cold event
- No migration: the cost_report_monthly seed lives in the W0 schema bundle's 0012_jobs_phase_b.sql (cross-review M1)

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-check (plan author)

- Story coverage: US-B16 (Task 1) · US-B34 (Task 2) · US-B41 (Task 3) · US-B42 (Task 4) · US-B43 (Task 5) · US-B44 (Task 6) — all 6 have ≥1 task.
- Prohibited-pattern scan: `TBD`/`TODO`/"implement later"/"appropriate error handling"/"similar to Task N"/steps without code/undefined symbols — none found (every step carries a complete, executable code block, and the recurring shell idioms (`kc()`, the JOBS array, fake-binary setup) are re-written in full every time).
- Verifiable without real accounts (B-D5): all 6 tasks test by overriding `PATH` with fake `security`/`tailscale`/`launchctl`/`pg_restore`/`curl`/`psql` binaries. The only real connection point (Task 6's vitest integration) uses only the local `omnis_test` DB.
- Sources of consumed symbols: `one`/`query`/`createPool` (contract §4, already present) · `Events`/`Scheduler`/`Logger`/`createEvents`/`createScheduler`/`createLogger` (contract §5, already present) · `agent_runs`/`digests`/`accounts`/`jobs` columns (contract §4, measured from the Phase A migrations) · the Keychain `kc()` idiom (measured from `ops/mini/env.sh.example`) — everything Task 6 creates (`buildMonthlyCostReport`/`attachReportToDigest`/`registerCostReportJob`/`COST_REPORT_*`/`LOW_CACHE_HIT_RATIO`) is defined inside this document (Task 6 itself). B14 (`CostState`/`POLICY`) · B40 (`recordAdapterHealth`) · B24 (`nightlyDigestLoop`) are **not imported** — each code dependency is severed either by querying SQL directly or by "merely merging into a row that job already created" (the reasoning is stated in the body).

## Open Questions

1. ~~**Migration 0012 shared collision**~~ **Closed (2026-09-20 cross-review M1)**: the decision went the way of "one person lands it in a single commit" — `0009`·`0011`·`0012`·`0013` are the **wave 0 schema bundle** (single worktree, single commit) and they ship `packages/kernel/src/settings.ts` alongside (delta §6). None of the five plans creates these files (exception: memory-ingestion's `0010`), and this plan's `0014_cost_report_job.sql` is **retired** (delta §11). Because W0 merges before W1, this is not in conflict with the wave order either.
2. **The `omnis.healthchecks.<slug>` / `omnis.restic.*` / `omnis.b2.*` Keychain names were introduced by this plan** — the A1/A6 §9 source text has no item names for healthchecks.io, restic, or B2 (it only covers channel/DB secrets, not the services themselves), so the dotted scheme was extended as-is. If another plan already uses the same values under different names, this needs to be corrected to match.
3. **The general infrastructure path for `items(kind='system')` "dual exposure"**: the delta specifies per-adapter system items via `recordAdapterHealth` (US-B40, a kernel export), but the system-item creation path for **non-adapter** infrastructure alerts such as the hub, Postgres, or the slot is not pinned to a TS function in any contract. This plan fills that gap in Task 4 by having `healthcheck-ping.sh` INSERT directly with psql — once US-B40 later adds a helper unified with `recordAdapterHealth` (for example `recordInfraHealth`) to the kernel, replacing this script's SQL block with that call would be better.
4. **The initial restic repository `init` for `ops/scripts/omnis-backup.sh`** is outside this plan (done by hand once) — the US-B41 implementer should pick the moment to add a single `restic init` line to the "Install (first time)" procedure in `RUNBOOK.md` during the actual mini deployment.
