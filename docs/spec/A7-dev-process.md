# A7 — Development Process

Version 1.0 (2026-09-20). Revision aligned with master v1.0 (the pass-2 revision of `99-review-v2.md`). Basis: `00-omnis-design.md` §5 (D2, D3, D9, D13, D14, D16), §16, §17 / `A3-data-schema.md` §2·§2.1·§7~8 (calendar, migrations, author conventions) / `A4-agent-layer.md` §7.1·§7.5·§10.1 (L9 Ingestion) / `A2-agent-session-bridge.md` §3.2 (ingest RPC) / `99-review.md` / `99-review-v2.md` / `research/24-gap-ralph-loop-dev-pipeline.md` / `research/16-hot-repo-readme.md` / `research/12-cost-optimization.md` / `research/22-gap-read-the-prior-art-source.md` / `~/.claude/plugins/cache/omc/oh-my-claudecode/4.14.5/skills/ralph/SKILL.md`.

This appendix takes the master design document's D2 (hand-rolled kernel), D3 (the AI SDK is only the model-calling layer), D9 (four model tiers + sensitivity rules), D13 (development model assignment), D14 (repo/monorepo), and D16 (TS + Node 22 + pnpm) as given, and expands them into an executable procedure. D13's already-settled rule — "Opus = kernel, bridge, memory schema, security; Sonnet = adapters, UI, tests; Haiku = docs, mechanical; DeepSeek = isolated stories (Sonnet+ review); Fable = interactive planning only" — is not reopened here; §4 makes it concrete as a table by story type.

**Caution (scope boundary)**: The `claude-ds` calls in this appendix are **exclusively for the development pipeline (the ralph loop)**. §14/D9's T1 (DeepSeek V4 Flash, production inbox processing) is a separate runtime path that goes through the AI SDK + API key/gateway, and is not what this appendix covers. Do not confuse the two.

## Decisions This Appendix Locks In

| # | Decision | Basis | Fallback |
|---|---|---|---|
| A7-D1 | Fix the monorepo layout to the tree below. Dependency-direction rule: lower layers (`db`→`protocol`→`kernel`/`memory`→`adapters`/`agents`/`ui`→`apps`) may not import higher layers, and packages on the same layer may not import each other either | D16 (monorepo), D2 (hand-rolled kernel) | None |
| A7-D2 | Lint/format is **Biome alone** (replacing ESLint + Prettier). Build order is managed with the `tsconfig` strict family + TS project references. Turborepo/Nx are **not adopted** — under 20 packages `pnpm -r` is enough, and we add one when builds actually feel slow | YAGNI (task-runner caching is overkill for a monorepo under 20 packages) | Adopt Turborepo (when build time becomes the bottleneck) |
| A7-D3 | DB migrations use raw SQL + a hand-rolled runner, with no ORM; paths are `packages/db/migrations/NNNN_<slug>.sql` (four digits, forward-only), and the tracking table is `_omnis_migrations(name, sha, applied_at)` (the sha256 of the file contents detects re-application/tampering). Only `packages/db` holds DDL, and ownership of the file split lives in A3 (A3-D9) | A3-D9 (single source for the migration file split and the runner code), an extension of D2's "the kernel is hand-rolled on top of Postgres", `22` (agentic-inbox's Drizzle is not adopted — ORM abstraction conflicts with D2's intent to keep schema ownership in one place) | Drizzle (when the schema passes 30 tables and managing SQL by hand becomes burdensome) |
| A7-D4 | UI tests: `apps/web` (PWA) uses Playwright. `apps/desktop` (Tauri) is **UNVERIFIED — spike**: assume `tauri-driver` + WebdriverIO as the default (Tauri's official WebDriver path, but not directly verified in this research batch). Settle it with a half-day spike before Phase A starts | No basis (A7's own spike) | Skip the Tauri smoke test, cover logic with vitest units only, and supplement with manual QA |
| A7-D5 | Development loop = the OMC `ralph` skill + `worktrunk` per-story worktree isolation. After a 3-failure cap per story, the tier auto-escalates (DeepSeek→Sonnet→Opus, **never auto-escalating to fable**); `--max-iterations` is the wall-clock cap, and a broken tree is `git reset --hard`'d back to the last commit that passed verification + review. **If Opus fails 3 times in a row, stop the loop without auto-escalation and escalate to Logan** (there is no next tier, and A7-D6 forbids auto-escalating to fable) | `24` (recommends the ralph skill + worktrunk combination), SKILL.md Steps 7~9, master §17 ("if Opus fails 3 times, stop and escalate to Logan") | On 3 Opus failures, stop + escalate to Logan (no automatic fallback; this is the only procedure) |
| A7-D6 | Fix the model assignment table (§4) and the DeepSeek delegation procedure. `fable` is fully excluded from the development loop (headless) — reserved only for interactive planning/milestone review | D13, `24` (verified that headless fable bills without consent), Logan's brief ("never try to handle everything with fable") | None |
| A7-D7 | CI (GitHub Actions): lint + typecheck + unit always run; the integration job that uses a Postgres service container is triggered by a path filter only when paths under `packages/kernel`, `packages/db`, `packages/memory`, or `apps/hub` change | None (our own decision, to cut CI cost) | Always run integration on every PR (if CI time is not a problem) |
| A7-D8 | Commits: one atomic commit per story (implementation + tests + review feedback squashed into one), with `Co-Authored-By` naming the model that actually ran. Since v1 is a one-person project (Logan), the orchestrator (Opus, main worktree) merges sequentially and locally without PRs | §17 ("one atomic commit per story", "keep Co-Authored-By"), D14 | Introduce a PR review process (at v2, the multi-user point) |
| A7-D9 | Releases: Phases A~C ship only the Tauri **unsigned dev build** (local install, with guidance for removing the Gatekeeper quarantine attribute). Apple signing/notarization is Phase D | §16 Phase D exit criteria | None |
| A7-D10 | Fix the 35-story Phase A backlog (§7), including order and dependencies. This backlog becomes the input to the `writing-plans` skill | §16 Phase A scope, §7 of this appendix | None |

---

## 1. Monorepo Structure

`pnpm` workspaces, Node 22, TypeScript strict (`"strict": true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` pinned in the root `tsconfig.base.json`, which each package extends).

```
omnis/
├── apps/
│   ├── hub/              # Node process hosting the L0 kernel + scheduler (Mac mini; Phase D embeds it in the app)
│   ├── desktop/           # Tauri 2 macOS app (L4)
│   ├── web/                # iPhone installed PWA (L4, Phase B)
│   └── local-agent/        # agent bridge daemon (L1, session bus client). Deployed with a host parameter to both the Mac mini (Codex, Hermes from Phase B) and the MacBook (Claude Code, Codex)
├── packages/
│   ├── kernel/             # L0: events, scheduler, pending_approvals, audit_log, kill switch
│   ├── protocol/           # wire types: NormalizedItem, Adapter interface, bridge protocol, capabilities
│   ├── adapters/
│   │   ├── slack/ gmail/ outlook/ google-calendar/ telegram/ whatsapp/ kakaotalk/ linkedin/
│   │   └── agent-bridge/   # per-runtime bridge (Claude Code/Codex/claude-ds/Hermes) adapter
│   ├── agents/             # L3 loops: classification, drafting, todos, delegation, digests, Network, note routing
│   ├── memory/             # L2: self-model files, mem0 wrapper, bi-temporal entity queries
│   ├── ui/                  # React components, design tokens, shadcn/ui wrappers (no business logic)
│   └── db/                  # DDL migrations + migration runner + typed query helpers
└── tools/
    └── spikes/              # Phase 0 spikes. One result.md per folder, outside the workspace build graph
```

**Responsibilities and dependency direction (A7-D1)**:
- `packages/protocol` is a leaf package — it has only zod schemas and types and imports no other internal package. `NormalizedItem`, the `Adapter` interface (§8 master), `HumanInterrupt`/`HumanResponse` (borrowed from `22`, detailed in A3), and the bridge protocol messages live here.
- `packages/db` has only DDL and the migration runner. Schema ownership must live in exactly one place for D2's "hand-rolled kernel" to actually stay hand-rolled.
- `packages/kernel` depends only on `packages/db` and `packages/protocol`. events/scheduler/approvals/audit_log/kill switch — pure backend logic, with no UI and no channel-specific code. Only `apps/hub` imports this package.
- Each of `packages/adapters/*` depends only on `packages/protocol` and does not reference the others (so `slack` does not know about `gmail`). Adapters do not import `kernel` directly — they push events only through a sink callback injected by the hub. This is the point where §8's "adapters declare capabilities and the UI promises only the declared capabilities" is enforced at the code level.
- `packages/agents` depends on `packages/protocol`, `packages/memory`, and `ai` (Vercel AI SDK, D3). It does not import `packages/adapters` directly — the autonomous loops' tool palette reaches channels only through interfaces the kernel registers (reproducing `22`'s lesson of separating the tool set, here as a package boundary). `send`/`delete`/`delegate`/`calendar_write` (the master §6 `pending_approvals.action` enum, A3 `approvals_action_ck`) exist in no tool list of `packages/agents` — these types themselves live only in `packages/kernel`'s approval handler. The bridge RPC method names (A2 `delegate.run`) are a different layer: the former is an approval-action enum, the latter is the JSON-RPC method name that starts a delegation turn, and the two are not to be confused.
- `packages/memory` depends on `packages/db` (pgvector tables) and `packages/protocol`.
- `packages/ui` is pure presentation — no network calls and no business logic.
- `apps/*` reference `packages/*`, but `packages/*` reference no `apps/*`. `apps/desktop` and `apps/web` do not import `packages/kernel` directly; they talk to the hub only through Zero sync (D7) and the approval API.
- `tools/spikes` is excluded from the workspace build graph (no package imports this folder) — spikes are throwaway code.

## 2. Toolchain

- **tsconfig**: root `tsconfig.base.json` (all strict flags on) + a per-package `tsconfig.json` (`extends` + `references`). `tsc --build` builds in reference-graph order, so any import that violates §1's dependency direction fails immediately, at compile time as well.
- **Lint/format (A7-D2)**: Biome alone. Root `biome.jsonc`, `pnpm biome check --write`. We do not use the ESLint + Prettier combination — the cost of keeping two configs in sync is waste at this scale.
- **Tests**: `vitest` (unit/contract/integration alike, with a per-package `vitest.config.ts` + a root `vitest.workspace.ts`); `apps/web` uses Playwright (§5). `apps/desktop` is A7-D4 (pending a spike).
- **Tauri CLI**: only in `apps/desktop`. `pnpm tauri dev` / `pnpm tauri build`.
- **Migration runner**: `packages/db/migrations/NNNN_<slug>.sql` (raw SQL in four-digit numeric order, forward-only, one file = one transaction. If `CREATE INDEX CONCURRENTLY` is needed, use `.noxact.sql` to run outside a transaction) + `packages/db/src/migrate.ts` (prevent concurrent runs with an advisory lock → select unapplied files by sha256 comparison and run them in order → record in `_omnis_migrations(name, sha, applied_at)`. If the contents of an already-applied file change, error). A3-D9 (§8) is the single source for the runner implementation, and A7 adopts it as is. No ORM (A7-D3).
- **Task runner**: `pnpm -r` without Turborepo/Nx (A7-D2). Execution order across packages is already enforced by `tsc --build`'s project references, so a separate task-graph tool is unnecessary for now.
- **Root scripts**: `dev` (`pnpm --filter @omnis/hub dev` + `pnpm --filter @omnis/desktop tauri:dev` running concurrently), `build` (`tsc --build`), `test` (`vitest run`), `test:contract` (`vitest run --project contract`), `test:integration` (`vitest run --project integration`; locally requires a native Postgres), `lint` (`biome check`), `format` (`biome check --write`), `typecheck` (`tsc --build --force`), `db:migrate`, `db:migrate:create <name>`, `db:seed`, `tauri:dev`, `tauri:build`.

## 3. Running the ralph Loop

The development loop is not designed from scratch. We use the OMC `ralph` skill already installed on this machine (`~/.claude/plugins/cache/omc/oh-my-claudecode/4.14.5/skills/ralph/SKILL.md`) as is. That skill already implements the PRD-driven story loop (Steps 1~6), the tiered reviewer gate (Step 7: <5 files standard = STANDARD/Sonnet, >20 files or security = THOROUGH/Opus), the mandatory deslop pass (Step 7.5, the `ai-slop-cleaner` skill), and regression re-verification (Step 7.6) (`24`). omnis needs only two additions: (a) a DeepSeek delegation branch, and (b) `worktrunk` worktree isolation.

**Story card format** extends ralph's `prd.json` story object with the fields below (the §7 backlog is written in this format):

```json
{
  "id": "US-A12",
  "phase": "A",
  "goal": "Slack adapter: Socket Mode connection + backfill + realtime subscribe",
  "inputFiles": ["packages/protocol/src/adapter.ts", "packages/adapters/slack/README.md"],
  "outputs": ["packages/adapters/slack/src/index.ts", "packages/adapters/slack/test/contract.test.ts"],
  "verifyCommand": "pnpm --filter @omnis/adapter-slack test",
  "definitionOfDone": "the 6 methods capabilities()/connect()/backfill()/subscribe()/send()/health() pass the fixture-replay contract test",
  "tier": "sonnet",
  "prohibited": ["do not wire send() directly into the kernel without the approval gate", "do not import packages/adapters/gmail"],
  "worktree": "omnis/.worktrees/US-A12",
  "branch": "ralph/US-A12",
  "attempts": 0,
  "passes": false
}
```

**`tier` field rule**: one of `deepseek`/`haiku`/`sonnet`/`opus` (§4 assignment table). **A story with `tier: "deepseek"` forces its reviewer to be `sonnet` or above** — a DeepSeek diff is never self-reviewed by DeepSeek or Haiku (A7-D6). ralph Step 7's reviewer gate automatically assigns a STANDARD (Sonnet) reviewer when `tier` is `deepseek`, and the existing rule of escalating to THOROUGH (Opus) based on file count and security impact still applies unchanged.

**worktrunk worktree isolation procedure**: Just before starting a story, create `omnis/.worktrees/<story-id>` with `worktrunk create ralph/<story-id>` and do all implementation and testing inside it (the exact CLI flags are **UNVERIFIED — spike**; assume `worktrunk create <branch>` / `worktrunk remove <story-id>` as the default and settle it with one dry run against the real repo before Phase A starts — `24` explicitly left this undecided, saying "worktrunk vs claude-squad needs a real-usage trial"). The orchestrator (Opus, main worktree) merges only branches that passed the review + verification gate (Steps 7~7.6), in order, then deletes the worktree and unblocks dependent stories. `claude-squad` is not adopted — it is a tool for a human watching from tmux, and the ralph loop is unattended (`24`).

**3-failure cap and tier escalation**: If a story fails its acceptance criteria or reviewer verification 3 times in a row at its own `tier`, it auto-escalates one step: DeepSeek → Sonnet → Opus. **It never auto-escalates to fable** (§4, A7-D6). Escalation happens the moment the `attempts` counter reaches 3, and the reason for escalation is recorded in `progress.txt`. **If it fails 3 times in a row at `tier: "opus"`, there is no next tier — stop the loop without auto-escalation and escalate to Logan** (A7-D5, master §17). The worktree is left in place rather than deleted so Logan can see the state as it is, and the orchestrator marks that story as blocked while other, non-dependent stories continue.

**`--max-iterations`**: A wall-clock ceiling is imposed on every ralph run (default 40 in Phase A; from Phase B onward, scaled in proportion to the number of stories). The official `ralph-loop` plugin's `--max-iterations`/completion-promise mechanism is also applied as a hard bound (`24`).

**Reset to the last verified commit**: If an iteration breaks the tree (build/lint/test failure) and it cannot be fixed within the cap, `git reset --hard` inside that story's worktree to the commit where the story last passed both `verifyCommand` and reviewer verification. If there is no passing verification history, roll back to the story's starting point (immediately after worktree creation). Commits from other stories that are already merged are not touched.

**Implementer/reviewer separation**: ralph Step 7 already enforces this — the reviewer runs in a fresh context separate from the implementer's and verifies against the concrete acceptance criteria in `prd.json`. **A DeepSeek diff is not self-reviewed by DeepSeek, and Haiku does not review it either — always Sonnet or above** (A7-D6, consistent with the existing `claude-ds` practice).

## 4. Model Assignment Rules Table

This makes D13 concrete by story type.

| Story type | Tier | Examples (see §7) |
|---|---|---|
| Kernel, bridge protocol, memory schema, security boundary, THOROUGH review (>20 files/security) | **Opus** | US-A05~A09, US-A16, US-A18, US-A19, US-A21 |
| Adapters, UI, tests, integration, STANDARD review | **Sonnet** | US-A04, US-A12~A14, US-A19b, US-A20, US-A22b, US-A23, US-A23b, US-A24~A30 |
| Docs, fixtures, mechanical refactors, simple renames | **Haiku** | US-A00, fixture generation, README, type export cleanup |
| Isolated, well-defined stories (adapter boilerplate, DDL files, fixtures, simple UI components) — always requires a Sonnet+ review | **DeepSeek V4.1 Flash** (`claude-ds`) | US-A01~A03, the type-scaffold portion of US-A11, US-A15 |
| Interactive planning, PRD refinement, milestone review — **excluded from headless** | **Fable** | Backlog re-sorting before a phase starts (face-to-face with Logan) |

**DeepSeek delegation procedure**:
```bash
claude-ds -p "<self-contained task: files, acceptance criteria, verify command>" \
  --permission-mode bypassPermissions --strict-mcp-config --output-format json
```
- Always run in a separate branch/worktree (`ralph/<story-id>`).
- The resulting diff is reviewed by Sonnet or above before merge (no self-approval; no DeepSeek self-review).
- The `total_cost_usd` returned by `--output-format json` is **computed from Claude pricing, so ignore it**. The real cost is tracked separately using the official DeepSeek V4.1 Flash rate card (cache-hit $0.003~0.006, cache-miss $0.15~0.30, output $0.60~1.20 per MTok, varying by peak/off-peak window; verified in `12`/`24`).
- The key lives in the Keychain under `deepseek-api` and is never printed.

**Basis for excluding Fable from headless (A7-D6)**: `fable` is a real Claude Code model tier (above Opus), and on the `-p` (headless)/Agent SDK path no usage-credit consumption consent prompt appears — it simply bills (`24`, verified via `code.claude.com/docs/en/model-config`). The consent prompt appears only in interactive terminal sessions. Therefore `fable` is not put into the ralph loop's model pool at all — it is reserved for interactive sessions that Logan watches (backlog re-sorting, milestone review). Opus/Sonnet/Haiku are invoked as subprocesses of the unmodified `claude` binary using an already-held subscription, which keeps us within the ToS's "ordinary individual use" boundary (D9, `12`) — OAuth tokens are not used to bypass this via the Agent SDK.

## 5. Test Strategy

- **Adapter contract tests**: `packages/adapters/<channel>/test/contract.test.ts`. They replay fixtures (JSON) captured from real API responses to verify the `Adapter` interface's 6 methods (`capabilities`/`connect`/`backfill`/`subscribe`/`send`/`health`, §8). No real network calls.
- **Kernel integration tests**: `packages/kernel/test/integration/*.test.ts`. They run events/LISTEN-NOTIFY/scheduler/pending_approvals/audit_log for real against a local native Postgres (§15's "do not use containers" principle applies to local development too — only a Colima fallback is allowed). **In CI we use GitHub Actions' Postgres 17 service container** — that is throwaway test infrastructure, not operational infrastructure, so it does not contradict §15's native-process principle.
- **Bridge mock runtime**: `apps/local-agent/test/`. Without actually launching the Claude Code/Codex CLI, mock subprocesses that imitate `stream-json`/`app-server` JSON-RPC output verify the bridge protocol (session_key/session_id, capabilities negotiation).
- **Prompt injection set**: `packages/agents/test/injection.test.ts`. Build a fixed set drawing on agentic-inbox's `isPromptInjection` pattern (`22`) and the OWASP LLM01 cases, and use assertions to check that tool-palette isolation (§1's point that `packages/agents` has no `send`/`delete` at all) actually blocks them.
- **UI smoke**: `apps/web` uses Playwright. `apps/desktop` (Tauri) is A7-D4 (pending a spike; default tauri-driver + WebdriverIO).
- **Spikes**: leave the script and a `result.md` (pass/fail + basis) in `tools/spikes/<question-slug>/`. The 8 spikes of §16 Phase 0 and A7-D4/A7-D5's own spikes (worktrunk CLI, Tauri UI test tooling) all follow this format.

## 6. CI, Branches, Commits, Releases

**CI (GitHub Actions)**: `.github/workflows/ci.yml` always runs lint (Biome) + typecheck (`tsc --build`) + unit (`vitest run`, without containers) on every PR/push. The integration job (Postgres 17 service container, matching the version fixed by A6-D4/99-review §1.2) is triggered by a path filter only when paths under `packages/kernel`, `packages/db`, `packages/memory`, or `apps/hub` change (A7-D7, to cut CI time). A Tauri dev build job additionally runs on a macOS runner only when `apps/desktop` changes.

**Branch/commit conventions**: Story branches are `ralph/<story-id>`. One atomic commit per story (implementation + tests + review feedback squashed), with message format `<story-id>: <one-line summary>` plus a list of the acceptance criteria met in the body. `Co-Authored-By` names the model that actually implemented that story (for Opus/Sonnet/Haiku, `Co-Authored-By: Claude <tier> <noreply@anthropic.com>`; for DeepSeek, `Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>`). Since v1 is a one-person project (Logan), the orchestrator (Opus, main worktree) merges verified + reviewed branches into `main` sequentially and locally with no PR review process — ralph's reviewer gate (Step 7) takes the place of PR review.

**Releases**: Phases A~C ship only the unsigned dev build from `pnpm tauri build` (with `xattr -d com.apple.quarantine` guidance in the README, assuming a local install). Apple Developer signing and notarization are added in Phase D (§16 exit criteria: "5 channels + agents work without the mini; repo is public").

## 7. Phase A Story Backlog (draft, 35 stories)

Order = dependency order (top to bottom). Prohibitions that apply to every story are listed separately below the table; the table's "additional prohibitions" column carries only per-story exceptions. This backlog becomes the input to the `writing-plans` skill (A7-D10).

| ID | Goal | Outputs | Verify command | Tier | Depends on |
|---|---|---|---|---|---|
| US-A00 | Phase 0 spike scaffold: for each of the 14 gates (①~⑭) in master §16, create a `tools/spikes/<question-slug>/` folder + a script placeholder + a `result.md` template (pass/fail, basis, date). Outside the workspace build graph (§1) | `tools/spikes/*/result.md` (14 files, unfilled templates) | `find tools/spikes -maxdepth 1 -mindepth 1 -type d` returns 14 lines | Haiku | — |
| US-A01 | `packages/db` scaffold + migration runner (runner only, no schema; advisory lock + sha comparison) | `packages/db/src/migrate.ts`, `_omnis_migrations` bootstrap | `pnpm --filter @omnis/db test` | DeepSeek | — |
| US-A02 | DDL (A3-D9 `0001`~`0002`): `0001_extensions.sql` (pgvector etc.) + `0002_core_inbox.sql` (`accounts`/`account_secrets`/`persons`/`identities`/`person_merges`/`agent_runtimes`/`threads`/`items`/`calendar_events`, the 3 columns `items.author_person_id`/`author_agent_id`/`author_is_me`, including `items.sensitivity`/`items.embedding vector(768)` — exactly the 9 tables fixed by A3 §2·§2.1·§8·§10, 99-review v2 §4-3) | `packages/db/migrations/0001_extensions.sql`, `packages/db/migrations/0002_core_inbox.sql` | `pnpm db:migrate && pnpm --filter @omnis/db test` | DeepSeek | A01 |
| US-A03 | DDL (A3-D9 `0003`~`0004`): `0003_labels.sql` (`labels`/`item_labels`/`thread_labels`/`label_rules`) + `0004_tasks_approvals.sql` (`agent_sessions`/`tasks`/`pending_approvals`/`notes`/`digests`/`agent_runs` — `agent_runs` is the table master §6 and A4-D16 nail down as "the single source for evaluation, cost, and audit") | `packages/db/migrations/0003_labels.sql`, `packages/db/migrations/0004_tasks_approvals.sql` | Same | DeepSeek | A02 |
| US-A04 | DDL (A3-D9 `0005`~`0008`): `0005_memory.sql` (`entities`/`relations`/`memories` + HNSW) + `0006_kernel.sql` (`events` (append-only)/`audit_log`/`jobs` + append-only triggers) + `0007_notify.sql` (LISTEN/NOTIFY channel, id-only payload) + `0008_publication.sql` (`zero_omnis` publication). US-A02 (`0002_core_inbox.sql`) creates `calendar_events` exactly as A3 §2.1's DDL specifies — it is not created again here (the old exclusion reason, "it is not defined anywhere in A3", is stale; 99-review v2 §4-3). **Acceptance criteria**: against the `calendar_events` created by US-A02, both the `attendees_count BETWEEN 1 AND 8` query (the premise of A4 §7.1's meeting-end trigger) and the 48-hour window query on `end_at` (A3 §12 (5b), the premise of A4 §7.5's metric) must succeed | `packages/db/migrations/0005_memory.sql`, `0006_kernel.sql`, `0007_notify.sql`, `0008_publication.sql` | Same | Sonnet | A03 |
| US-A05 | `packages/kernel` event bus (ephemeral/durable/cold 3-tier routing, NOTIFY 8000B id-only) | `packages/kernel/src/events.ts` | `pnpm --filter @omnis/kernel test:integration` | Opus | A04 |
| US-A06 | Scheduler (`jobs` table + cron executor; first job = health check) | `packages/kernel/src/scheduler.ts` | Same | Opus | A05 |
| US-A07 | Approval gate API (`propose`/`decide` state transitions, action ∈ `send`/`delete`/`delegate`/`calendar_write`, porting HumanInterrupt/HumanResponse — `22`) | `packages/kernel/src/approvals.ts` | Same | Opus | A03, A05 |
| US-A08 | kill switch (global flag, a checkpoint in every autonomous loop/egress) | `packages/kernel/src/kill-switch.ts` | Same | Opus | A05 |
| US-A09 | Audit log middleware (enforces that all egress passes through it) | `packages/kernel/src/audit.ts` | Same | Opus | A04, A07 |
| US-A10 | `apps/hub` bootstrap (kernel initialization, Postgres connection, graceful shutdown) | `apps/hub/src/main.ts` | `pnpm --filter @omnis/hub build` | Sonnet | A05~A09 |
| US-A11 | `packages/protocol`: `NormalizedItem`/`Adapter`/`Capabilities` zod schemas | `packages/protocol/src/adapter.ts` | `pnpm --filter @omnis/protocol test` | Sonnet (+DeepSeek boilerplate) | — |
| US-A12 | Slack adapter (Socket Mode, backfill, subscribe) | `packages/adapters/slack/src/index.ts` | `pnpm --filter @omnis/adapter-slack test` | Sonnet | A11 |
| US-A13 | Gmail adapter (`users.watch` + Pub/Sub, OAuth, backfill) | `packages/adapters/gmail/src/index.ts` | `pnpm --filter @omnis/adapter-gmail test` | Sonnet | A11 |
| US-A14 | Google Calendar adapter (`events.list` + syncToken polling) | `packages/adapters/google-calendar/src/index.ts` | `pnpm --filter @omnis/adapter-google-calendar test` | Sonnet | A11 |
| US-A15 | The 3 adapter contract tests (fixture replay, one each for A12~A14) | `*/test/contract.test.ts` | `pnpm test:contract` | DeepSeek (review Sonnet+) | A12~A14 |
| US-A16 | Bridge protocol types (session_key/session_id/capabilities, MCP 2026-07-28 version negotiation) | `packages/protocol/src/bridge.ts` | `pnpm --filter @omnis/protocol test` | Opus | A11 |
| US-A17 | `apps/local-agent` daemon scaffold (Tailscale connection, session registration) | `apps/local-agent/src/main.ts` | `pnpm --filter @omnis/local-agent test` | Sonnet | A16 |
| US-A18 | Claude Code bridge (wrapping `claude -p --output-format stream-json --resume`) | `apps/local-agent/src/bridges/claude-code.ts` | Same | Opus | A17 |
| US-A19 | Codex bridge (`app-server` JSON-RPC, version pinned) | `apps/local-agent/src/bridges/codex.ts` | Same | Opus | A17 |
| US-A19b | Start `local-agent` on the Mac mini host (exposing only the Codex bridge; Hermes is Phase B) + apply a per-host concurrency cap of 4 (Mac mini/MacBook each) | `apps/local-agent/src/host-config.ts` (branching on host=`mini`/`macbook`), LaunchAgent plist (A6-D10 approach) | `pnpm --filter @omnis/local-agent test -- --host=mini` | Sonnet | A17, A19 |
| US-A20 | Bridge mock runtime test (stream-json/JSON-RPC mockups without the real CLI) | `apps/local-agent/test/bridge-mock.test.ts` | `pnpm --filter @omnis/local-agent test` | Sonnet | A18, A19 |
| US-A21 | Zero schema definition + `apps/hub` wiring (durable-tier Item row replication) | `packages/kernel/src/zero-schema.ts` | `pnpm --filter @omnis/kernel test:integration` | Opus | A05, A10 |
| US-A22 | Zero client initialization (verify one round trip of a read-only query from `apps/desktop`) | `apps/desktop/src/zero-client.ts` | `pnpm --filter @omnis/desktop test` | Sonnet | A21, A25 |
| US-A22b | `agent_runs` recording helper (shared by every L3 loop call): records the input hash, tier, provider, tokens, latency, and outcome as a single `agent_runs` row (A4-D16, master §6) — every L3 loop story added later takes routing through this helper as an acceptance criterion | `packages/agents/src/record-run.ts` | `pnpm --filter @omnis/agents test` | Sonnet | A03, A11 |
| US-A23 | Classification/labeling loop (T0 local rule stub → T1 DeepSeek fallback interface, work/personal; every execution calls US-A22b's `recordRun`) | `packages/agents/src/classify.ts` | `pnpm --filter @omnis/agents test` | Sonnet | A11, A05, A22b |
| US-A23b | `items.sensitivity` classification hook — Phase A minimal implementation: default `'normal'`; if the person is VIP (flagged from `persons` priority/label), promote to `'personal'` only. Master §14/Q11's rules for T2 reservation and for staying VIP on degradation are consumed by the cost-policy implementation story (Phase B, after `agent_runs.cost_usd` aggregation) — this story goes only as far as filling values into the column | `packages/agents/src/sensitivity.ts` | `pnpm --filter @omnis/agents test` | Sonnet | A02, A23 |
| US-A24 | Design tokens + shadcn/ui setup (Liquid Glass primitives) | `packages/ui/src/tokens.ts`, `packages/ui/src/components/*` | `pnpm --filter @omnis/ui test` | Sonnet | — |
| US-A25 | Tauri 2 scaffold (`window-vibrancy` integration, empty shell) | `apps/desktop/src-tauri/*` | `pnpm tauri:build` | Sonnet | A24 |
| US-A26 | Inbox screen (filter pills, react-virtuoso list) | `apps/desktop/src/screens/Inbox.tsx` | `pnpm --filter @omnis/desktop test` | Sonnet | A22, A24 |
| US-A27 | Thread screen (item rendering, status badges) | `apps/desktop/src/screens/Thread.tsx` | Same | Sonnet | A22, A24 |
| US-A28 | Agent Session screen (Thread view + tool_call badges, borrowing the `TOOL_LABELS` pattern — `22`) | `apps/desktop/src/screens/AgentSession.tsx` | Same | Sonnet | A20, A27 |
| US-A29 | ⌘K command palette (cmdk, including agent actions) | `apps/desktop/src/components/CommandPalette.tsx` | Same | Sonnet | A24 |
| US-A30 | Approval card UI (renders pending_approvals, 4-way accept/edit/respond/ignore — `22`) | `apps/desktop/src/components/ApprovalCard.tsx` | Same | Sonnet | A07, A22 |
| US-A31 | Onboarding flow (Slack/Gmail/Calendar OAuth connection wizard, Keychain storage) | `apps/desktop/src/screens/Onboarding.tsx` | `pnpm --filter @omnis/desktop test` | Sonnet | A12~A14, A24 |

**Phase B seed note (outside this backlog's scope)**: The ingest RPC that the MacBook `local-agent` exposes (`ingest.scan(roots, since)` → `ingest.read(path)`, A2 §3.2) is consumed by A4 §10.1 L9 Ingestion (A4-D19), and L9 Ingestion itself is in master §16's Phase B scope ("3-layer memory + ingestion (local, Drive, GitHub)"). The story implementing this RPC is therefore not included in the 35 Phase A stories above — Phase A goes only as far as US-A17 (local-agent daemon scaffold), and the `ingest.*` methods are layered on top of it when the Phase B backlog is written. US-A19b (Mac mini `local-agent`) already exposes only the Codex bridge (Hermes read-only sessions are Phase B; A7-D6, master §5 D1) — no change, cross-check only.

**Prohibitions common to all stories**:
- Do not wire irreversible tools such as `send`/`delete`/`delegate`/`calendar_write` directly before the approval gate (US-A07) is complete — until then, handle them only via mocks/interfaces.
- Do not import provider SDKs arbitrarily outside `packages/protocol` (keep them isolated inside the adapter packages).
- Do not modify migration files directly — always add a new numbered migration (append-only).
- Do not delete or skip tests to make them pass (same rule as ralph's Final_Checklist).

## Review Notes (2026-09-20)

Only substantive issues that cannot be fixed inline are recorded. Items resolved in the 2026-09-20 v0.95 fix pass were moved to the "Change History" section below.

1. **[minor] The Biome adoption (A7-D2) has no research basis.** Every other A7-D# decision cites a `research/` file number as its basis, but only the "lint/format is Biome alone" decision has no research citation (the research folder has no mention of Biome/ESLint/Turborepo/Nx at all — confirmed by grep). The "YAGNI" in the basis column is the logic for excluding Turborepo/Nx, not the logic for choosing Biome. This is not a request to change the decision, only a flag that the basis column is empty. **Unresolved in this pass**: it was not included in this fix list, and A7's own judgment alone provides no basis for commissioning new research, so it is left as is.

ready = true (no blockers; 1 item remaining, minor).

## Change History (v0.95, 2026-09-20)

- Switched the migration path to `packages/db/migrations/000N_<name>.sql` + the tracking table `_omnis_migrations` (A7-D3); rewrote US-A02~A04 to match A3-D9's 8-file split (0001~0008) and included the DDL for `agent_runtimes` (US-A02), `label_rules` (US-A03), and `agent_runs` (US-A03). `calendar_events` was an unresolved schema gap in A3/A4, so rather than invent it, it was explicitly excluded as UNVERIFIED in US-A04.
- Corrected US-A09's dependencies from `A03, A07` to `A04, A07` (because the audit log table moved to US-A04 in the new file split).
- Corrected the approval handler's tool names from `delegate.run`/`calendar.write` to `delegate`/`calendar_write` (§1, §7 common prohibitions). Documented the distinction from the bridge RPC method names (A2 `delegate.run`).
- Checked `@omnis/desktop` package-name consistency — there is no `@omnis/app` notation anywhere in A7, so no further changes (the collision was on the A8 side, 99-review §1.2).
- Rewrote A7-D5 and §3 so that 3 consecutive Opus failures stop the loop without auto-escalation and escalate to Logan (aligned with master §17).
- Corrected the CI integration job's Postgres version from 16 to 17 (§6, §5).
- Added 4 stories to the Phase A backlog: US-A00 (scaffold for the 14 Phase 0 spikes + `result.md` templates), US-A19b (Mac mini `local-agent` + Codex exposure, per-host concurrency cap of 4), US-A22b (shared `agent_runs` recording helper that every L3 call routes through), US-A23b (`items.sensitivity` classification hook; Phase A minimal: default `normal` + VIP promotion). Backlog count 31→35; updated A7-D10.
- Corrected the story card field from `assignedTier` to `tier` and documented the rule that a Sonnet+ review is forced when `tier: "deepseek"` (§3, aligned with A7-D6).
- Corrected the §1 monorepo structure description so that `local-agent` runs on both the Mac mini (Codex, Hermes from Phase B) and the MacBook (Claude Code, Codex).

### v1.0 (2026-09-20, pass 2)

- Header: version 0.95 → 1.0; pinned the parent document to master v1.0. Added A3 §2.1, A4 §7.1·§7.5·§10.1, and A2 §3.2 to the basis list.
- US-A02: added `person_merges`·`calendar_events` to the `0002_core_inbox.sql` outputs, matching all 9 tables fixed by A3 §8 (99-review v2 §4-3).
- US-A04: deleted the stale sentence "`calendar_events` is not defined anywhere in A3 — UNVERIFIED" and replaced it with a sentence stating that US-A02 creates `calendar_events` exactly per A3 §2.1's DDL. Added to the acceptance criteria the condition that both the `attendees_count BETWEEN 1 AND 8` query (A4 §7.1 meeting-end trigger) and the 48-hour window query (A3 §12 (5b), A4 §7.5 metric) must succeed (99-review v2 §4-3).
- Added a "Phase B seed note" below the §7 table: it states that the MacBook `local-agent`'s ingest RPC (`ingest.scan`/`ingest.read`, A2 §3.2) is not placed in the Phase A backlog because L9 Ingestion (master §16 Phase B scope) uses it. Cross-checked that US-A19b already exposes only the Codex bridge on the Mac mini `local-agent` (Hermes is Phase B) — the story itself is unchanged.
- Corrected the A3 citation in the §1 `packages/agents` paragraph from `pending_approvals_action_ck` to **`approvals_action_ck`** (it did not match the actual CONSTRAINT name in A3 §4). All other table and column names cited by A7 (`accounts`~`zero_omnis`, `agent_runs.cost_usd`, `items.sensitivity`/`author_*`, `attendees_count`, etc.) were cross-checked exhaustively against the A3 v1.0 DDL, and no mismatch other than this one was found.
