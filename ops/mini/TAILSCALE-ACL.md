# Tailscale ACL (US-B34, A6 §3)

The mini opens no port to the public internet. All exposure goes through a single HTTPS (443) path via `tailscale serve`.

## Grants

```json
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
```

## Why Postgres (5432) and Ollama (11434) are not in `dst`

The only thing clients (MacBook, iPhone) need to open directly across the tailnet is the hub API (`/api/` under 443, which `tailscale serve` proxies to 127.0.0.1:8787). Postgres and Ollama are reached only through the hub process (or the local-agent bridge inside it) — opening 5432/11434 in the ACL creates a path for clients to bypass the hub's approval gate and audit log and connect directly to the DB/models. Narrowing the attack surface to the single hub API is A6 §3's tailnet-only principle.

## Funnel

**Always OFF.** If `tailscale funnel status` is not "Funnel off.", `bash ops/mini/tailscale-serve.sh --check` fails (§8 monitoring; US-B42 wires this script in as one item of healthcheck-ping.sh). Funnel is public internet exposure, so it was turned on temporarily only during the spike where webhook reception such as Calendar `events.watch` was absolutely required, and turned off immediately (A6 §3) — Phase B has no such path.

## Mount

```bash
bash ops/mini/tailscale-serve.sh --mount   # /api -> :8787, / -> :5173 (US-B35 PWA build artifacts)
bash ops/mini/tailscale-serve.sh --check   # mount + funnel off check only, changes nothing
```

## Difference from measurement (2026-09-20 RUNBOOK record)

According to the RUNBOOK's "what this deployment actually changed on the mini" table (the 11:3x entry), when mounted with `--set-path=/api`, Serve stripped the `/api` prefix before handing off to the backend, so the hub's `/api/zero-token` arrived as `/zero-token` and returned 404; the temporary measure at the time was to mount the hub directly at `/` (before the PWA build existed). Before applying this script to the mini with an actual `--mount`, first verify whether the hub routes are registered without the `/api` prefix (i.e. whether they mesh with Serve's prefix stripping) — that verification and fix is work on the hub routing code, outside this task's scope (a pure ops script).
