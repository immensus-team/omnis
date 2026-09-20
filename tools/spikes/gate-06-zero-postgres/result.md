# Gate ⑥: Zero + Postgres propagation latency

- **Question**: When a local Postgres 17 (pgvector) instance is paired with zero-cache, does the time from a single row INSERT until a Zero client subscription receives that change satisfy G5 (≤2s)?
- **Owning appendix**: A6 (§5, §11.3 row ⑥)
- **Owner**: agent(unattended)
- **Host**: macbook (M5 Max, local Homebrew postgresql@17 + zero-cache-dev, both on a scratch DB/replica dedicated to this spike)
- **Run date**: 2026-09-20
- **Result (Pass/Fail)**: **PASS**
- **Measurements/Evidence**:
  - `npx tsx measure.ts` run 3 times: `latency_ms=68.9` (exit 0), `latency_ms=46.0` (exit 0), `latency_ms=65.1` (exit 0). All three are under 4% of the pass threshold (≤2000ms).
  - For the third run, zero-cache was fully shut down and brought back up using only this document's reproduction procedure (last line of **Notes** below) before measuring — the same level holds even with the replica rebuilt from scratch under a new `ZERO_REPLICA_FILE`, so the measurements do not depend on a warm cache.
  - Changed `wal_level` from `replica` to `logical` (`ALTER SYSTEM SET wal_level = 'logical';` + `brew services restart postgresql@17`); after the restart, `SHOW wal_level;` → confirmed `logical`. **This is a permanent configuration change to the local Homebrew postgresql@17** (it also applies to other projects' Postgres running on this MacBook — there is only one instance, so it cannot be isolated. To revert: `ALTER SYSTEM SET wal_level = 'replica'` then restart).
  - Created the `probe_events` scratch table in the `omnis_spike_zero` DB (pgvector was not needed and is not installed; only `pgcrypto` via `CREATE EXTENSION`), attached `zero-cache-dev` (port 4848), opened a `probe_events` subscription from a Zero client, then measured from the time of a separate `psql` INSERT (t0, on the `performance.now()` clock) to the time the client listener received the new row (t1).
- **decided_by**: agent
- **Notes**:
  - **Three API drift points found relative to the plan document's original text** (confirmed by inspecting the installed `@rocicorp/zero@1.9.0` directly; also recorded in deviations):
    1. There is no `timestamp()` column helper (the package only exports `boolean/enumeration/json/number/string`). Switching `createdAt` to `number()` and mapping it to the actual Postgres column name (`created_at`) required `.from("created_at")` (Zero does not automatically camelCase column names).
    2. `z.query.<table>` (the API the plan document used) is deprecated as "legacy queries" in 1.9.0, and is `undefined` at both the type and runtime level unless `enableLegacyQueries: true` is specified on `createSchema`.
    3. The query key is not the schema's JS variable name (`probeEvents`) but the actual table name string passed to `table()` (`probe_events`).
  - **The longest debugging session** (a finding not in the plan document): without `definePermissions` in `schema.ts`, zero-cache-dev only logs "no tables will be syncable" at startup and **every query silently returns 0 rows** (no error, just empty results — rows exist in Postgres but are invisible to the client). Fixed by adding `probe_events: { row: { select: ANYONE_CAN } }`. This spike uses a one-off local scratch DB, so `ANYONE_CAN` is sufficient, but Phase A `@omnis/kernel/zero-schema.ts` needs real row-level permission rules (outside this task's scope).
  - The `wal_level` change is system-wide, so other worktrees on this MacBook that use the local Postgres (such as `omnis.plan-kernel-db`) also run with it set to `logical` — it is safe for later gates or tasks to assume this (A3 requires `wal_level=logical` in production too, so the direction is consistent).
  - `tools/spikes/gate-06-zero-postgres/` has its own `package.json` (installed with `pnpm install --ignore-workspace`; it falls outside the `packages/*`/`apps/*` globs in the root `pnpm-workspace.yaml`, so the root lockfile is untouched) and its own `pnpm-lock.yaml` — this satisfies Global Constraints' "outside the build graph" requirement.
  - The `zero-cache-dev` process was stopped after measuring (port 4848 is not in use). To reproduce: since the `omnis_spike_zero` DB already exists and `wal_level=logical` is already in effect, run `cd tools/spikes/gate-06-zero-postgres && ZERO_UPSTREAM_DB=postgres://logankim@localhost:5432/omnis_spike_zero ZERO_CVR_DB=postgres://logankim@localhost:5432/omnis_spike_zero ZERO_REPLICA_FILE=/tmp/omnis-spike-zero-<new>.db npx zero-cache-dev -p schema.ts &` then `npx tsx measure.ts`.
