# Gate Jev: can TypeSafe's decision model be omnis's decision tier?

- **Question**: Can Jev (`typesafe-ai/jev-latest`, reached through the Vercel AI Gateway) take over
  the six A4 decisions the memo maps, at a precision that keeps omnis's existing safety gates intact
  and at a cost and latency that beat waking a text model?
- **Owning appendix**: A4 §2.4 / §3.1 / §5.2 / §7 / §9; the memo
  `docs/decisions/2026-09-21-jev-decision-tier.md`.
- **Owner**: agent (unattended).
- **Host**: macbook (no network access needed in mock mode).
- **Run date**: 2026-09-21 (mock). Real run: **attempted, blocked by the account** — see "Why the
  real run cannot score yet".
- **Result**: **PENDING — the credential resolves, the Gateway refuses to serve.** Every number
  below is a mock run. Nothing in this file is evidence about Jev's quality; the real run is what
  would be.

## How to run

```
pnpm spike:jev          # real Jev when a credential resolves, the mock oracle otherwise
pnpm spike:jev --mock   # force the mock — the only mode that completes today
pnpm spike:jev --real   # force the real provider; exits 1 with no credential
```

The credential comes from `OMNIS_AI_GATEWAY_API_KEY`, or from Keychain item
`omnis.vercel.ai_gateway` — the same order `JevDecider` uses in production, so a green real run also
proves the credential path. **That item now exists**, so plain `pnpm spike:jev` no longer falls back
to the mock: it selects the real provider and exits 1 with the account diagnosis below. Use `--mock`
until billing is enabled.

The runner touches no database, no settings row, and no hub process: it calls the decider directly,
so a spike run cannot flip production behaviour or record an `agent_runs` row.

### Two rows per dataset

Every dataset is scored twice on the same rows with the same counters, because a candidate with no
incumbent cannot answer the gate's question:

- `current` — the path omnis runs **today** for that decision: T0 only (`auto_archive`), `routeByRule`
  only (`task`), no veto (`followup`). All three are deterministic, so the runner computes them for
  real and they cost nothing.
- `current (LLM)` — where today's path continues into a text model, printed as a pending OpenRouter
  run rather than guessed. `auto_archive`'s ambiguous T0 residue wakes the T1 model
  (`loops/auto-archive.ts`); `task`'s residue goes to the delegation-eligibility LLM
  (`loops/task.ts`); `route_note` is answered by the T1 `note_route` loop (`loops/note-route.ts`).
  `followup` has no such leg — its veto exists only on the decision tier, so a null tier means no veto.
- `jev` — the candidate.

`route_note` has no deterministic arm at all, so its `current` row is the pending line and nothing
else. That is a fact about the decision, not a gap in the harness.

## What each golden set is scored on

| Golden set | Jev question | Ground truth | Why this one |
| --- | --- | --- | --- |
| `auto_archive.jsonl` (150) | `archive` (boolean), threshold 0.85 | `expect_archive` | Decision #2, run **exactly as `loops/auto-archive.ts` runs it**: hard gate → T0 → Jev on the residue. The only set whose label is already the answer to a declared question. |
| `task.jsonl` (100) | `delegate` (boolean), threshold 0.7 | `expected_tasks[].owner === "agent"` | Decision #5's eligibility half. The set carries no file paths, so no `routeByRule` rule can fire — every row is the residue Jev would get. |
| `followup.jsonl` (20) | `reach_out` (boolean, veto-only) | none — see below | Decision #4 only ever cancels, so the number that matters is the **false-veto rate**, not accuracy. |
| `route_note.jsonl` (50) | `note_kind` (choice over the candidates) | `expected.id` | **Not one of the six.** An off-mapping probe: no call site asks Jev about note routing. Reported separately and consumed by nothing. |

`followup.jsonl` has no "should we reach out" label — every row is a candidate the sweep already
judged worth a look. So the oracle is "reach out" for all of them, and the two
`no_cold_outreach_violation_test` rows are the exception: the harness itself flags those as
cold-outreach risks (A4 §7.4), so a veto there is *correct*, not an error. The report prints the veto
list with that distinction made, rather than inventing an accuracy number.

Hard gates are re-run before Jev: the sensitivity ≠ normal / VIP block for auto-archive, and T0's
non-human-sender → never-replied → no-question-mark descent. Jev never sees a row the deterministic
layers already decided.

## The mock run

Mock mode answers from the golden set's own label, deliberately inverted on a deterministic ~15 % of
rows (FNV-1a over the state, so the same row is wrong on every run and a regression is diffable). An
all-oracle mock would pin fp/fn/unsafe at zero and verify nothing; this one makes the counters move.

```
$ pnpm spike:jev --mock
jev gate: mode=mock (forced) model=local/mock-oracle-v1
  mock numbers verify the scorer, not the model: latency is 0 by construction and tokens are estimated at 3 chars/token.

auto_archive.jsonl  [archive (boolean)]
  current (T0 only, no model call): rows=150 asked=0 not_asked=150
    tp=87 fp=0 tn=60 fn=3 unsafe=0 precision=1.000 recall=0.967
    latency/cost: n/a — this row makes no model call
  current (LLM): pending OpenRouter run (needs OMNIS_OPENROUTER_API_KEY) — the T1 model that answers T0's ambiguous residue (loops/auto-archive.ts)
  jev (local/mock-oracle-v1): rows=150 asked=33 not_asked=117
    tp=89 fp=7 tn=53 fn=1 unsafe=0 precision=0.927 recall=0.989
    latency mean=0.0ms p95=0ms  tokens_in mean=180  $/1k=0.0075

task.jsonl  [delegate (boolean)]
  current (routeByRule only, no model call): rows=100 asked=0 not_asked=100
    tp=0 fp=0 tn=92 fn=8 unsafe=0 precision=n/a recall=0.000
    latency/cost: n/a — this row makes no model call
    - label distribution: 8 delegate / 100 rows
  current (LLM): pending OpenRouter run (needs OMNIS_OPENROUTER_API_KEY) — the delegation-eligibility LLM that answers what routeByRule abstains on (loops/task.ts)
  jev (local/mock-oracle-v1): rows=100 asked=100 not_asked=0
    tp=8 fp=17 tn=75 fn=0 unsafe=0 precision=0.320 recall=1.000
    latency mean=0.0ms p95=0ms  tokens_in mean=342  $/1k=0.0144
    - label distribution: 8 delegate / 100 rows

followup.jsonl  [reach_out (boolean, veto-only)]
  current (no veto — every candidate is nudged): rows=20 asked=0 not_asked=20
    tp=0 fp=0 tn=20 fn=0 unsafe=0 precision=n/a recall=n/a
    latency/cost: n/a — this row makes no model call
  jev (local/mock-oracle-v1): rows=20 asked=20 not_asked=0
    tp=0 fp=3 tn=17 fn=0 unsafe=0 precision=0.000 recall=n/a
    latency mean=0.0ms p95=0ms  tokens_in mean=161  $/1k=0.0068
    - f7: vetoed gmail (first_contact=false)
    - f11: vetoed whatsapp (first_contact=false)
    - f19: vetoed gmail (first_contact=false)

route_note.jsonl  [note_kind (choice, off-mapping probe)]
  current (LLM): pending OpenRouter run (needs OMNIS_OPENROUTER_API_KEY) — the T1 note_route loop, which is what routes notes today (loops/note-route.ts)
  jev (local/mock-oracle-v1): rows=50 asked=50 not_asked=0
    tp=0 fp=0 tn=0 fn=0 unsafe=0 precision=n/a recall=n/a
    accuracy=0.920
    latency mean=0.0ms p95=0ms  tokens_in mean=68  $/1k=0.0029
    - overconfidence traps: 12/15 correct
```

### What the `current` rows establish

The two deterministic rows are real numbers, not mock ones — no model is consulted, so they are the
same on every run and on the real run too:

| Dataset | `current` | Reading |
| --- | --- | --- |
| `auto_archive` | precision 1.000, recall 0.967, unsafe 0 | T0 alone. Identical to `pnpm eval:archive`, which is the check that harness gates on ≥ 0.97 / ≥ 0.70 — so this row is a second, independent computation of a number the repo already trusts. T0 misses 3 of the 90 archivable rows and never archives the wrong one. |
| `task` | tp 0, fp 0, tn 92, fn 8, recall 0.000 | `routeByRule` abstains on **all 100** rows — the golden set has no file paths, no GUI channel, no cadence and no duration, so no rule fires and, today, nothing is delegated. This is derived by calling `routeByRule` on every row, not asserted: `asked=0` and `tp=0` are the rule's own verdict. |
| `followup` | tn 20, no vetoes | The tier abstains, so all 20 candidates are nudged. A zero false-veto rate the Jev row has to be read against — 3 of 20 is worse, not better, until the cold-outreach rows are separated. |

So the gate's question sharpens to: Jev's row beats T0's 3 misses without spending T0's precision, and
its 3 false vetoes on `followup` are the price of the 2 correct ones. Neither is answerable from a
mock; both are answerable as soon as the real run completes.

### What this run does and does not show

**Shows**: the harness works end to end. All 320 rows parse against the validator's own schemas, all
four question sets build, every request reaches a decider through the real `DecisionRequest` contract,
and every counter moves — fp, fn, and the veto list are all non-zero somewhere, which an oracle mock
could not demonstrate. Token and cost arithmetic runs (though on estimated tokens). The `current` rows
are not mock data at all: they are the real T0 and `routeByRule` logic scored on the real golden sets,
so they will read the same after the real run.

**Does not show**: anything about Jev. Accuracy here is the mock's ~85 % oracle, and the mock's
precision column is meaningless by construction — `task.jsonl`'s `precision=0.320` is 17 noise flips
against a base rate of 8 positives in 100 rows, not a model's error profile. Nor does it show the
LLM arm of any `current` row; those are pending lines, not zeros.

### One number that is real

`unsafe=0` is not the mock's doing. In `auto_archive`, sensitivity ≠ normal and VIP rows are stopped
by the five hard gates before any decider is called, and a gate-blocked row can only land in the keep
column. The mock is wrong on ~15 % of rows and still cannot archive one. That is the invariant the
spike was built to make checkable, and it holds structurally — see
`docs/decisions/2026-09-21-jev-decision-tier.md`, "Jev never approves an outbound action by itself".

## Findings from building the wiring and this eval

1. **T0 still answers most of auto-archive, and it answers better than the mock.** 117 of 150 rows
   never reach a decider; Jev is asked about the 33 that T0 punts. The baseline row makes the size of
   that gap visible: T0 scores precision 1.000 / recall 0.967 alone, where the mock's Jev row scores
   0.927 / 0.989 — it buys 2 of T0's 3 misses back for 7 wrong archives. Replacing T0 with Jev would
   multiply cost for no safety gain; the only question is whether the real model clears T0's precision
   on the residue, which is why the runner mirrors the loop's descent instead of asking Jev about
   every row.
2. **The state had a gap the eval exposed.** `autoArchiveRequest` did not tell Jev whether Logan had
   ever replied in the thread, although T0's rule ④ turns on exactly that. Fixed: `hasReplied` is now
   part of the state, and `loops/auto-archive.ts` passes the `i_replied` it was already selecting.
3. **Jev produces no rationale text.** omnis's `rationale` is user-facing copy and A4 §1.2 expects it
   in the message's language. `classify.ts` synthesizes a fixed English sentence on the Jev path.
   This is the real cost of moving a call site and it recurs at every one — the memo flags it.
4. **Two of the six decisions are veto-only, so accuracy is the wrong metric for them.**
   draft-worthiness and follow-up can only be made stricter by Jev. For those, the number that
   decides the gate is how often Jev cancels something legitimate — a false-veto rate.
5. **`route_note.jsonl` has no call site**, and giving it one would be inventing a seventh decision
   kind outside the memo. Scoring it as a probe is honest; reporting it as a gate result would not be.
6. **Cost is negligible at every call site measured**: 68–342 input tokens per decision, i.e.
   $0.003–$0.014 per 1,000 decisions at the published $0.042/1M. The T1/T2 text paths are orders of
   magnitude above that, so cost should not be the deciding factor in the gate — precision and the
   fail-open path are.
7. **The wire contract is recorded, not transcribed.** `wire-record.json` holds the request the
   provider actually emits (`POST /v4/ai/evaluation-model`, `ai-model-id`, spec version 4), captured
   through a stub transport by `record-wire.ts` and regenerable with
   `pnpm tsx tools/spikes/gate-jev/record-wire.ts`. Its response half is the documented shape, marked
   as such. The endpoint path and headers belong to the AI SDK, so re-run that script on an SDK bump.

## Why the real run cannot score yet

The gate cannot be decided from this file. The Keychain item `omnis.vercel.ai_gateway` now resolves
(so `pnpm spike:jev` picks the real provider rather than the mock), and the request reaches the
Gateway — which refuses it at the account level:

```
$ pnpm spike:jev --real
jev gate: mode=real model=vercel-ai-gateway/jev-latest
jev gate: real run failed, nothing scored — HTTP 403 customer_verification_required GatewayInternalServerError AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.
  rerun with --mock for the scorer check, or fix the account and rerun --real.
```

Exit code 1, one line, no stack: the AI SDK's error object carries the entire request payload in its
cause, so the runner reads the Gateway's own `error.type` out of the parsed response body and prints
nothing else of it. No key material appears in the output.

**To unblock**: add a credit card to the Vercel AI Gateway account, then run

```
pnpm spike:jev --real
```

and replace the mock section above with that output. Proposed pass criteria, for the run to be judged
against rather than after:

| Check | Threshold | Rationale |
| --- | --- | --- |
| auto-archive `unsafe` | must be 0 | Already structural, but the real run re-confirms the gates hold with a real model in the loop. A non-zero value fails the gate outright. |
| auto-archive precision | ≥ 0.97 | Same bar `tools/eval/auto-archive.ts` holds the T0 path to — a wrong archive is what erodes trust in the Inbox. |
| auto-archive recall | ≥ 0.70 | Also the existing bar. Below T0's 0.967 the tier is not worth enabling; the interesting number is how much of T0's 3 misses Jev recovers. |
| delegation precision | ≥ 0.50 | Base rate is 8 %, and a wrong delegation is a pending approval a human has to reject. Recall matters less: a missed delegation just leaves the task in the normal list. |
| follow-up false vetoes | ≤ 1 of 20, and 0 of the 2 cold-outreach rows let through | Veto-only: a false veto is a nudge that never happens, and there are only ~10 candidates a day (A4 §7.3), so each one is visible. |
| latency p95 | < 8000 ms | `JEV_TIMEOUT_MS` aborts at 8 s, so a p95 above it means the tier is timing out rather than answering. |
| cost | report only | At $0.042/1M input the tier is cheap by construction; the number is recorded, not gated. |
| `route_note` probe accuracy | report only, ≥ 0.80 informational | Off-mapping. It would become a gate only if note routing were added as a seventh decision kind. |

One caveat on reading these against the mock section: the `current (LLM)` rows are pending, so a
passing real run shows Jev clears the **deterministic** bars (T0, `routeByRule`, no-veto) — not that it
beats the model it would replace. Those three rows need `OMNIS_OPENROUTER_API_KEY` and the T1 loops on
the same golden sets, and until they run, "Jev beats current" means "Jev beats T0", which is the
weaker claim.

If the criteria pass, the next step is flipping `agents.decision_provider` to `"jev"` — and if they do
not, the correct outcome is leaving the flag at its `"llm"` default, which is what every environment
runs today and what the wiring guarantees is zero-Jev-call.
