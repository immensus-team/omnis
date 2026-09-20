# Phase 0/A plan cross-validation (2026-09-20)

Six plans + the contract (`2026-09-20-phase-a-interfaces.md`) + A7 §1/§7 cross-check. **Verdict: nothing blocks starting the kernel-and-db plan (ready).** However, M1–M5 below must be fixed in the contract before the first commit — because the task that creates the root scaffold is itself kernel-and-db Task 1.

## 1. Discrepancy table

| # | Plan/Task | Expected (contract · A7) | Actual | Fix owner |
|---|---|---|---|---|
| M1 | Root `package.json` — kernel T1 / protocol T1 | one vitest version | `vitest` **2.1.9** (kernel) / `^2.1.8` (protocol) / **5.0.1** (agents) / `^2.1.0` (bridge·desktop) | kernel T1 pins `2.1.9`, the other 3 plans fixed |
| M2 | protocol T1 vs sync T4 | one zod (protocol owns it) | `zod ^3.24.1` (protocol) vs **`4.6.5`** (agents). agents puts protocol's zod3 `Scope`/`Sensitivity` inside a zod4 `z.object` → parsing fails | protocol T1 is canonical, sync T4 fixed |
| M3 | kernel T1 / sync T4 | one `pg` 8.x | `8.13.1` vs **`8.23.0`**; `typescript` `5.6.3` vs `^5.7.2`; `packageManager` `pnpm@9.12.3` vs `9.15.0` | kernel T1 |
| M4 | kernel T1 ∩ protocol T1 | one owner for the root files | Both sides generate `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, and `biome.jsonc` independently (`test -f` guard). Contents differ: presence or absence of `verbatimModuleSyntax`/`isolatedModules`/`noImplicitOverride`, biome `lineWidth` 110 vs 100, `db:migrate` as `tsx …/cli/migrate.ts` vs `--filter @omnis/db migrate` → **whichever runs first wins** (non-deterministic) | Add to contract §2: "root file owner = kernel-and-db T1" |
| M5 | Root scripts | Contract §2: `pnpm dev` (hub+desktop), `tauri:dev`, `tauri:build` | Present in neither root `package.json`. The US-A25 verification command is `pnpm tauri:build`, which can't run | kernel T1 |
| M6 | **Hub `WS /bridge` has no owner** | Contract §5 fixes it as a hub surface | kernel T24 defers it with "US-A17 wires up `onUpgrade`" → the agent-bridge plan mentions `apps/hub` **zero** times. local-agent only builds the dialing client. No end-to-end bridge path in Phase A | New task needed (add "hub-bridge-ws" to kernel T24 or to the bridge plan) |
| M7 | adapters T4 vs desktop T9 | one Keychain scheme | Adapters read `omnis.slack.xoxb.<team>` (account=`<team>`) + `…xoxb.<team>.app`, 2 entries. Onboarding writes only `omnis.slack.xoxp.<team>` (account=`281932556+jinhologankim@users.noreply.github.com`), 1 entry → connect fails | desktop T9 |
| M8 | adapters T7·T10 | Contract §9 `omnis.<channel>.<kind>.<external_id>` | `omnis.gmail.<email>` — the `<kind>` segment is missing. gcal reusing the gmail entry (`keychainService: "omnis.gmail.…"`, `channel:"gcal"`) is also not in the contract | Contract §9 |
| M9 | desktop T3 | Contract §1 `@omnis/desktop` deps = `@omnis/ui` + `@omnis/protocol` | `import { zeroSchema } from "@omnis/kernel/zero"` (permitted by contract §7). §1 ↔ §7 contradict each other, and desktop's `package.json` has no `@omnis/kernel` workspace dep either | Contract §1 |
| M10 | desktop T3 vs sync T1 | `@rocicorp/zero` pinned (A6 §5 forbids caret) | sync `1.9.0` exact / desktop `pnpm add @rocicorp/zero` (unpinned) | desktop T3 |
| M11 | desktop T8 | Contract §9 env var list | `OMNIS_HUB_HTTP_URL` newly introduced, not in the list | Contract §9 |
| M12 | Root `vitest.workspace.ts` (kernel T1) | Collect units from every package | Only `include: [".../*.test.ts"]` → `*.test.tsx` in `packages/ui` and `apps/desktop` are **silently skipped** by `pnpm test` | kernel T1 |
| M13 | All plans | A7 §6 `.github/workflows/ci.yml` | No plan creates it | Unassigned (recommend adding a task at the end of Phase A) |
| M14 | desktop vs phase-0 T17 | Consume the spike result | desktop has already settled on vitest+RTL+jsdom, while phase-0 T17 is a tauri-driver+WebdriverIO spike → no consumer for the result | Narrow phase-0 T17's scope to e2e only |

Duplicate work: (a) root scaffold M4, (b) `vitest.workspace.ts` (kernel T1 + protocol T15), (c) `createLogger` (kernel T12 + local-agent T5), (d) `readKeychainSecret` (3 adapters + local-agent T8). (c)(d) are unavoidable given package boundaries — one line in the contract marking them "intentional duplication" prevents re-litigation.

## 2. Recommended contract changes (old → new)

- **§1 table** — `@omnis/agents` deps `@omnis/protocol`,`@omnis/memory`,`ai` → **`@omnis/protocol`,`ai`,`pg`** (`ClassifyCtx.pool: Pool` already requires pg; memory is unused in Phase A). `@omnis/desktop` deps `@omnis/ui`,`@omnis/protocol` → **+`@omnis/kernel` (`/zero` subpath only)**.
- **§2** — add one line: "the owner of the root `package.json`/`pnpm-workspace.yaml`/`tsconfig.base.json`/`biome.jsonc`/`vitest.workspace.ts` is kernel-and-db Task 1". Add version pins: `vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `pnpm@9.12.3` · `@rocicorp/zero 1.9.0`. Include `*.test.tsx` in the unit include. State in the command table that `pnpm dev`/`tauri:dev`/`tauri:build` are root scripts.
- **§3.5** — add to the bridge exports: **`PermissionProfile`, `SessionOrigin`, `SessionState`, `RuntimeState`, `SUPPORTED_PROTOCOL_VERSIONS`, `RpcMeta`, `withMeta`, `assertProtocolVersion`, `toJsonRpcError`, `JSONRPC_ERRORS`** (§8 already uses `permission_profile` but never defines the symbol).
- **§5** — add **`beginExecution`/`completeExecution`/`failExecution`/`expire`** to `Approvals`. Add the missing symbols: **`PendingApproval`** (used by §5, the hub routes, and desktop but never defined), **`Logger`/`createLogger`**, **`killSwitchStatus`**, **`runEgress`/`EgressToken`/`EgressSpec`/`createOutbox`/`createIngestSink`**, **`assertZeroPublication`/`ZeroPublicationError`**. State "server implementation owner = kernel T24" in the `WS /bridge` row.
- **§6** — add **`ItemRow`** (the contract uses the name without defining it → owner `@omnis/agents/src/types.ts`), **`configureAgents(deps:{pool:Pool})`/`getAgentsPool()`/`AgentsNotConfiguredError`** (since §6's `recordRun` takes no pool argument, an injection path is mandatory).
- **§7** — state the `@rocicorp/zero` version `1.9.0`, add `ZERO_TABLES`/`ZERO_ITEM_COLUMNS` exports.
- **§9** — add **`OMNIS_HUB_HTTP_URL`** to the env vars. In the Keychain rules, state "Google services (`gmail`/`gcal`) share a single `omnis.gmail.<email>` entry and omit the `<kind>` segment" and "Slack uses 2 entries, `omnis.slack.xoxb.<team_id>` (bot) and `…​.app` (app token), with account=`<team_id>`".
- **§10** — reflect in the table that kernel-and-db Tasks 16–25 depend on `@omnis/protocol` (US-A11) (that dependency is absent from A7 §7's dependency column).

## 3. Cross-execution order

**Wave 0 — immediately, mutually parallel (zero prerequisites)**
1. `phase-0` T1 (spike scaffold) → when done, **gates ⑥⑦⑧⑪⑫⑬⑭** (T2–T8) + T16·T17 all in parallel. Unattended execution, no Logan involvement needed.
2. `kernel-and-db` T1–T15 (root scaffold → `@omnis/db` → DDL 0001–0008 → events/scheduler). **Depends on no gate.** However, by the time T10 (`ddl-0008-publication`) starts, the Gate ⑬ result must be in to finalize the column list.
3. `protocol-and-adapters` T1–T3 (US-A11). **Skip** the root-file creation step (M4).
4. `desktop` T1 (US-A24, no prerequisites).

**Wave 1 — after (2) and (3)**
- `kernel-and-db` T16–T25 (US-A07–A10) ← requires the US-A11 merge.
- `agent-bridge` T1–T4 (US-A16) ← needs only US-A11. Parallel with (1)(2).
- `sync-and-agents` T4–T9 (US-A22b/A23/A23b) ← kernel T6 (`0004`) + T4 (`0002`). Parallel with kernel T16–25.
- `protocol-and-adapters` T4–T15 (US-A12–A15) ← US-A11. However, the real-connection steps are only meaningful once the **Gate ⑨ (Slack) · ⑩ (Gmail) · ① (Calendar)** results are in — Logan-assisted.

**Wave 2** — `agent-bridge` T5–T20 ← US-A16 · `sync-and-agents` T1–T3 (US-A21) ← kernel T25 · `desktop` T2 (US-A25) ← T1.

**Wave 3** — `desktop` T3 (US-A22) ← sync T3 + desktop T2 → T4·T5·T7·T8 in parallel, T6 (US-A28) ← bridge US-A20, T9 (US-A31) ← adapters + gates ⑨⑩.

Logan-assisted gates ①②③④⑤⑨⑩ are **unrelated** to the kernel/DB/protocol/bridge type work — they're needed only for real adapter connections and the onboarding step.
