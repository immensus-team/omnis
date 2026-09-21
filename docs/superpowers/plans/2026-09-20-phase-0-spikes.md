# Phase 0 Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave all 14 gates (①~⑭) that master §16 pinned down as "no Phase A kickoff before they pass", plus the US-A00 scaffold and the self-spikes A7-D4/A7-D5 call for (the Tauri UI testing tool and the worktrunk CLI confirmation), as runnable scripts + `result.md` under `tools/spikes/`, and decide whether Phase A may start with a single decision table.

**Architecture:** `tools/spikes/` lives outside the workspace build graph (A7 §1) — no `packages/*` imports this folder, and scripts in this folder do not import `packages/*` either (partly because they do not exist yet: `@omnis/db` and friends only appear after US-A01). Each gate lives in its own `tools/spikes/<slug>/` with a self-contained script (plus its own `package.json` when needed) and a `result.md`. Of the 14 gates, 7 (⑥⑦⑧⑪⑫⑬⑭) are unattended spikes that run on the MacBook without human intervention, and 7 (①②③④⑤⑨⑩) are assisted spikes that need Logan's hands (OAuth consent, GUI permission approval, QR pairing) — this document puts unattended first and assisted second.

**Tech Stack:** Node 22, TypeScript 5 (strict), `pg` 8.x, `@rocicorp/zero` 1.9.0 (confirmed installed on the MacBook, `tools/spikes/_probes/2026-09-20-cli-probes.md`), Postgres 17 + pgvector (local native, `brew install postgresql@17`), Ollama 0.34.2 (local), Codex CLI (`codex-cli` 0.155.1, pinned to `rust-v0.155.1`), Claude Code CLI 2.1.274, `worktrunk` (brew) 0.78.0, `sops` 3.13.3 + `age` 1.3.2, `@tauri-apps/cli` 2.11.5, `tauri-driver` + WebdriverIO (the A7-D4 default assumption; the version is pinned at install time in Task 17).

**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` §16 (Phase 0), §8 (channel matrix), §4.2 (deployment topology) + appendices `A6-ops-infra.md` §11 (the canonical source for spike procedure and pass criteria), `A1-channel-adapters.md` §4 (channel spikes A1-①~⑤), `A2-agent-session-bridge.md` §4.1/§4.2/§7.1/§8.3 (S-A2-1/2), `A3-data-schema.md` §7/§14 (S-A3-2), `A7-dev-process.md` §3/§7 (US-A00, A7-D4/A7-D5) + contract: `docs/superpowers/plans/2026-09-20-phase-a-interfaces.md`.

## Global Constraints

- Node 22 + pnpm workspaces.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (A7 §1).
- Postgres 17 (A3).
- The hub binds only to `127.0.0.1:8787` (master §4.2) — even when a Phase 0 spike brings up a local Postgres/Zero, it does not violate this port convention (8642 is reserved for Hermes).
- Migrations are append-only files `packages/db/migrations/000N_<name>.sql` plus a tracking table `_omnis_migrations` (A3 §8) — this rule applies from Phase A onward; Phase 0 spikes have no `packages/db` yet, so they use their own scratch DDL only and never touch this path.
- Irreversible tools (`send`/`delete`/`delegate`/`calendar_write`) are not wired into any autonomous loop before the approval gate (US-A07) exists (the A7 §7 common prohibitions) — the "send one test event/message" step of spikes ① and ② is manual verification triggered by Logan's own hand, not an autonomous loop's egress, so it does not conflict with this prohibition.
- Never delete or skip a test to make it pass.
- Provider SDKs are used only inside their adapter package — Phase 0 has no adapter packages, so each gate script imports its provider client only within its own directory (it does not import another `tools/spikes/<slug>`).
- Keychain item naming follows A1's rule `omnis.<channel>.<kind>.<external_id>` as-is (bridge tokens use `omnis.bridge.token.<host>`).
- Story tiers follow the A7 §4 assignment table, and DeepSeek diffs must be reviewed by Sonnet or above (every task in this plan is Haiku/Sonnet, so there is nothing to delegate to DeepSeek).
- The last line of a commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (the execution-model notation rule of A7 §6 — the tasks in this plan are executed interactively by Fable).

---

### Task 1: Phase 0 spike scaffold (US-A00, tier: Haiku)

**Goal (A7 §7 verbatim)**: Phase 0 spike scaffold: for each of the 14 gates in master §16 (①~⑭), create a `tools/spikes/<question-slug>/` folder + script slot + `result.md` template (pass/fail, evidence, date). Outside the workspace build graph (§1).
**Deliverable (A7 §7 verbatim)**: `tools/spikes/*/result.md` (14 files, unfilled templates).
**Verification command (A7 §7 verbatim, US-A00 fix)**: `find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes` returns 14 lines.
**Tier**: Haiku.

**Note (mismatch with the repo's current state)**: This repo already contains `tools/spikes/_probes/2026-09-20-cli-probes.md` (CLI evidence Fable captured ahead of time for gates ⑦⑪⑫⑭ — Tasks 8, 9, 10 and 16 reuse it as-is). `_probes` is not one of the 14 gates, so it is not deleted. As a result, running A7 §7's verification command literally yields 15 lines — this plan adjusts the verification command to `find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes` to confirm 14 (only `_probes` is excluded from the count; everything else is identical to A7 §7).

**Files:**
- Create: `tools/spikes/gate-01-calendar-funnel/result.md`, `tools/spikes/gate-02-beeper-whatsapp/result.md`, `tools/spikes/gate-03-filevault-autologin/result.md`, `tools/spikes/gate-04-kmsg-read/result.md`, `tools/spikes/gate-05-tailscale-serve-iphone/result.md`, `tools/spikes/gate-06-zero-postgres/result.md`, `tools/spikes/gate-07-codex-appserver/result.md`, `tools/spikes/gate-08-ollama-nomic-embed/result.md`, `tools/spikes/gate-09-slack-socket-mode/result.md`, `tools/spikes/gate-10-gmail-watch-pubsub/result.md`, `tools/spikes/gate-11-claude-bare-hooks/result.md`, `tools/spikes/gate-12-permission-mode-mapping/result.md`, `tools/spikes/gate-13-zero-column-types/result.md`, `tools/spikes/gate-14-worktrunk-dryrun/result.md`.
- Test: none (the scaffold itself has no logic — verification is a single `find` command).

**Interfaces:** Consumes: none (leaf task, `packages/*` does not exist yet). Produces: none (no exported symbols — only folders and markdown templates).

1. Read the 14-gate table in `docs/spec/00-omnis-design.md` §16 and `docs/spec/A6-ops-infra.md` §11.1, and confirm the numbers and names.
2. Create the 14 directories and write `result.md` into each one using the template below verbatim (the example is `gate-01-calendar-funnel`; repeat for the other 13 changing only `<gate-slug>` and `<gate-name>` — actually create each file one by one):

```markdown
# Gate: <gate-name>

- **Question**: <the one-sentence question this spike answers>
- **Owning appendix**: <A6 | A1 | A2 | A3 | A7>
- **Owner**: <agent | Logan>
- **Host**: <macbook | mini>
- **Run date**: 
- **Result (Pass/Fail)**: 
- **Measurements/evidence**: 
- **decided_by**: 
- **Notes**: 
```

3. Fill `tools/spikes/gate-01-calendar-funnel/result.md` with the following content for real (leave the other 13 as the empty template from step 2; Tasks 2–15, covering each gate, fill them in — Task 1 only lays the skeleton):

```markdown
# Gate ①: Calendar events.watch via Funnel

- **Question**: Does a Google Calendar events.watch push notification arrive within 1 minute through Tailscale Funnel
- **Owning appendix**: A6 (§11.3)
- **Owner**: Logan
- **Host**: mini
- **Run date**: 
- **Result (Pass/Fail)**: 
- **Measurements/evidence**: 
- **decided_by**: 
- **Notes**: 
```

4. Run `find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes | wc -l` and confirm it prints `14` (PASS text: `14`). In the commit message body, leave a one-line note that the original A7 §7 command (which includes `_probes`, `find tools/spikes -maxdepth 1 -mindepth 1 -type d`) printing `15` is the normal state of this repo.
5. `git add tools/spikes && git commit -m "$(cat <<'EOF'
US-A00: create the 14 Phase 0 spike scaffolds

- Create a tools/spikes/<slug>/result.md template for each of gates ①~⑭
- Verify: find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes | wc -l → 14
- Keep the existing tools/spikes/_probes (pre-captured evidence for gates ⑦⑪⑫⑭), excluded from the count only

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

---

## Order A — Unattended gates (Fable/agent runs them without supervision)

### Task 2: Gate ⑥ — Zero + Postgres replication latency (owned by A6, tier: Sonnet)

**Question**: With a local Postgres 17 (pgvector) plus zero-cache attached, does the time from a single row INSERT until the Zero client subscription receives that change satisfy G5 (≤2s)?
**Owner**: agent (unattended) — no OAuth or GUI permissions needed, everything is a local process.
**Host**: macbook (M5 Max 64GB — where to deploy on the mini is a question for Phase A's `apps/hub`; Phase 0 verifies on the development machine first).
**Pass criteria (A6 §11.3 verbatim)**: "zero-cache starts up cleanly + changes replicate within 2 seconds (G5)".
**Fail → decision rule (A6 §11.3 verbatim)**: "PowerSync (master D7 fallback, but be aware of the MongoDB requirement when self-hosting)".

**Files:**
- Create: `tools/spikes/gate-06-zero-postgres/package.json`, `tools/spikes/gate-06-zero-postgres/schema.ts`, `tools/spikes/gate-06-zero-postgres/setup.sql`, `tools/spikes/gate-06-zero-postgres/measure.ts`.
- Modify: `tools/spikes/gate-06-zero-postgres/result.md` (fill in the empty template Task 1 created).

**Interfaces:** Consumes: `@rocicorp/zero` (npm; the `Zero` client class and `createSchema`/`table`/`column` come from the npm package, not from Task 1. `@omnis/kernel`'s `zeroSchema` (contract §7) does not exist yet — until Phase A US-A21 creates the official schema, this spike uses its own minimal schema). Produces: none (a spike is not a library).

1. Read `docs/spec/A6-ops-infra.md` §5 (zero-cache deployment and permissions) and the ⑥ row of §11.3.
2. Create a dedicated scratch DB: `createdb omnis_spike_zero && psql omnis_spike_zero -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"`.
3. Write `tools/spikes/gate-06-zero-postgres/setup.sql` (a minimal schema; the real omnis DDL comes from Phase A US-A02 — it is not imitated here):

```sql
CREATE TABLE IF NOT EXISTS probe_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  val text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER SYSTEM SET wal_level = 'logical';
```

4. Run `psql omnis_spike_zero -f setup.sql`, and if `wal_level` changed, restart the local Postgres (`brew services restart postgresql@17`).
5. Write `tools/spikes/gate-06-zero-postgres/schema.ts`:

```ts
import { createSchema, table, string, timestamp } from "@rocicorp/zero";

export const probeEvents = table("probe_events")
  .columns({ id: string(), val: string(), createdAt: timestamp() })
  .primaryKey("id");

export const schema = createSchema({ tables: [probeEvents] });
export type Schema = typeof schema;
```

6. Write `tools/spikes/gate-06-zero-postgres/package.json`:

```json
{
  "name": "gate-06-zero-postgres-spike",
  "private": true,
  "type": "module",
  "dependencies": { "@rocicorp/zero": "1.9.0", "pg": "8.13.1" }
}
```

7. Start `zero-cache` with settings dedicated to this spike: `ZERO_UPSTREAM_DB=postgres://localhost/omnis_spike_zero ZERO_CVR_DB=postgres://localhost/omnis_spike_zero ZERO_REPLICA_FILE=/tmp/omnis-spike-zero.db npx zero-cache-dev -p schema.ts`.
8. Write `tools/spikes/gate-06-zero-postgres/measure.ts` (open a subscription with the Zero client and measure the difference between the timestamp of the separate `psql` INSERT and the timestamp the client received the new row):

```ts
import { Zero } from "@rocicorp/zero";
import { schema } from "./schema.js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const z = new Zero({ server: "http://127.0.0.1:4848", userID: "spike", schema });
const id = randomUUID();
const t0 = performance.now();

const view = z.query.probeEvents.where("id", "=", id).materialize();
const seen = new Promise<number>((resolve) => {
  view.addListener((rows) => { if (rows.length > 0) resolve(performance.now()); });
});

execSync(
  `psql omnis_spike_zero -c "INSERT INTO probe_events (id, val) VALUES ('${id}', 'gate-06')"`,
);

const t1 = await seen;
console.log(`latency_ms=${(t1 - t0).toFixed(1)}`);
process.exit(t1 - t0 <= 2000 ? 0 : 1);
```

9. Run `cd tools/spikes/gate-06-zero-postgres && pnpm install && npx tsx measure.ts`. PASS condition: the `latency_ms=` value is 2000 or less and the process exit code is 0.
10. Fill `result.md` with the run date, Pass/Fail, the measured `latency_ms`, and decided_by (`agent`).
11. `git add tools/spikes/gate-06-zero-postgres && git commit -m "$(cat <<'EOF'
gate-06: Zero+Postgres replication latency spike

- Measure INSERT→subscription delivery time with a probe_events scratch table + zero-cache + a Zero client subscription
- Pass criteria (A6 §11.3): replication ≤2s (G5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 3: Gate ⑦ — Codex app-server version pin + one-turn round trip (owned by A6, procedure in A2 §4.2, tier: Sonnet)

**Question**: When `codex app-server` is run pinned to `rust-v0.155.1` and one turn is requested over JSON-RPC, does it run to completion from `item/started` through `item/completed` with no protocol errors?
**Owner**: agent (unattended) — the Codex CLI is already logged in (existing subscription), so no new OAuth consent is needed.
**Host**: macbook.
**Pass criteria (A6 §11.3 verbatim)**: "one turn runs to completion with no protocol errors".
**Fail → decision rule (A6 §11.3 verbatim)**: "re-pin the version + work around it with capabilities-based feature detection (master §9)".

**Files:**
- Create: `tools/spikes/gate-07-codex-appserver/run.ts`, `tools/spikes/gate-07-codex-appserver/schema/` (output directory for the generated JSON schema bundle).
- Modify: `tools/spikes/gate-07-codex-appserver/result.md`.

**Interfaces:** Consumes: `tools/spikes/_probes/2026-09-20-cli-probes.md` (the already-captured `codex app-server generate-json-schema` command and evidence of codex-cli 0.155.1). Produces: none.

1. Read `tools/spikes/_probes/2026-09-20-cli-probes.md` — confirm that `codex codex-cli 0.155.1` is already installed and that `codex app-server generate-json-schema --out <DIR>` is a valid command.
2. Run `codex --version` and confirm it matches `codex-cli 0.155.1` (pinned to `rust-v0.155.1`, the same as the macOS TOML example in A2 §2.1). If it does not match, record it as the `degraded` scenario in step 5.
3. Run `mkdir -p tools/spikes/gate-07-codex-appserver/schema && codex app-server generate-json-schema --out tools/spikes/gate-07-codex-appserver/schema` to extract the protocol schema bundle — Phase A US-A19 (`apps/local-agent/src/bridges/codex.ts`) uses this bundle as-is when aligning types.
4. Write `tools/spikes/gate-07-codex-appserver/run.ts` (find the request method that "starts a new turn" in the schema, send one turn with that method, and check whether the event names from the A2 §4.2 table (`item/started`, `item/completed`, `turn.completed`) actually arrive):

```ts
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const schemaDir = new URL("./schema", import.meta.url).pathname;
const schemaFiles = readdirSync(schemaDir).filter((f) => f.endsWith(".json"));
const bundle = schemaFiles.map((f) => JSON.parse(readFileSync(`${schemaDir}/${f}`, "utf8")));
const turnMethod = bundle
  .flatMap((doc) => Object.keys(doc.$defs ?? doc.definitions ?? {}))
  .find((k) => /sendUserTurn|newTurn|userTurn/i.test(k));
if (!turnMethod) throw new Error("no turn-start method found in generated schema — inspect schema/ by hand");

const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
let sawItemStarted = false;
let sawItemCompleted = false;
let sawTurnCompleted = false;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx: number;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    console.log("<<", line);
    if (line.includes("item/started")) sawItemStarted = true;
    if (line.includes("item/completed")) sawItemCompleted = true;
    if (line.includes("turn.completed") || line.includes("turn/completed")) sawTurnCompleted = true;
  }
});

function send(method: string, params: unknown, id: number) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  console.log(">>", msg.trim());
  child.stdin.write(msg);
}

send("initialize", { clientInfo: { name: "omnis-spike-gate-07", version: "0.0.1" } }, 1);
setTimeout(() => send(turnMethod, { prompt: "reply with exactly the word: pong" }, 2), 1000);

setTimeout(() => {
  child.kill();
  const pass = sawItemStarted && sawItemCompleted && sawTurnCompleted;
  console.log(`gate7_pass=${pass}`);
  process.exit(pass ? 0 : 1);
}, 30000);
```

5. Run `cd tools/spikes/gate-07-codex-appserver && npx tsx run.ts | tee run.log`. PASS condition: `gate7_pass=true` and exit code 0. If the turn-start method cannot be found automatically in the schema (the `throw` above fires), read the `schema/` directory by hand, add the exact method name to the regex in `run.ts`, and re-run — this is the point of the spike itself (pinning the exact protocol surface), so record the method name actually found in the `result.md` notes.
6. Fill in `result.md`: write the actually observed method name and event sequence in the measurements field.
7. `git add tools/spikes/gate-07-codex-appserver && git commit -m "$(cat <<'EOF'
gate-07: Codex app-server version pin + one-turn JSON-RPC round-trip spike

- Confirm codex-cli 0.155.1 (pinned to rust-v0.155.1), extract the protocol schema bundle with generate-json-schema
- Confirm a one-turn request receives item/started~item/completed~turn.completed
- Pass criteria (A6 §11.3): one turn runs to completion with no protocol errors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 4: Gate ⑧ — Ollama nomic-embed throughput (owned by A6, tier: Sonnet)

**Question**: Does embedding a 1,000-sentence inbox sample with `nomic-embed-text-v1.5` finish within 120 seconds with a p95 within 300ms (the A6 §11.1 quantified numbers + the §11.3 procedure "absorb ~2,000 incoming items per day with no real-time latency")?
**Owner**: agent (unattended) — all local inference.
**Host**: macbook.
**Pass criteria (A6 §11.3 verbatim + §11.1 numbers)**: "confirm the throughput to absorb an estimated ~2,000 incoming items per day with no real-time latency" (§11.3) — judged against the concrete numbers §11.1 provides: "1,000 sentences ≤120s, p95 ≤300ms".
**Fail → decision rule (A6 §11.3 verbatim)**: "move the batch to the nightly off-peak window (combined with the master §14 off-peak principle of after 19:00 KST) or offload it to the MacBook".

**Files:**
- Create: `tools/spikes/gate-08-ollama-nomic-embed/sample-sentences.txt`, `tools/spikes/gate-08-ollama-nomic-embed/bench.ts`.
- Modify: `tools/spikes/gate-08-ollama-nomic-embed/result.md`.

**Interfaces:** Consumes: none (only the Ollama HTTP API at `127.0.0.1:11434`). Produces: none.

1. Read `docs/spec/A6-ops-infra.md` §6 (Ollama), §11.1 and the ⑧ row of §11.3.
2. Pull the model with `ollama pull nomic-embed-text` (model name `nomic-embed-text`, the Ollama tag for `nomic-embed-text-v1.5`, which master D6/D10 settled on).
3. Generate 1,000 lines into `tools/spikes/gate-08-ollama-nomic-embed/sample-sentences.txt` (real inbox text does not exist yet, so use synthetic sentences that mimic the sentence-length distribution):

```bash
node -e "for (let i = 0; i < 1000; i++) console.log(\`omnis spike sample sentence \${i}: please review the meeting reschedule request and the attached file.\`)" > sample-sentences.txt
```

4. Write `tools/spikes/gate-08-ollama-nomic-embed/bench.ts`:

```ts
import { readFileSync } from "node:fs";

const lines = readFileSync(new URL("./sample-sentences.txt", import.meta.url), "utf8")
  .split("\n").filter(Boolean);

const latencies: number[] = [];
const t0 = performance.now();

for (const line of lines) {
  const s = performance.now();
  const res = await fetch("http://127.0.0.1:11434/api/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: line }),
  });
  if (!res.ok) throw new Error(`ollama error: ${res.status} ${await res.text()}`);
  await res.json();
  latencies.push(performance.now() - s);
}

const totalS = (performance.now() - t0) / 1000;
latencies.sort((a, b) => a - b);
const p95 = latencies[Math.floor(latencies.length * 0.95)];
console.log(`total_s=${totalS.toFixed(1)} p95_ms=${p95.toFixed(1)} n=${lines.length}`);
process.exit(totalS <= 120 && p95 <= 300 ? 0 : 1);
```

5. Run `cd tools/spikes/gate-08-ollama-nomic-embed && npx tsx bench.ts`. PASS condition: `total_s <= 120` and `p95_ms <= 300`.
6. Fill the measured `total_s`/`p95_ms`/`n` into `result.md`.
7. `git add tools/spikes/gate-08-ollama-nomic-embed && git commit -m "$(cat <<'EOF'
gate-08: Ollama nomic-embed throughput spike

- Batch-embed 1,000 sentences, measure total elapsed time and p95 latency
- Pass criteria: 1,000 sentences ≤120s, p95 ≤300ms (A6 §11.1), "absorb ~2,000 items/day in real time" (A6 §11.3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 5: Gate ⑪ — `claude -p --bare` hook injection (S-A2-1, owned by A2 §4.1, tier: Sonnet)

**Question**: In the `-p --bare` combination, when omnis's own hook settings are explicitly injected via `--settings`, does the `PreToolUse` hook actually fire and lead into the approval gate (the bridge's Unix socket call) — and does the target repo's own `.claude/settings.json` project hook stay silent in that case (2026-09-20 `plans-review.md` §2 fix)?
**Owner**: agent (unattended) — Claude Code is logged in with the existing subscription.
**Host**: macbook.
**Pass criteria (A6 §11.1/§16 verbatim, refined by A2 §8.3 and plans-review §2)**: in **at least one** of mode (a)/(b), the omnis `PreToolUse` hook fires and the project hook does not (`omnis_hook_fired=true` AND `project_hook_fired=false`).
**Fail → decision rule**: As A2 §4.1 already specifies — if neither mode satisfies the condition above (the omnis hook never fires at all, or every mode that fires it also fires the project hook so isolation fails), abandon the `PreToolUse`-based approval-promotion path in delegated runs and fall back to a polling approach where the bridge intercepts each tool_use event directly and promotes it to an approval (the alternative path in the hooks paragraph of A2 §4.1). **The decision outcome feeds into master `docs/spec/00-omnis-design.md` §19 Q13** (the pending-questions table, "decided by gate ⑪") — this plan does not edit the master document itself, so record only whether Q13 was reflected in `result.md`'s `decided_by`, and hand the actual §19 update to Logan as a confirmation item before Phase A starts.

**Premise (items 1 and 2 of "Findings that change gate ⑪" in `tools/spikes/_probes/2026-09-20-cli-probes.md`, verbatim)**:
> 1. `--bare` skips hooks, CLAUDE.md auto-discovery, plugins, keychain reads. Context can still be supplied explicitly via `--settings`, `--mcp-config`, `--add-dir`, `--system-prompt[-file]`. Whether hooks declared inside a `--settings` file are honored under `--bare` is UNVERIFIED and is the core of gate ⑪.
> 2. **Under `--bare`, Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings`; OAuth and Keychain are never read.** Consequence: a delegated Claude Code run with `--bare` cannot use the Claude subscription (T3) and bills per token on an API key. This contradicts A2-D11's assumption that delegated runs ride the subscription binary. Gate ⑪ must therefore test BOTH modes:
>    - (a) `--bare` + omnis hooks via `--settings` + `ANTHROPIC_API_KEY` → cost = API (T2-class pricing).
>    - (b) non-bare + `--settings <omnis-hooks.json>` + `--permission-mode manual` + fresh worktree cwd → subscription auth, but the target repo's own `.claude/settings.json` hooks/CLAUDE.md still load. Measure whether omnis hooks in `--settings` take precedence and whether project hooks can be neutralized.
>    - claude-ds (DeepSeek, API key) is unaffected: `--bare` is the natural mode.

**Files:**
- Create: `tools/spikes/gate-11-claude-bare-hooks/hooks-settings.json`, `tools/spikes/gate-11-claude-bare-hooks/hook-receiver.mjs`, `tools/spikes/gate-11-claude-bare-hooks/project-hook.mjs`, `tools/spikes/gate-11-claude-bare-hooks/run.sh`.
- Modify: `tools/spikes/gate-11-claude-bare-hooks/result.md`.

**Interfaces:** Consumes: `tools/spikes/_probes/2026-09-20-cli-probes.md` (premise items 1 and 2 above, verbatim). Produces: none.

1. Read the premise above (the premise block) — item 2 in particular ("under `--bare`, only `ANTHROPIC_API_KEY` is read, not OAuth/Keychain") conflicts with A2-D11's assumption that "delegated runs ride the subscription binary as-is", so copy it verbatim into the `result.md` notes independently of this task's execution result (revisiting A2-D11 is out of scope for this plan and is an item to escalate to Logan before Phase A starts).
2. Write `tools/spikes/gate-11-claude-bare-hooks/hook-receiver.mjs` (instead of a Unix socket, this spike proves "the approval gate fired" via stdout — the real Unix socket bridge is built by Phase A's `apps/local-agent`. This is the **omnis's own hook**, the one explicitly injected via `--settings`):

```js
#!/usr/bin/env node
// PreToolUse hook: reads { tool_name, tool_input, ... } JSON from stdin; exiting with code 2 to "block"
// makes Claude Code treat it as requiring approval (the goal is to verify the hook surface itself, so the real bridge socket is only stubbed).
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const evt = JSON.parse(raw);
  console.error(`GATE11_HOOK_FIRED tool=${evt.tool_name}`);
  process.exit(2); // 2 = block + surface reason to the model/user (Claude Code hook contract)
});
```

3. Write `tools/spikes/gate-11-claude-bare-hooks/project-hook.mjs` (mimics a hook the target repo has **as its own** — this is the fixture side that reproduces premise item 2's "fresh worktree cwd with a repo that has its own `.claude/settings.json` hook". It prints a marker distinct from the omnis hook):

```js
#!/usr/bin/env node
// project's own PreToolUse hook (fixture) — a marker separate from the omnis hook, proving only whether the project hook fired.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const evt = JSON.parse(raw);
  console.error(`PROJECT_HOOK_FIRED tool=${evt.tool_name}`);
  process.exit(0); // 0 = allow — proving whether it fired is enough; this hook does not need to block execution
});
```

4. `chmod +x tools/spikes/gate-11-claude-bare-hooks/hook-receiver.mjs tools/spikes/gate-11-claude-bare-hooks/project-hook.mjs`.
5. Write `tools/spikes/gate-11-claude-bare-hooks/hooks-settings.json` (the omnis-side `--settings` injection file; so that it works in both modes without absolute paths, run.sh `cd`s first and passes the script path as a relative one):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node tools/spikes/gate-11-claude-bare-hooks/hook-receiver.mjs" }] }
    ]
  }
}
```

6. Write `tools/spikes/gate-11-claude-bare-hooks/run.sh` (exercise both modes from premise item 2; mode (b) runs in a **fresh worktree cwd** that has a project hook, so the project hook's firing is measured as well):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
REPO_ROOT="$(pwd)"
GATE_DIR="$REPO_ROOT/tools/spikes/gate-11-claude-bare-hooks"

check() {
  local log="$1" label="$2"
  grep -q "GATE11_HOOK_FIRED" "$log" && echo "${label}_omnis_hook_fired=true" || echo "${label}_omnis_hook_fired=false"
  grep -q "PROJECT_HOOK_FIRED" "$log" && echo "${label}_project_hook_fired=true" || echo "${label}_project_hook_fired=false"
}

echo "=== mode (a): --bare + --settings + ANTHROPIC_API_KEY (cwd = repo root, no project fixture) ==="
claude -p --bare \
  --settings "$GATE_DIR/hooks-settings.json" \
  --permission-mode manual \
  "run: ls" 2>&1 | tee "$GATE_DIR/mode-a.log" || true
check "$GATE_DIR/mode-a.log" mode_a

echo "=== fixture: fresh worktree cwd with its own .claude/settings.json project hook ==="
FIXTURE_PARENT="$(mktemp -d)"
FIXTURE_DIR="$FIXTURE_PARENT/gate11-project-fixture"
mkdir -p "$FIXTURE_DIR/.claude"
git init -q "$FIXTURE_DIR"
cp "$GATE_DIR/project-hook.mjs" "$FIXTURE_DIR/.claude/project-hook.mjs"
cat > "$FIXTURE_DIR/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .claude/project-hook.mjs" }] }
    ]
  }
}
JSON

echo "=== mode (b): non-bare + --settings <omnis-hooks.json> + --permission-mode manual, cwd = fixture worktree ==="
(
  cd "$FIXTURE_DIR"
  claude -p \
    --settings "$GATE_DIR/hooks-settings.json" \
    --permission-mode manual \
    "run: ls" 2>&1 | tee "$GATE_DIR/mode-b.log"
) || true
check "$GATE_DIR/mode-b.log" mode_b

rm -rf "$FIXTURE_PARENT"
```

7. Run `chmod +x tools/spikes/gate-11-claude-bare-hooks/run.sh && ./tools/spikes/gate-11-claude-bare-hooks/run.sh`. PASS condition (identical to the pass criteria in item 2): at least one of mode (a)/(b) yields `omnis_hook_fired=true` AND `project_hook_fired=false`. If no mode produces this combination, FAIL → adopt the Fail decision rule (downgrade to polling).
8. Fill in `result.md`: the `omnis_hook_fired`/`project_hook_fired` values for mode (a)/(b) each, which mode satisfied the pass condition, "§19 Q13" in `decided_by`, and the A2-D11 conflict note copied in step 1 in the notes.
9. `git add tools/spikes/gate-11-claude-bare-hooks && git commit -m "$(cat <<'EOF'
gate-11: claude -p --bare hook injection + project hook isolation spike (S-A2-1)

- Inject a PreToolUse hook explicitly via --settings and check whether the approval gate fires in both --bare and non-bare modes
- mode (b) runs in a fresh worktree fixture cwd that has its own .claude/settings.json hook, measuring whether the project hook fires too
- Pass criteria: in at least one mode the omnis hook fires and the project hook does not — record the result as an input to master §19 Q13
- _probes finding (--bare reads no OAuth/Keychain, API key only) → conflicts with the A2-D11 assumption, recorded as needing Logan escalation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 6: Gate ⑫ — `--permission-mode` ↔ profile mapping (S-A2-2, owned by A2 §7.1, tier: Sonnet)

**Question**: Can the full set of actual accepted values for `--permission-mode` be definitively mapped onto the three permission profiles in A2 §7.1 (`observe`/`workspace`/`trusted`)?
**Owner**: agent (unattended).
**Host**: macbook.
**Pass criteria (A6 §11.1 verbatim)**: "3 profiles confirmed".
**Fail → decision rule**: If the values do not split cleanly into the three profiles (e.g. if no mode guarantees true read-only), mark A2 §7.1 as needing an update so that the `observe` profile is enforced separately by network blocking (§7.2, the S-A2-6 fallback) rather than by a CLI flag (this plan does not edit the A2 body — it only records the spike result).

**Files:**
- Modify: `tools/spikes/gate-12-permission-mode-mapping/result.md`.
- Create: `tools/spikes/gate-12-permission-mode-mapping/mapping.md`.

**Interfaces:** Consumes: `tools/spikes/_probes/2026-09-20-cli-probes.md` (`--permission-mode` choices: `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan` — already captured). Produces: none.

1. Read `docs/spec/A2-agent-session-bridge.md` §7.1 (the permission profile table) and item 3 of "Findings ... gate ⑫" in `tools/spikes/_probes/2026-09-20-cli-probes.md`.
2. Run `claude --help 2>&1 | grep -A2 "permission-mode"` to re-confirm that the six values in the `_probes` file (`acceptEdits`/`auto`/`bypassPermissions`/`manual`/`dontAsk`/`plan`) are still the same in the currently installed build (version-drift check).
3. Write `tools/spikes/gate-12-permission-mode-mapping/mapping.md` (the confirmed version of the A2 §7.1 table filled in with the actual CLI values):

```markdown
# Confirmed permission-mode ↔ profile mapping (gate-12, S-A2-2)

| profile (A2 §7.1) | `--permission-mode` | Rationale |
|---|---|---|
| `observe` | `plan` | Read-only planning mode with no file writes or tool execution. For `inbox:*` loops only (A2 §7.1) |
| `workspace` | `manual` | Writes files under cwd; all other tools go through an approval prompt (via hooks, gate-11) |
| `trusted` | `bypassPermissions` | Only with `origin:'human'`, within allowed_roots (A2 §7.1: "bypassPermissions only for trusted+origin:human") |

Unused: `acceptEdits` (auto-approves file edits more loosely than workspace — assigned to no profile; risks bypassing the approval gate), `auto` (delegates to runtime judgment, so it maps deterministically to none of the three profiles), `dontAsk` (overlaps trusted but is less clearly defined than bypassPermissions, so it is excluded).
```

4. Fill in `result.md`: Result = Pass (all three profiles definitively mapped), and leave the `mapping.md` path in the measurements field.
5. `git add tools/spikes/gate-12-permission-mode-mapping && git commit -m "$(cat <<'EOF'
gate-12: confirmed --permission-mode ↔ permission profile mapping (S-A2-2)

- Confirmed observe→plan, workspace→manual, trusted→bypassPermissions
- acceptEdits/auto/dontAsk left unused (rationale in mapping.md)
- Pass criteria: 3 profiles confirmed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 7: Gate ⑬ — Zero replication of vector/tsvector/uuid[]/generated columns (S-A3-2, owned by A3 §7/§14, tier: Sonnet)

**Question**: When a table mixing `vector`, `tsvector` (generated) and `uuid[]` columns is put into a publication, does Zero replicate it correctly and can the client query it — and if not, how must `items.search_tsv` be excluded?
**Owner**: agent (unattended).
**Host**: macbook (the same local Zero+Postgres stack as Task 2 could be reused, but a separate scratch DB is used so it runs independently).
**Pass criteria (A6 §11.1 verbatim)**: "replication + query succeed".
**Fail → decision rule (A3 §14 S-A3-2 verbatim)**: "move `search_tsv` into a separate table and normalize `participants` into a join table".

**Files:**
- Create: `tools/spikes/gate-13-zero-column-types/setup.sql`, `tools/spikes/gate-13-zero-column-types/schema.ts`, `tools/spikes/gate-13-zero-column-types/measure.ts`.
- Modify: `tools/spikes/gate-13-zero-column-types/result.md`.

**Interfaces:** Consumes: `@rocicorp/zero` (npm). Produces: none.

1. Read `docs/spec/A3-data-schema.md` §7 (Zero sync scope) and §14 S-A3-2/S-A3-6 — the columns actually at issue are `items.embedding vector(768)` (excluded, so no need to test it here), `items.search_tsv` (generated tsvector; excluded, but "does the exclusion really work" must be tested), and `threads.participants uuid[]` (included; whether it really replicates must be tested).
2. Write `tools/spikes/gate-13-zero-column-types/setup.sql` (rather than replicating the real tables from A3 §2/§3, create two minimal reproduction tables carrying only the three problem column types):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE probe_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participants uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE probe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES probe_threads(id),
  body text NOT NULL,
  embedding vector(768),
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);

ALTER SYSTEM SET wal_level = 'logical';

-- Put only the items side into the publication with a column list (the same pattern as the A3 §7 DDL):
CREATE PUBLICATION zero_spike_13 FOR TABLE
  probe_threads,
  probe_items (id, thread_id, body);
```

3. Run `createdb omnis_spike_zero13 && psql omnis_spike_zero13 -f setup.sql && brew services restart postgresql@17`.
4. Write `tools/spikes/gate-13-zero-column-types/schema.ts` (declare the uuid[] column and only `probe_items` narrowed by a column list — `embedding`/`search_tsv` are not put into the schema at all. The Zero client schema itself must match the publication, so this is the first check of "does the exclusion really work"):

```ts
import { createSchema, table, string, json } from "@rocicorp/zero";

export const probeThreads = table("probe_threads")
  .columns({ id: string(), participants: json<string[]>() })
  .primaryKey("id");

export const probeItems = table("probe_items")
  .columns({ id: string(), threadId: string(), body: string() })
  .primaryKey("id");

export const schema = createSchema({ tables: [probeThreads, probeItems] });
```

5. Bring up zero-cache with `ZERO_UPSTREAM_DB=postgres://localhost/omnis_spike_zero13 ZERO_CVR_DB=postgres://localhost/omnis_spike_zero13 ZERO_REPLICA_FILE=/tmp/omnis-spike-zero13.db npx zero-cache-dev -p schema.ts`. If this command rejects the schema (e.g. zero-cache does not recognize the `uuid[]` → `json<string[]>()` mapping), copy the console error message verbatim into `result.md` — that is this spike's primary artifact.
6. Write `tools/spikes/gate-13-zero-column-types/measure.ts`:

```ts
import { Zero } from "@rocicorp/zero";
import { schema } from "./schema.js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const z = new Zero({ server: "http://127.0.0.1:4848", userID: "spike13", schema });
const threadId = randomUUID();
const p1 = randomUUID();
const p2 = randomUUID();

execSync(
  `psql omnis_spike_zero13 -c "INSERT INTO probe_threads (id, participants) VALUES ('${threadId}', ARRAY['${p1}','${p2}']::uuid[])"`,
);
execSync(
  `psql omnis_spike_zero13 -c "INSERT INTO probe_items (id, thread_id, body) VALUES (gen_random_uuid(), '${threadId}', 'hello from gate 13')"`,
);

const thread = await z.query.probeThreads.where("id", "=", threadId).one().materialize().data;
const items = await z.query.probeItems.where("threadId", "=", threadId).materialize().data;

console.log("thread:", JSON.stringify(thread));
console.log("items:", JSON.stringify(items));
const pass = Array.isArray(thread?.participants) && thread.participants.length === 2 && items.length === 1;
console.log(`gate13_pass=${pass}`);
process.exit(pass ? 0 : 1);
```

7. Run `cd tools/spikes/gate-13-zero-column-types && pnpm add @rocicorp/zero pg && npx tsx measure.ts`. PASS condition: `gate13_pass=true` (uuid[] replicates as an array, and querying `probe_items` works even without `embedding`/`search_tsv` in the schema).
8. Fill in `result.md`: record separately whether `uuid[]` replicated successfully and whether the publication column-list syntax (`items (id, thread_id, ...)`) was actually accepted by zero-cache.
9. `git add tools/spikes/gate-13-zero-column-types && git commit -m "$(cat <<'EOF'
gate-13: spike on Zero's handling of vector/tsvector/uuid[]/generated columns (S-A3-2)

- Confirm replication and querying of a uuid[] column (reproducing threads.participants)
- Verify the syntax that excludes generated tsvector/vector columns via a publication column list (S-A3-6)
- Pass criteria: replication + query succeed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 8: Gate ⑭ — worktrunk dry run (A7-1, owned by A7 §3, tier: Sonnet)

**Question**: Does a worktree create/remove round trip actually work with `worktrunk` (the exact subcommands and flags are what A7-D5 left UNVERIFIED)?
**Owner**: agent (unattended).
**Host**: macbook (`worktrunk` 0.78.0 is already installed, `_probes` file).
**Pass criteria (A6 §11.1 verbatim)**: "create/remove round trip".
**Fail → decision rule**: The fallback A7-D5 already specified — downgrade from worktrunk to plain `git worktree add`/`git worktree remove` and mark the ralph loop's worktree isolation procedure (A7 §3) as needing a rewrite around those commands (this plan does not edit the A7 body).

**Files:**
- Create: `tools/spikes/gate-14-worktrunk-dryrun/run.sh`.
- Modify: `tools/spikes/gate-14-worktrunk-dryrun/result.md`.

**Interfaces:** Consumes: `tools/spikes/_probes/2026-09-20-cli-probes.md` (confirming worktrunk 0.78.0 is installed). Produces: none.

1. Read the "worktrunk worktree isolation procedure" paragraph in `docs/spec/A7-dev-process.md` §3 — the default assumption is `worktrunk create <branch>` / `worktrunk remove <story-id>`.
2. Write `tools/spikes/gate-14-worktrunk-dryrun/run.sh` (dry-run against a scratch repo, not the omnis repo itself — the real working branch is never touched):

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRATCH=$(mktemp -d)
git init -q "$SCRATCH"
cd "$SCRATCH"
git commit -q --allow-empty -m "init"

echo "=== worktrunk --help ==="
worktrunk --help

echo "=== create ==="
worktrunk create ralph/gate-14-dryrun
test -d "$SCRATCH/.worktrees/gate-14-dryrun" \
  && echo "create_pass=true" || echo "create_pass=false"

echo "=== remove ==="
worktrunk remove gate-14-dryrun
test ! -d "$SCRATCH/.worktrees/gate-14-dryrun" \
  && echo "remove_pass=true" || echo "remove_pass=false"

rm -rf "$SCRATCH"
```

3. Run `chmod +x tools/spikes/gate-14-worktrunk-dryrun/run.sh && ./tools/spikes/gate-14-worktrunk-dryrun/run.sh 2>&1 | tee tools/spikes/gate-14-worktrunk-dryrun/run.log`. If `worktrunk create`/`worktrunk remove` use subcommands or paths different from A7-D5's assumption (e.g. the worktree lands somewhere other than `.worktrees/`), read the `--help` output, fix the `test -d` paths in the script to the real paths, and re-run.
4. PASS condition: both `create_pass=true` and `remove_pass=true`.
5. Fill in `result.md`: record the exact command form actually confirmed (whether it is literally `worktrunk create <branch>` or takes flags) in the measurements field — Task 16 (worktrunk-cli-spike) inherits this value as-is.
6. `git add tools/spikes/gate-14-worktrunk-dryrun && git commit -m "$(cat <<'EOF'
gate-14: worktrunk create/remove dry run (A7-1)

- Confirm the worktrunk create ralph/<id> → remove <id> round trip against a scratch repo
- Pass criteria: create/remove round trip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

---

## Order B — Logan-assisted gates (require physical intervention, OAuth consent, GUI permission approval)

### Task 9: Gate ③ — automatic login with FileVault on (owned by A6, tier: Sonnet)

**Question**: With FileVault enabled on the mini, does automatic login happen after a reboot with no intervention?
**Owner**: Logan — manipulating the mini's local login screen (setting automatic login, checking the FileVault recovery key, watching the reboot) has a window where Screen Sharing cannot show the screen right after a reboot, so on-site verification is best. Fable only guides the procedure and does the follow-up check over Screen Sharing (`vnc://<mini-hostname>.ts.net`).
**Host**: mini.
**Pass criteria (A6 §11.3 verbatim)**: "reach a login session after reboot with no manual intervention".
**Fail → decision rule (A6 §11.3/A6-D2 verbatim)**: "FileVault OFF + tailnet-only exposure + compensating physical security; Logan's approval required".
**Ordering rule (A6-D2/§11.1)**: Run this spike before §2 item 1 (setting up automatic login) — whether FileVault is on affects the automatic login setting itself.

**Files:**
- Create: `tools/spikes/gate-03-filevault-autologin/checklist.md`.
- Modify: `tools/spikes/gate-03-filevault-autologin/result.md`.

**Interfaces:** Consumes: none (a pure OS-configuration procedure, no code). Produces: none.

1. Read `docs/spec/A6-ops-infra.md` §2 (the mini OS setup procedure, item 8 in particular) and the ③ row of §11.3.
2. Write `tools/spikes/gate-03-filevault-autologin/checklist.md` (a checklist Logan follows verbatim in front of the mini — the deliverable is the procedure, not code):

```markdown
# Gate ③ checklist — FileVault ON + automatic login (mini, Logan on site)

1. System Settings → Privacy & Security → FileVault → Turn On FileVault. Store the recovery key somewhere safe (a password manager).
2. If prompted to restart, restart and wait until disk encryption finishes (progress can be checked with `fdesetup status`).
3. System Settings → Users & Groups → Automatic login → try setting it to the `logan` account.
4. If it configures successfully (i.e. the option is not blocked even with FileVault ON), reboot the mini.
5. Right after the reboot, **visually confirm with your own eyes** that the GUI session (desktop) is reached directly without a login screen — Screen Sharing can only show the screen after login, so this step must be verified physically.
6. Repeat steps 4–5 twice in total to confirm reproducibility (it may differ between boots).
```

3. Wait while Logan runs the checklist above, and once the completion report comes back, write the run date, Pass/Fail, and decided_by (`Logan`) into `result.md`.
4. On Fail, note in the `result.md` notes that A6-D2 requires turning FileVault OFF immediately and narrowing the Tailscale ACL in §3 (network) to tailnet-only (no Funnel) as follow-up work, and obtain and record Logan's explicit approval wording for that transition itself (without approval, no task in this plan turns FileVault off on its own).
5. `git add tools/spikes/gate-03-filevault-autologin && git commit -m "$(cat <<'EOF'
gate-03: FileVault + automatic login spike checklist and result (Logan on site)

- Pass criteria: reach a GUI session after reboot with no intervention
- On Fail, per A6-D2: FileVault OFF + tailnet-only + Logan's approval

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 10: Gate ④ — kmsg read on the mini (A1-③, owned by A1 §4, tier: Sonnet)

**Question**: Does `kmsg watch --json` on the mini emit KakaoTalk messages as well-formed JSON events for 48 consecutive hours while re-requesting Accessibility permission zero times?
**Owner**: Logan — the Accessibility permission prompt (System Settings → Privacy & Security → Accessibility) requires a GUI click and can be done over Screen Sharing, but the initial approval requires physical or remote GUI manipulation.
**Host**: mini.
**Pass criteria (A1 §4 verbatim)**: "recent messages appear correctly in the JSON, KakaoTalk.app does not lose focus" / A6 §11.1 summary: "48h continuous, 0 permission re-requests".
**Fail → decision rule (A1 §4 verbatim)**: "switch to the Notification Center DB + Vision OCR fallback design and report the delay in starting KakaoTalk read to Logan".

**Files:**
- Create: `tools/spikes/gate-04-kmsg-read/run.sh`, `tools/spikes/gate-04-kmsg-read/watch-48h.sh`.
- Modify: `tools/spikes/gate-04-kmsg-read/result.md`.

**Interfaces:** Consumes: none (only the kmsg CLI). Produces: none.

1. Read `docs/spec/A1-channel-adapters.md` §4 (the A1-③ row) and §2.8 (the KakaoTalk section).
2. Write `tools/spikes/gate-04-kmsg-read/run.sh` (install + verify one read, run by Logan on the mini):

```bash
#!/usr/bin/env bash
set -euo pipefail
brew install channprj/tap/kmsg
kmsg chats --json | tee tools/spikes/gate-04-kmsg-read/chats.json
CHAT_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('tools/spikes/gate-04-kmsg-read/chats.json','utf8'))[0].id)")
kmsg read "$CHAT_ID" --background-safe --json | tee tools/spikes/gate-04-kmsg-read/first-read.json
```

3. Write `tools/spikes/gate-04-kmsg-read/watch-48h.sh` (log collection for the 48-hour observation — run in the background, then aggregate event counts and errors):

```bash
#!/usr/bin/env bash
set -euo pipefail
LOG=tools/spikes/gate-04-kmsg-read/watch-48h.ndjson
kmsg watch --json > "$LOG" 2>tools/spikes/gate-04-kmsg-read/watch-48h.err &
echo $! > tools/spikes/gate-04-kmsg-read/watch.pid
echo "started, pid=$(cat tools/spikes/gate-04-kmsg-read/watch.pid), log=$LOG"
```

4. Logan runs `run.sh` on the mini and clicks Allow on the Accessibility permission prompt in System Settings (once). Then run `watch-48h.sh` and leave it running in the background for 48 hours.
5. After 48 hours, Logan (or Fable over Screen Sharing) checks `wc -l tools/spikes/gate-04-kmsg-read/watch-48h.ndjson` and `cat tools/spikes/gate-04-kmsg-read/watch-48h.err`. PASS condition: the `.err` file contains no permission re-request errors (`grep -i "accessibility\|permission" watch-48h.err` returns nothing) and the `.ndjson` contains at least one real message event.
6. Fill in `result.md`: the 48-hour start/end timestamps, the total event count, and the permission re-request count (target 0).
7. `git add tools/spikes/gate-04-kmsg-read && git commit -m "$(cat <<'EOF'
gate-04: kmsg read on the mini, 48-hour observation spike (A1-③, Logan on site)

- Observe kmsg watch --json in the background for 48 hours, counting Accessibility permission re-requests
- Pass criteria: 48h continuous, 0 permission re-requests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 11: Gate ⑤ — Tailscale Serve HTTPS from iPhone Safari (owned by A6, tier: Sonnet)

**Question**: When connecting to `<mini-hostname>.ts.net` from iPhone Safari, does the page load with no SSL error?
**Owner**: Logan — testing Safari on a physical iPhone requires hands-on manipulation.
**Host**: mini (serving) + iPhone (test client).
**Pass criteria (A6 §11.3 verbatim)**: "page loads with no SSL error".
**Fail → decision rule (A6 §11.3 verbatim)**: "re-check the MagicDNS name → if it still fails, move TailscaleKit validation forward into Phase D".

**Files:**
- Create: `tools/spikes/gate-05-tailscale-serve-iphone/setup.sh`, `tools/spikes/gate-05-tailscale-serve-iphone/checklist.md`.
- Modify: `tools/spikes/gate-05-tailscale-serve-iphone/result.md`.

**Interfaces:** Consumes: none. Produces: none.

1. Read `docs/spec/A6-ops-infra.md` §3 (the network section: Tailscale Serve, MagicDNS, Funnel) and the ⑤ row of §11.3.
2. Write `tools/spikes/gate-05-tailscale-serve-iphone/setup.sh` (expose a minimal static page via Serve on the mini — `apps/web` does not exist yet, so `python3 -m http.server` stands in for it):

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/omnis-spike-05 && echo "<h1>omnis gate-05 ok</h1>" > /tmp/omnis-spike-05/index.html
(cd /tmp/omnis-spike-05 && python3 -m http.server 5173 &)
sudo tailscale serve --bg --https=443 / localhost:5173/
echo "serve status:"
tailscale serve status
```

3. Write `tools/spikes/gate-05-tailscale-serve-iphone/checklist.md`:

```markdown
# Gate ⑤ checklist — Tailscale Serve HTTPS @ iPhone Safari (Logan)

1. Run `setup.sh` on the mini (the command above; Fable can run it instead over Screen Sharing — it is a CLI step needing no GUI permissions, so it can be delegated unattended. Only the iPhone-side check is Logan's).
2. On the iPhone, check Settings → installed profiles/VPN: if a DoH (DNS-over-HTTPS) app or a private-DNS profile is present, turn it off temporarily (a known cause noted in A6 §3).
3. Open `https://<mini-hostname>.ts.net` in iPhone Safari.
4. Confirm the "omnis gate-05 ok" page appears with no SSL warning.
5. If step 3 fails, re-check that MagicDNS is enabled (Tailscale app → Settings) and retry.
```

4. Logan performs steps 3–5 on the iPhone and reports the result, then fill in `result.md`: whether there was an SSL error, whether a DoH app was present, and whether a retry was needed.
5. After the spike ends, tear down the temporary static-server exposure with `sudo tailscale serve --https=443 off` (or `tailscale serve reset`) — this spike stubbed the path rather than using Zero/hub's real one, so it is not left running permanently.
6. `git add tools/spikes/gate-05-tailscale-serve-iphone && git commit -m "$(cat <<'EOF'
gate-05: Tailscale Serve HTTPS @ iPhone Safari spike (Logan verification)

- Expose a temporary static page via Serve on the mini and check that it loads in iPhone Safari with no SSL error
- Pass criteria: 0 SSL errors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 12: Gate ⑨ — Slack Socket Mode one-turn round trip (A1-④, owned by A1 §4, tier: Sonnet)

**Question**: After creating a Slack app in Socket Mode and connecting over WS, does sending a test DM yield an event within 5 seconds (G1)?
**Owner**: Logan — creating and installing a new app in the Slack workspace (admin approval) must be done in the Slack UI under Logan's account.
**Host**: macbook (the Socket Mode WS client needs no GUI, so receipt is verified on the development machine).
**Pass criteria (A1 §4 verbatim)**: "event received within 5 seconds (G1)".
**Fail → decision rule (A1 §4 verbatim)**: "consider the Events API alternative (public endpoint, via Funnel) — Phase A may slip".

**Files:**
- Create: `tools/spikes/gate-09-slack-socket-mode/manifest.yaml`, `tools/spikes/gate-09-slack-socket-mode/listen.ts`, `tools/spikes/gate-09-slack-socket-mode/checklist.md`.
- Modify: `tools/spikes/gate-09-slack-socket-mode/result.md`.

**Interfaces:** Consumes: `@slack/socket-mode` (npm, Slack's official SDK — this keeps the constraint that provider SDKs are used only inside A1 channel spikes). Produces: none.

1. Read `docs/spec/A1-channel-adapters.md` §2.1 (Slack) and §4 (the A1-④ row).
2. Write `tools/spikes/gate-09-slack-socket-mode/manifest.yaml` (a Slack app manifest; Logan pastes it verbatim at api.slack.com/apps → Create from manifest):

```yaml
display_information:
  name: omnis-spike-gate-09
features:
  bot_user:
    display_name: omnis-spike
oauth_config:
  scopes:
    bot: ["channels:history", "chat:write", "im:history"]
settings:
  socket_mode_enabled: true
  event_subscriptions:
    bot_events: ["message.channels", "message.im"]
```

3. Write `tools/spikes/gate-09-slack-socket-mode/checklist.md`:

```markdown
# Gate ⑨ checklist (Logan)

1. https://api.slack.com/apps → Create New App → From an app manifest → paste `manifest.yaml`.
2. Install it into the workspace under OAuth & Permissions (admin approval) and obtain the `xoxb-...` token.
3. Issue an `xapp-...` token with the `connections:write` scope under Basic Information → App-Level Tokens.
4. Store both tokens in the Keychain as `security add-generic-password -s omnis.slack.xoxb.gate09 -a omnis -w '<xoxb>'` and `omnis.slack.xapp.gate09` (A1 naming rule; this is not a production app reused later — a spike-only throwaway app).
5. After running `listen.ts`, send one test message from any DM channel.
```

4. Write `tools/spikes/gate-09-slack-socket-mode/listen.ts`:

```ts
import { SocketModeClient } from "@slack/socket-mode";
import { execSync } from "node:child_process";

const appToken = execSync(
  "security find-generic-password -s omnis.slack.xapp.gate09 -a omnis -w",
).toString().trim();

const client = new SocketModeClient({ appToken });

client.on("message", ({ event, ack }) => {
  const t = Date.now();
  console.log(`received_at_ms=${t} text=${JSON.stringify(event.text)}`);
  ack();
});

await client.start();
console.log("socket mode connected, waiting for a test DM...");
setTimeout(() => process.exit(0), 60000);
```

5. With `cd tools/spikes/gate-09-slack-socket-mode && pnpm add @slack/socket-mode && npx tsx listen.ts` running, Logan sends a test DM. Compare the difference between the `received_at_ms` printed to the console and the message send time (the timestamp shown in the Slack client) against the 5-second criterion.
6. Fill in `result.md`.
7. `git add tools/spikes/gate-09-slack-socket-mode && git commit -m "$(cat <<'EOF'
gate-09: Slack Socket Mode one-turn round-trip spike (A1-④, Logan installs the app)

- Measure test-DM receipt latency after connecting over Socket Mode WS
- Pass criteria: event received within 5 seconds (G1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 13: Gate ⑩ — Gmail watch + Pub/Sub pull round trip (A1-⑤, owned by A1 §4, tier: Sonnet)

**Question**: After wiring Gmail push into Pub/Sub via `users.watch()`, is the `historyId` actually received on the pull subscription after a test email is sent?
**Owner**: Logan — creating the Google Cloud project, linking billing, and approving the OAuth consent screen must be done under Logan's account.
**Host**: macbook.
**Pass criteria (A1 §4 verbatim)**: "`historyId` received on the pull subscription".
**Fail → decision rule (A1 §4 verbatim)**: "fall back to 1-minute `history.list` polling (the path §2.2 already lists as the fallback; no loss of functionality)".

**Files:**
- Create: `tools/spikes/gate-10-gmail-watch-pubsub/checklist.md`, `tools/spikes/gate-10-gmail-watch-pubsub/watch-and-pull.ts`.
- Modify: `tools/spikes/gate-10-gmail-watch-pubsub/result.md`.

**Interfaces:** Consumes: `googleapis` (npm, `google-auth-library`). Produces: none.

1. Read `docs/spec/A1-channel-adapters.md` §2.2 (Gmail) and §4 (the A1-⑤ row).
2. Write `tools/spikes/gate-10-gmail-watch-pubsub/checklist.md`:

```markdown
# Gate ⑩ checklist (Logan)

1. `gcloud pubsub topics create omnis-gmail-spike`
2. `gcloud pubsub subscriptions create omnis-gmail-spike-sub --topic omnis-gmail-spike`
3. Do the one-time browser consent for Gmail API OAuth (Logan's account, gmail.readonly scope) → save the token to `~/.omnis-spike/gmail-token.json` (a spike-only temporary path, unrelated to the production Keychain rules).
4. Grant the Gmail push publishing permission on the Pub/Sub topic: `gcloud pubsub topics add-iam-policy-binding omnis-gmail-spike --member=serviceAccount:gmail-api-push@system.gserviceaccount.com --role=roles/pubsub.publisher`
```

3. Write `tools/spikes/gate-10-gmail-watch-pubsub/watch-and-pull.ts`:

```ts
import { google } from "googleapis";
import { readFileSync } from "node:fs";

const token = JSON.parse(readFileSync(`${process.env.HOME}/.omnis-spike/gmail-token.json`, "utf8"));
const auth = new google.auth.OAuth2();
auth.setCredentials(token);
const gmail = google.gmail({ version: "v1", auth });
const pubsub = google.pubsub({ version: "v1", auth });

const watchRes = await gmail.users.watch({
  userId: "me",
  requestBody: { topicName: "projects/<PROJECT_ID>/topics/omnis-gmail-spike" },
});
console.log("watch historyId:", watchRes.data.historyId);
console.log("Now send one test email to this Gmail address from any account...");

const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  const pull = await pubsub.projects.subscriptions.pull({
    subscription: "projects/<PROJECT_ID>/subscriptions/omnis-gmail-spike-sub",
    requestBody: { maxMessages: 1 },
  });
  const msg = pull.data.receivedMessages?.[0];
  if (msg) {
    const decoded = Buffer.from(msg.message!.data!, "base64").toString("utf8");
    console.log(`received historyId payload: ${decoded}`);
    console.log("gate10_pass=true");
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log("gate10_pass=false (timeout)");
process.exit(1);
```

4. Replace `<PROJECT_ID>` with Logan's actual GCP project ID, then with `cd tools/spikes/gate-10-gmail-watch-pubsub && pnpm add googleapis && npx tsx watch-and-pull.ts` running, Logan sends a test email.
5. Fill in `result.md`: the initial `historyId` returned by `watch()`, the payload received via pull, and the round-trip duration.
6. `git add tools/spikes/gate-10-gmail-watch-pubsub && git commit -m "$(cat <<'EOF'
gate-10: Gmail watch + Pub/Sub pull round-trip spike (A1-⑤, Logan's OAuth consent)

- Register users.watch(), send a test email, and confirm historyId receipt on the pull subscription
- Pass criteria: historyId received on the pull subscription

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 14: Gate ① — Calendar `events.watch` via Funnel (owned by A6, tier: Sonnet)

**Question**: After registering a Google Calendar `events.watch` against a webhook URL exposed via Tailscale Funnel, does a notification arrive within 1 minute of a real calendar change?
**Owner**: Logan — the Calendar API OAuth consent (access to Logan's calendar) and the decision to open/close Funnel (public internet exposure, an exception to A6 §3's "in principle, don't use it" policy) are finally confirmed by Logan. Fable prepares the commands and can run them together over Screen Sharing.
**Host**: mini (Funnel is opened on the mini where the hub will be deployed, A6 §3).
**Pass criteria (A6 §11.3 verbatim)**: "the webhook arrives within 1 minute of an event change".
**Fail → decision rule (A6 §11.3 verbatim)**: "`events.list` + syncToken polling every 1–5 minutes (already listed as the default path in master §8)".

**Files:**
- Create: `tools/spikes/gate-01-calendar-funnel/checklist.md`, `tools/spikes/gate-01-calendar-funnel/webhook-receiver.ts`.
- Modify: `tools/spikes/gate-01-calendar-funnel/result.md` (update the defaults Task 1 pre-filled with the real results).

**Interfaces:** Consumes: `googleapis` (npm). Produces: none.

1. Read `docs/spec/A6-ops-infra.md` §3 (the Funnel paragraph) and the ① row of §11.3, plus `docs/spec/A1-channel-adapters.md` §4 (the A1-① row).
2. Write `tools/spikes/gate-01-calendar-funnel/webhook-receiver.ts` (Google sends the `validationToken` handshake and subsequent POST notifications to this endpoint):

```ts
import { createServer } from "node:http";

const server = createServer((req, res) => {
  const t = new Date().toISOString();
  console.log(`[${t}] ${req.method} ${req.url}`);
  console.log("headers:", JSON.stringify(req.headers));
  res.writeHead(200).end("ok");
});

server.listen(8788, () => console.log("gate-01 webhook receiver on :8788"));
```

3. Write `tools/spikes/gate-01-calendar-funnel/checklist.md`:

```markdown
# Gate ① checklist (mini, Logan verification)

1. Start the receiver on local port 8788 with `npx tsx tools/spikes/gate-01-calendar-funnel/webhook-receiver.ts &`.
2. Open Funnel with `sudo tailscale funnel --bg 443 8788` (in principle never left on permanently — only for the duration of this spike).
3. Do the one-time OAuth consent for the Google Calendar API (Logan's calendar, calendar scope).
4. Call `POST https://www.googleapis.com/calendar/v3/calendars/primary/events/watch` with `{ id: <uuid>, type: "web_hook", address: "https://<mini-hostname>.ts.net" }` (Funnel forwards 443 to 8788, so address is the tailnet domain root).
5. Modify or create any event in Google Calendar.
6. Confirm a POST request appears in the webhook receiver log within 1 minute.
7. **As soon as the spike ends (pass or fail), turn Funnel off with `sudo tailscale funnel 443 off`.**
```

4. Logan runs it and reports the result; then update `result.md`.
5. `git add tools/spikes/gate-01-calendar-funnel && git commit -m "$(cat <<'EOF'
gate-01: Calendar events.watch via Funnel spike (A6 §11.3, Logan's OAuth consent)

- Register events.watch against a Funnel-exposed webhook and measure notification arrival time after a calendar change
- Pass criteria: the webhook arrives within 1 minute of an event change
- Turn Funnel off after the spike ends (A6 §3 "in principle, don't use it")

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 15: Gate ② — Beeper token issuance + WhatsApp secondary-number send (owned by A6, tier: Sonnet)

**Question**: After QR-pairing a secondary number with Beeper Desktop, can a token be obtained from the local REST API and a test message sent — and is there no account-sanction signal within 24 hours?
**Owner**: Logan — installing Beeper Desktop and QR pairing (scanning the QR with the physical/secondary phone holding the secondary number) is entirely hands-on work.
**Host**: mini (per the master topology: the Beeper Desktop LaunchAgent runs on the mini).
**Pass criteria (A6 §11.3 verbatim)**: "token issued successfully + send succeeded + no account-sanction signal within 24 hours".
**Fail → decision rule (A6 §11.3/master D4 verbatim)**: "the whatsmeow Go sidecar (master D4 fallback)".

**Files:**
- Create: `tools/spikes/gate-02-beeper-whatsapp/checklist.md`, `tools/spikes/gate-02-beeper-whatsapp/send-test.ts`.
- Modify: `tools/spikes/gate-02-beeper-whatsapp/result.md`.

**Interfaces:** Consumes: none (the Beeper local REST API is called directly with `fetch`; no provider SDK). Produces: none.

1. Read `docs/spec/A1-channel-adapters.md` §2.6 (WhatsApp — Beeper) and §4 (the A1-② row), plus `docs/spec/00-omnis-design.md` §19 Q2 ("secondary-number pilot first").
2. Write `tools/spikes/gate-02-beeper-whatsapp/checklist.md`:

```markdown
# Gate ② checklist (mini, Logan on site)

1. Install Beeper Desktop on the mini and QR-pair the WhatsApp secondary number (the Q2 default — not a number in real use).
2. Issue a local REST API token under Beeper Settings → Integrations.
3. Store it in the Keychain with `security add-generic-password -s omnis.beeper.token -a omnis -w '<token>'` (A6 §9 naming rule).
4. Send one message with `send-test.ts` to the secondary number itself or to a test counterpart.
5. Watch for 24 hours whether the secondary-number account keeps working normally (no logout, no warning messages).
```

3. Write `tools/spikes/gate-02-beeper-whatsapp/send-test.ts`:

```ts
import { execSync } from "node:child_process";

const token = execSync(
  "security find-generic-password -s omnis.beeper.token -a omnis -w",
).toString().trim();

const chatID = process.argv[2];
if (!chatID) throw new Error("usage: tsx send-test.ts <chatID>");

const res = await fetch(`http://127.0.0.1:23373/v1/chats/${chatID}/messages`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ text: "omnis gate-02 spike test message" }),
});

console.log(`status=${res.status}`);
console.log(await res.text());
process.exit(res.ok ? 0 : 1);
```

4. Logan follows the checklist and runs `npx tsx tools/spikes/gate-02-beeper-whatsapp/send-test.ts <chatID>`. PASS condition: `status=200` and receipt confirmed on the other device.
5. After 24 hours, re-check the account state and fill `result.md` with whether the token was issued, whether the send succeeded, and whether there was any sanction signal after 24 hours.
6. `git add tools/spikes/gate-02-beeper-whatsapp && git commit -m "$(cat <<'EOF'
gate-02: Beeper token issuance + WhatsApp secondary-number send spike (Logan QR pairing)

- Send one test message from the secondary number via the Beeper local REST API and watch the account state for 24 hours
- Pass criteria: token issued successfully + send succeeded + no account-sanction signal within 24 hours

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

---

## Order C — A7-D4/A7-D5 self-spikes (2 additional spikes beyond the 14 gates)

### Task 16: Document the confirmed worktrunk CLI procedure (A7-D5 self-spike, tier: Sonnet)

**Question**: What is the exact worktrunk command form (including flags) the ralph loop will actually run per story — carry the dry-run PASS result of Task 8 (gate-14) over into a confirmed procedure the ralph loop can reuse as-is.
**Owner**: agent (unattended) — a follow-up task documenting a result Task 8 already obtained without physical or OAuth intervention, so no human involvement is needed.
**Host**: macbook.
**Pass criteria**: One document of confirmed command forms (`confirmed-usage.md`) that the "worktrunk worktree isolation procedure" paragraph in A7 §3 can reference, matching Task 8's `result.md`.
**Fail → decision rule**: If Task 8 fails, do not run this task (there is nothing to confirm without the prerequisite) — instead record the `git worktree add`/`git worktree remove` fallback commands from A7 §3 in `confirmed-usage.md`.

**Files:**
- Create: `tools/spikes/worktrunk-cli/confirmed-usage.md`.
- Test: none (a documentation task; consistency with `tools/spikes/gate-14-worktrunk-dryrun/result.md` is checked with a shell command).

**Interfaces:** Consumes: `tools/spikes/gate-14-worktrunk-dryrun/result.md` (Task 8's artifact — an earlier task in this plan). Produces: none.

1. Read `tools/spikes/gate-14-worktrunk-dryrun/result.md` and `run.log`.
2. `mkdir -p tools/spikes/worktrunk-cli`.
3. Write `tools/spikes/worktrunk-cli/confirmed-usage.md` (carry over the exact command form actually observed in Task 8 — the default documentation assuming Task 8 passed exactly as A7-D5 assumes; if it failed, replace with the alternative form in item 2):

```markdown
# Confirmed worktrunk usage (A7-D5, based on the gate-14 dry run)

- Create a worktree: `worktrunk create ralph/<story-id>` → created at `omnis/.worktrees/<story-id>` (confirmed by gate-14).
- Remove a worktree: `worktrunk remove <story-id>`.
- The "immediately before starting a story" step of the ralph loop (A7 §3) uses these two commands as-is. This document resolves A7-D5's "UNVERIFIED — spike" marker.
- Reproduction evidence: `tools/spikes/gate-14-worktrunk-dryrun/result.md`, `run.log`.
```

4. Confirm consistency with Task 8's result via `grep -q "Pass" tools/spikes/gate-14-worktrunk-dryrun/result.md && echo "gate14_was_pass=true" || echo "gate14_was_pass=false"` (if Task 8 failed, rewrite the item-3 document in the form `git worktree add <path> -b ralph/<story-id>` / `git worktree remove <path>`).
5. `git add tools/spikes/worktrunk-cli && git commit -m "$(cat <<'EOF'
worktrunk-cli-spike: document the confirmed A7-D5 worktrunk CLI procedure

- Turn the gate-14 dry-run result into confirmed-usage.md for the ralph loop to reference
- Resolve A7-D5's "UNVERIFIED — spike" marker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 17: Half-day spike on the Tauri UI testing tool (A7-D4/A7-2, tier: Sonnet)

**Scope (M14, `2026-09-20-plans-review.md` §1)**: The component-level testing tool is already settled by `2026-09-20-phase-a-desktop.md` as vitest + `@testing-library/react` + jsdom (see that plan's `packages/ui/vitest.config.ts`, `apps/desktop/vitest.config.ts`, and the `@testing-library/react` dependency) — this task does not revisit that decision. Task 17 answers exactly one question: **e2e smoke** (a test that vitest+jsdom cannot produce — launching the actually built Tauri binary and clicking with a real WebDriver), and it only confirms whether `tauri-driver` makes that possible.
**Question**: Can the `tauri-driver` + WebdriverIO combination actually run an e2e UI smoke against a Tauri 2 app (against the built binary — not a component-level test) (validating A7-D4's "UNVERIFIED — spike" default assumption)?
**Owner**: agent (unattended) — building and testing against a local scratch Tauri app needs no GUI clicks or OAuth (a window does appear, but the WebDriver drives it automatically).
**Host**: macbook.
**Pass criteria (A7-D4 verbatim)**: No explicit numbers — the goal is "confirmation". This task takes "a `tauri-driver` session opens and WebdriverIO lands one button click in the scratch app" as its pass criteria (the minimum unit of confirmation A7-D4 asks for).
**Fail → decision rule (M14 revision)**: If `tauri-driver` cannot open a session (a known risk — Tauri's WebDriver path centers on Linux (WebKitWebDriver)/Windows (msedgedriver) with no official macOS support), replace the e2e smoke with **Playwright against the web build** (serve the pure web bundle from `vite build` of `apps/desktop` without the Tauri runtime and drive it with Playwright — a task after US-A25 writes this script). Component-level tests keep using vitest+RTL+jsdom (`phase-a-desktop.md`) regardless of this failure — it is "replace only the e2e layer with Playwright", not "replace it with vitest units alone".

**Files:**
- Create: `tools/spikes/tauri-ui-test/scratch-app/` (a throwaway Tauri hello-world, not `packages/*`/`apps/*`), `tools/spikes/tauri-ui-test/wdio.conf.ts`, `tools/spikes/tauri-ui-test/smoke.test.ts`.
- Create: `tools/spikes/tauri-ui-test/result.md` (not part of the Task 1 scaffold, so this task creates it first).

**Interfaces:** Consumes: `@tauri-apps/cli` 2.11.5 (already installed, `_probes` file), `tauri-driver` (cargo), `webdriverio` (npm). Produces: none.

1. Read `docs/spec/A7-dev-process.md` A7-D4 (the §0 decision table) and §5 ("UI smoke").
2. Create a minimal Tauri app with `cd tools/spikes/tauri-ui-test && npx create-tauri-app@latest scratch-app --template vanilla --manager pnpm --yes` (this app is throwaway code — unrelated to `apps/desktop`; US-A25 builds the real app).
3. Install the driver with `cargo install tauri-driver` (the A7-D4 default assumption).
4. Write `tools/spikes/tauri-ui-test/wdio.conf.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

let tauriDriver: ChildProcess;

export const config: WebdriverIO.Config = {
  specs: ["./smoke.test.ts"],
  capabilities: [
    {
      "tauri:options": {
        application: path.resolve(
          "scratch-app/src-tauri/target/release/scratch-app",
        ),
      },
    } as any,
  ],
  hostname: "127.0.0.1",
  port: 4444,
  beforeSession: () => {
    tauriDriver = spawn("tauri-driver", [], { stdio: "inherit" });
  },
  afterSession: () => tauriDriver?.kill(),
};
```

5. Write `tools/spikes/tauri-ui-test/smoke.test.ts` (click the "Greet" button of the default Tauri template and check that the response text changes — the vanilla template's actual DOM ids are `greet-input`/`greet-button`/`greet-msg`):

```ts
import { expect } from "@wdio/globals";

describe("gate: tauri-driver + webdriverio smoke", () => {
  it("clicks the greet button and sees a response", async () => {
    const input = await $("#greet-input");
    await input.setValue("gate-17");
    const button = await $("#greet-button");
    await button.click();
    const msg = await $("#greet-msg");
    await expect(msg).toHaveTextContaining("gate-17");
  });
});
```

6. Build the release binary with `cd tools/spikes/tauri-ui-test/scratch-app && pnpm tauri build --debug` (adjust the path to `target/debug/scratch-app` under `--debug` so it matches wdio.conf.ts), then run `cd .. && pnpm add -D webdriverio @wdio/cli @wdio/mocha-framework @wdio/local-runner && npx wdio run wdio.conf.ts`.
7. PASS condition: the WebdriverIO session shuts down cleanly and the assertion in `smoke.test.ts` passes (exit code 0). On failure (e.g. the session will not open because `tauri-driver` has no official macOS support — the known risk that Tauri's WebDriver path centers on Linux (WebKitWebDriver)/Windows (msedgedriver)), copy the error message verbatim into `result.md` and record the A7-D4 fallback (vitest units + manual QA) as the adopted decision.
8. Write `tools/spikes/tauri-ui-test/result.md` from scratch (the same template as the other gates; it was not among Task 1's 14, so it is created here):

```markdown
# Spike: Tauri UI testing tool (A7-D4, A7-2)

- **Question**: Does tauri-driver + WebdriverIO work for a Tauri 2 app UI smoke
- **Owning appendix**: A7 (A7-D4)
- **Owner**: agent
- **Host**: macbook
- **Run date**: 
- **Result (Pass/Fail)**: 
- **Measurements/evidence**: 
- **decided_by**: 
- **Notes**: 
```

9. `git add tools/spikes/tauri-ui-test && git commit -m "$(cat <<'EOF'
tauri-ui-test-spike: tauri-driver + WebdriverIO confirmation spike (A7-D4)

- Run one button-click WebdriverIO smoke against a scratch Tauri vanilla app (e2e layer only — component tests are already settled as vitest+RTL+jsdom in phase-a-desktop.md)
- On Pass, confirm it as the e2e smoke tool for apps/desktop (after US-A25); on Fail, replace it with Playwright against the web build (M14)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

---

## Done criteria

All 14 files from `tools/spikes/gate-01-calendar-funnel/result.md` through `gate-14-worktrunk-dryrun/result.md`, plus `worktrunk-cli/confirmed-usage.md` and `tauri-ui-test/result.md`, must be filled in, and all 14 gates must Pass (or be replaced by an approved fallback such as A6-D2/D4) before master §16's exit criterion "the pass/fail of the 14 gates fills in the decision table" is satisfied and Phase A (`2026-09-20-phase-a-kernel-and-db.md` and others) can start. The "result record table (blank form)" in `A6-ops-infra.md` §11.1 is also filled by copying the values from these 14 `result.md` files (editing the A6 document itself is out of scope for this plan).

## Self-review log

1. **Story coverage**: US-A00 (Task 1), gates ① (Task 14) ② (Task 15) ③ (Task 9) ④ (Task 10) ⑤ (Task 11) ⑥ (Task 2) ⑦ (Task 3) ⑧ (Task 4) ⑨ (Task 12) ⑩ (Task 13) ⑪ (Task 5) ⑫ (Task 6) ⑬ (Task 7) ⑭ (Task 8) — all 14 map to exactly one task each. Also includes `worktrunk-cli-spike` (Task 16) and `tauri-ui-test-spike` (Task 17) as required by the contract (`2026-09-20-phase-a-interfaces.md` §10).
2. **Banned-pattern grep**: `TBD`, `TODO`, `implement later`, `add appropriate error handling`, `handle edge cases`, `similar to Task` — all zero hits (each gate's code is a real script, and the blank fields in `result.md` are a data template to fill in after execution, like A6 §11.3's "result record table (blank form)", not an evasion of implementation).
3. **Symbol validation**: This plan covers Phase 0, where `packages/*` does not exist yet, so it consumes none of the contract's (§3–§8) `@omnis/*` exports (intentional — A7 §1 "tools/spikes sits outside the workspace build graph"). Every symbol it consumes is either an npm package (`@rocicorp/zero`, `googleapis`, `@slack/socket-mode`, `webdriverio`) or the output of an earlier task in this plan (only one: Task 16 reading Task 8's `result.md`).

## Change log (2026-09-20, cross-plan review)

- **M14 / Task 17**: Narrowed the `tauri-driver`+WebdriverIO scope to e2e only — stated that component tests are already settled as vitest+RTL+jsdom in `phase-a-desktop.md`, and replaced the Fail decision rule from "vitest units + manual QA" with "Playwright against the web build".
- **Gate ⑪ / Task 5**: Quoted items 1 and 2 of `_probes`'s "Findings that change gate ⑪" verbatim in the premise block, rewrote mode (b) to run in a fresh worktree fixture cwd with its own `.claude/settings.json` project hook so the project hook's firing is measured, refined the pass criteria to "in at least one mode the omnis hook fires AND the project hook does not", and specified that the decision outcome is reflected in master §19 Q13.
- **Gate ⑫ / Task 6**: Reviewed — the six `--permission-mode` literals (no `default`) and the observe→plan / workspace→manual / trusted→bypassPermissions mapping are already in place, so no further changes.
- **Gate ⑦ / Task 3**: Reviewed — the procedure of vendoring the schema via `codex app-server generate-json-schema --out <dir>`, then finding the turn-start method in the schema while keeping a runtime-lookup fallback (manual regex correction) is already in place, so no further changes.
- **US-A00 / Task 1**: Replaced the verification command from `find tools/spikes -maxdepth 1 -mindepth 1 -type d | grep -v '/_probes$' | wc -l` with `find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes` (+`| wc -l`) (3 places in the body + 1 in the commit message).
