# W5 hardening — fix the findings from the Opus verification of the hub adapter registry (US-B45)

Worktree: /Users/logankim/AI-Workspaces/omnis.plan-w5-hardening (branch plan/w5-hardening). Per-branch DB: omnis_test_w5_hardening. Scope: apps/hub (registry, startup jobs, tests) and packages/kernel/src/adapter-health.ts only if F2 needs it. Read the full verification report below, then implement F1–F4 exactly as its follow-up tasks describe, with TDD, English only, commits per finding ('US-B45 hardening: F1 …'). Acceptance: each finding has a regression test; `pnpm lint && pnpm typecheck && pnpm --filter @omnis/hub test` (and kernel tests if touched) pass on the per-branch DB; hub still boots with zero accounts.

## Verification report (Opus)
## 5. W5 registry (US-B45 + cost report) vs plan Task 17

Read in full: `apps/hub/src/adapters.ts`, `adapters.test.ts`, `startup-jobs.ts`, `startup-jobs.test.ts`,
`test/integration/adapter-registry.test.ts`, `main.ts`, `config.ts`, against
`docs/superpowers/plans/2026-09-20-phase-b-channels.md:3229-3352` and the interfaces delta.

| Requirement | Status |
| --- | --- |
| Factory table correctness | **OK.** `main.ts:41-61` — slack/telegram unconditional (they read their own Keychain items); gmail+gcal only when both Google OAuth vars are set, sharing one client per A1 §2.3; outlook only when `OMNIS_OUTLOOK_CLIENT_ID` is set. Registry is injectable, so `adapters.test.ts` drives every branch with fakes (B-D5 satisfied). |
| Boot with zero accounts | **OK.** `adapters.test.ts:110` asserts `buildAdapters({accounts:[],factories:{}})` → `[]` and an empty channel map. A channel with no app credentials is simply absent from the table and its accounts log `adapter skipped: no factory for channel` (`adapters.ts:98`). Nothing in the boot path throws on the empty case. |
| Health write-back | **Partially OK.** Failures propagate (`adapters.ts:119`, `:176` → `recordAdapterHealth` → `accounts.last_error` + system Item at threshold 3). Best-effort wrapper `reportHealth()` swallows a throwing reporter — covered by two dedicated tests. **But no path ever reports `ok=true`** — see F2. |
| Cost report job registration | **OK.** `startup-jobs.ts:26` registers it; `startup-jobs.test.ts:38` pins the exact set and order against a fake scheduler. `COST_REPORT_JOB_NAME = "cost_report_monthly"` / `COST_REPORT_CRON = "10 0 1 * *"` match the row seeded by `0012_jobs_phase_b.sql:10` exactly, so `scheduler.start()`'s upsert reuses the seeded row rather than orphaning a second one. |
| Error handling | **OK for throws, gap for hangs** — see F1. One `connect()` rejecting does not take down the others (`adapters.test.ts:117`); a throwing `subscribe()` reports and does not reject `stop()` (`:189`); a throwing health reporter is survived in both the build path (`:148`) and the retry path (`:212`). |
| No secrets | **OK.** The hub never calls `security find-generic-password`; it carries `account_secrets.auth_ref` (the Keychain item *name*) into `AuthRef` and hands it to the adapter, per A3-D4. Both the unit test (`adapters.test.ts:88`) and the DB-backed integration test (`adapter-registry.test.ts:121`) assert the exact `AuthRef` shape. `logger.info("adapter registry", {configured: Object.keys(factories)})` logs channel names only. No secret reaches a log line, an error message, or the DB. |

**Plan deviations — all three are justified and documented in the commit messages:**

1. **Map keyed by channel, not account id.** The plan's step-1 snippet asserts `map.keys() == ["a1"]`
   (account id). The implementation returns `BoundAdapter[]` and derives a channel-keyed map via
   `adaptersByChannel()`. This is **correct**: `apps/hub/src/archive.ts:82` does
   `deps.adapters?.get(row.channel)`, and the plan's own Read section says Task 17 *follows* that key
   convention rather than changing it. `adapters.test.ts:77` pins it, and `adapter-registry.test.ts:154`
   proves the US-A36 write-back actually fires end-to-end against the real DB. The account id is kept
   on `BoundAdapter` for the sink and health paths, so nothing is lost.
2. **`loadAccountRows` exported** so `main.ts` and the integration test share one query — reasonable.
3. **`maxRetries` default 3** where the plan said "reattach once". More generous than specified, still
   bounded, still no backoff engine (the YAGNI note is honored; there is a `ponytail:` comment naming
   the ceiling at `adapters.ts:183`).

Shutdown ordering in `main.ts:164-183` is correct: server → bridge → `adapterLoops.stop()` → ingest/
summary/loops → `kernel.close()` → `pool.end()`. Loops are detached before the pool goes away, so no
`subscribe()` pump can push into a closed pool. `stop()` deliberately does not await the pumps, with
the reasoning written down at `adapters.ts:196-198`.

---

## Findings, ranked

### F1 · Medium — a hanging `connect()` blocks hub boot indefinitely
`apps/hub/src/main.ts:120-125`

`await buildAdapters(...)` runs **before** `server.listen()` (`main.ts:155`), and `buildAdapters`
awaits each `adapter.connect(auth)` **serially** (`adapters.ts:113`) with **no timeout anywhere**.
`connect()` is not cheap: Gmail does `readKeychainSecret()` (a `security find-generic-password`
subprocess that can block on a locked keychain) then `oauth.getAccessToken()` over the network
(`packages/adapters/gmail/src/index.ts:64-74`); Outlook does a Keychain read plus
`refreshAccessToken()` over `fetch` (`packages/adapters/outlook/src/index.ts:204-220`).

The commit message claims "a failing account can never abort startup" — that holds for *rejections*,
not for *hangs*. With one unreachable OAuth endpoint the hub never reaches `listen()`: `/health`
never answers, the LaunchDaemon sees a live process with no listener, and the signal handlers are
not attached yet either. N accounts multiply the wait.

**Fix shape:** wrap each `connect()` in `Promise.race` with a timeout (treat expiry exactly like a
throw — log + `recordAdapterHealth` + skip), or move the whole registry build to after `listen()`
and inject the map lazily.

### F2 · Medium — a channel marked `broken` never recovers on its own
`apps/hub/src/adapters.ts:86` · `packages/kernel/src/adapter-health.ts:78-87, 100-103`

`recordAdapterHealth(deps, channel, ok=true, …)` is what clears the failure counter and flips
`accounts.state` back to `'active'`. Grepping all of `apps/` and `packages/`: **the only `ok=true`
call site is `packages/kernel/test/integration/adapter-health.test.ts:89`.** No production path
reports a healthy adapter — `buildAdapters` and `startAdapterLoops` call the reporter on failure only.

So after 3 consecutive `subscribe()` failures the channel's accounts are set `state='broken'`, and
`buildAdapters` skips anything with `state !== 'active'` — meaning **even a hub restart will not
rebuild that channel's adapter**. Recovery requires a manual `UPDATE accounts SET state='active'`.

**Fix shape:** report `ok=true` once after a successful `connect()` in `buildAdapters`, and/or on the
first event drained in a pump after a prior failure.

### F3 · Low — one account's failure marks every account on its channel broken
`apps/hub/src/main.ts:113-119`

`reportAdapterHealth` drops `h.accountId` and passes only `h.channel`; `recordAdapterHealth` then runs
`UPDATE accounts … WHERE channel = $1` (`adapter-health.ts:93, 100`). Two Gmail accounts, one with a
revoked token → both get `last_error` set and both go `broken` at threshold. The channel-scoped shape
is Task 14's, pre-existing, but Task 17 is its first production caller, so this is where it becomes
reachable. Compounds F2.

### F4 · Low — `'기타'` translated inconsistently across two copies of the same query
`packages/kernel/src/archive.ts:94` → `'Other'` · `packages/agents/src/loops/digest-nightly.ts:63` → `'other'`

Both were `COALESCE(meta->'archived_by'->>'reason', '기타')` before the sweep — identical. They are now
`'Other'` and `'other'`. Inert today (`archivedSince` has no production consumer; only its own test),
but `archive.ts:90`'s own docstring says "The nightly digest reads a day's worth grouped by reason",
so the two are meant to be the same bucket. `digest-nightly.ts:80` derives `undo_token` from
`sha256(digestId::reason)`, so if these are ever consolidated the casing split silently produces two
buckets and two undo tokens.

### F5 · Low — chunk-ceiling tests moved off the CJK token path
`packages/memory/test/chunk.test.ts:11`

`const para = (n) => "가".repeat(n)` → `"a".repeat(n)`. `estimateTokens` has two distinct branches —
ASCII at 4 chars/token, wide at 1.5 (`packages/memory/src/tokens.ts:5-15`). Every chunk-ceiling
assertion that used `para()` (`:34`, `:41`, `:52`) now exercises the ASCII branch only, at ~⅓ the
token density, so the chunk boundaries under test are not the ones a Korean document produces. The
tests still pass and still assert something real; direct coverage of the wide branch survives in
`packages/memory/test/tokens.test.ts:11,16` (correctly labeled). Per CLAUDE.md this fixture qualifies
for the "specifically about non-English input" exemption and could have stayed Korean.

### F6 · Note — in-scope Korean deliberately left, correctly
Not defects; recording so the next sweep does not "fix" them:
- `packages/agents/test/normalize.test.ts`, `injection-set.test.ts` — Korean prompt-injection strings
  *are* the subject under test.
- `packages/agents/test/delegate-route.test.ts` — `extractHints`' patterns are Korean-only
  (`packages/agents/src/delegate/route.ts:34-37`: `/(\d{1,3})\s*분/`, `/(\d{1,2})\s*시간/`,
  `/카카오톡|kakao|linkedin|링크드인/i`). The source must change before the test can.
- `tools/e2e/phase-a.spec.ts:92,121,130` — Playwright selectors bind to the *desktop UI's* Korean
  aria-labels, which live in un-swept `packages/ui` / `apps/desktop`. Correct sequencing.
- Residual Korean is otherwise concentrated in `packages/ui`, `apps/desktop`, `apps/gallery`, `eval/*.jsonl`
  and `tools/i18n/report.md` (generated) — all outside sweep 2's declared scope.

---

## Follow-up tasks for DeepSeek

Each is self-contained. Branch per task, per-branch DB, commit after each slice.

**T1 (F1) — time-box adapter `connect()` so a hung channel cannot block hub boot.**
Branch `plan/b45-connect-timeout`, DB `omnis_test_b45_timeout`.
In `apps/hub/src/adapters.ts`, add `connectTimeoutMs?: number` to `BuildAdaptersDeps` (default 15_000)
and race each `await adapter.connect(auth)` against it. A timeout takes the exact same path as a
throw: `logger.error`, `reportHealth({status:"down", error:"connect timed out after Nms"})`, skip the
account, continue to the next. Do not add backoff. Tests in `apps/hub/src/adapters.test.ts` with
`vi.useFakeTimers()`: (a) a `connect()` that never resolves is skipped and reported, and the *other*
account in the same call still builds; (b) the default is used when the dep is omitted.
Accept: `DATABASE_URL=… pnpm --filter @omnis/hub test` green, plus `pnpm lint && pnpm typecheck`.

**T2 (F2+F3) — report adapter health as OK so a broken channel can recover.**
Branch `plan/b45-health-recovery`, DB `omnis_test_b45_health`.
(a) In `apps/hub/src/adapters.ts`, after a successful `await adapter.connect(auth)`, call
`reportHealth(..., {accountId, channel, status:"healthy"})`. (b) In `apps/hub/src/main.ts`, the
`reportAdapterHealth` shim already maps `status !== "down"` → `ok=true`, so no change is needed there —
verify that and leave a comment saying so. (c) Add an integration test in
`apps/hub/test/integration/adapter-registry.test.ts`: seed an account with `state='broken'` and a
secret, run `buildAdapters` with a fake factory whose `connect()` resolves, and assert the row is
back to `state='active'` with `last_error IS NULL`. Note in the commit message that F3 (channel-scoped
`WHERE channel = $1` in `packages/kernel/src/adapter-health.ts:93,100`) is **not** fixed here — it is
Task 14's shape and needs its own decision about whether health is per-account or per-channel.
Accept: the new test proves recovery; full `pnpm test` still green.

**T3 (F4) — unify the archived-reason fallback label.**
Branch `plan/en2-reason-label`, DB `omnis_test_reason_label`.
Pick `'Other'` (sentence case, matching the rest of the UI copy) and change
`packages/agents/src/loops/digest-nightly.ts:63` to match `packages/kernel/src/archive.ts:94`. Grep for
any test asserting the lowercase form and update it. One-line diff plus test; do not refactor the two
queries into one.
Accept: `pnpm lint && pnpm typecheck && DATABASE_URL=… pnpm test` green.

**T4 (F5) — restore CJK coverage to the chunk-ceiling tests.**
Branch `plan/en2-chunk-cjk`, DB `omnis_test_chunk_cjk`.
In `packages/memory/test/chunk.test.ts`, keep the ASCII `para()` and add a sibling
`paraWide = (n) => "가".repeat(n)` with a comment stating that the hangul fixture exists to exercise
`estimateTokens`' wide branch (1.5 chars/token) — the CLAUDE.md non-English-input exemption, labeled
as the rule requires. Add one test: a document built from `paraWide(300)` × 12 chunks, every chunk
`estimateTokens(c.text) <= CHUNK_MAX_TOKENS`. Do not revert the existing ASCII tests.
Accept: `DATABASE_URL=… pnpm --filter @omnis/memory test` green.

**T5 (F6, lower priority) — make `extractHints` language-agnostic, then translate its test.**
Branch `plan/en2-delegate-route`, DB `omnis_test_delegate_route`.
`packages/agents/src/delegate/route.ts:34-37` only matches Korean duration/channel words, so an English
delegation request currently gets `est_minutes: null` and never trips `dr_long_batch`. Extend each
regex to accept the English forms (`min|mins|minutes|hour|hours` alongside `분|시간`; `kakao|kakaotalk|
linkedin` are already there) and add English cases to `packages/agents/test/delegate-route.test.ts`
next to the existing Korean ones — **keep the Korean cases**, they are real input. This is a behavior
change, not a translation, so it needs its own commit and message.
Accept: both language sets pass; `pnpm lint && pnpm typecheck` green.

---

## Verdict

**PASS-with-notes.** The translation commits are behavior-neutral — 208/225 files byte-identical after
comment/string stripping, the remaining 17 are formatter reflow or intended translations, no test
deleted, no identifier renamed, no SQL predicate touched. The migration freeze is correctly restored
and byte-verified against the mini. All four gates are green on a fresh DB and the mini is serving.
The W5 registry matches Task 17 including its three documented deviations, keeps secrets out of the
hub, and boots clean with zero accounts. The two Medium findings (F1 boot-blocking hang, F2 no
recovery from `broken`) are operational gaps in new code that only bite once real accounts are
connected — which per B-D5 has not happened yet — so they do not block this merge, but they should
land before the first live connection.
