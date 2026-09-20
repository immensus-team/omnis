# omnis

**Everything is an inbox.** One real-time inbox for every channel and every agent, with your context.

> Status: Phase A built (35/35 stories merged, main green). Private until launch. The full 기획서 lives in [`docs/spec/00-omnis-design.md`](docs/spec/00-omnis-design.md); research provenance in [`docs/research/`](docs/research/); Phase A plans + status in [`docs/superpowers/plans/README.md`](docs/superpowers/plans/README.md).

Three theses drive every decision:

1. **Everything is an inbox.** A message from a person and a turn from an agent land in the same queue.
2. **Context is the product.** The inbox is the surface; the asset is one unified memory about you.
3. **Agents act first, you decide.** Drafts, labels, tasks and delegation proposals are ready before you look. Anything that leaves the system passes your approval.

Channels (v1): Slack, Gmail, Outlook, Google Calendar, Telegram, WhatsApp, KakaoTalk, LinkedIn. Agent runtimes: omnis, Claude Code, Codex, DeepSeek (claude-ds), Hermes.

Topology now: a Mac mini hub over Tailscale, a macOS app (Tauri 2) and an iPhone client (PWA → native). Later: standalone on a MacBook + iPhone.

The launch README with demos and architecture visuals is planned in `docs/spec/A8-readme-blueprint.md`.

### Zero 동기화 (Phase A)

`ops/zero-cache.env.example`을 복사해 값을 채우고 `pnpm dlx @rocicorp/zero@1.9.0 zero-cache --env-file ops/zero-cache.env`로 띄운다. 허브는 부팅 시 `zero_omnis` publication이 `packages/kernel/src/zero-schema.ts`와 일치하는지 검사하고, 어긋나면 기동을 거부한다.

## Phase A status

Built and tested on `main`: packages `db`, `kernel` (event bus, approvals, Zero schema/publication guard), `protocol` (agent bridge JSON-RPC types), `ui`, `agents` (classify/record-run), `adapters/{slack,gmail,google-calendar}`; apps `hub` (HTTP :8787 incl. approvals API, WS `/bridge`), `local-agent` (Claude Code/Codex/claude-ds runtime bridge), `desktop` (Tauri 2 — Inbox, Thread, Agent Session, ⌘K palette, Approval card, Onboarding). CI (`lint`/`typecheck`/`unit`/`contract`/`integration`) is green.

Mocked vs real: adapter tests replay fixtures, not live Slack/Gmail/Calendar connections — those need Logan's own OAuth/tokens. `local-agent`'s Claude Code/Codex runtimes are exercised in tests via mock runtime fixtures (`apps/local-agent/test/`), not a live delegated CLI run.

What needs Logan to close Phase 0/A out (see [plans README](docs/superpowers/plans/README.md) for gate detail):
- Gate ⑨ Slack Socket Mode token
- Gate ⑩ Gmail watch + Pub/Sub setup
- Gate ① Calendar `events.watch` via Funnel
- Gate ② Beeper WhatsApp token + subnumber
- Gate ③ FileVault-on autologin on the mini
- Gate ④ kmsg read 48h soak
- Gate ⑤ Tailscale Serve HTTPS from iPhone Safari

Everything else (gates ⑥⑦⑧⑪⑫⑬⑭) ran unattended — results in [`docs/superpowers/plans/README.md`](docs/superpowers/plans/README.md).

## Development

```
pnpm install
export PGUSER=logankim                                 # your local Postgres superuser
createdb -h 127.0.0.1 -U "$PGUSER" omnis_dev           # once; and omnis_test for the integration project

# DATABASE_URL is required — packages/db throws "DATABASE_URL is required (계약 §9)" without it.
DATABASE_URL=postgres://$PGUSER@127.0.0.1:5432/omnis_dev pnpm db:migrate

pnpm test                          # all 3 vitest projects: unit + contract + integration
pnpm test -- --project unit        # unit only — no Postgres needed
pnpm test:integration              # integration only; wipes and re-migrates the omnis_test DB
pnpm lint && pnpm typecheck
```

`e2e:phase-a` (Playwright smoke across Inbox/Thread/Agent Session/Approval) is planned but not wired up yet — blocked on the Logan-assisted gates above (real channel connections to smoke-test against).
