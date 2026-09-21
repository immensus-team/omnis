# Decision — Jev (TypeSafe AI "System One") as omnis's decision tier

Date: 2026-09-21. Status: proposed (spike). Owner: plan/jev.

This is a spike memo, not an accepted architectural decision. It records what Jev is, the exact
API omnis would call, how it maps onto the decisions omnis already makes, and what the gate
measurements in `tools/spikes/gate-jev/` have to show before the flag is flipped.

## Context

omnis makes a large number of small, typed decisions in its layers: work/personal scope,
priority, sensitivity, "should this be archived", "should I draft a reply", "which runtime
should run this delegation". Today those are made either by deterministic T0 rules
(`classify/rules.ts`, `delegate/route.ts`, `draft/register.ts`) or by asking a text-generating
LLM for a JSON object and validating it afterwards (`t1/classify-t1.ts`, and every
`LoopSpec.outputSchema` consumed by `loop/run.ts`).

Both paths pay for text generation omnis does not want. A classifier that must emit a JSON
document to say "personal" spends output tokens on syntax it then re-parses and re-validates,
and the cost of a schema violation is a whole retry or a degraded fallback (A4 §2.5, §1.6).

Jev targets exactly that gap.

## What Jev is

Per TypeSafe AI's own description on the Vercel changelog, Jev is "a probabilistic decision
model for software: state goes in, typed Choice, Score, and Boolean answers come out." Where an
LLM emits one token at a time and the application parses and validates afterwards, Jev "evaluates
all declared questions in parallel and returns typed answers plus probabilities directly"
([changelog](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway), fetched
2026-09-21).

Three answer types, per the AI SDK evaluation guide
([ai-sdk.dev/docs/ai-sdk-core/evaluation](https://ai-sdk.dev/docs/ai-sdk-core/evaluation)):

| Type | Question shape | Answer |
| --- | --- | --- |
| `choice` | `criteria`: a non-empty map of option name → description | `choice` (the selected key) + optional `probabilities` over every option |
| `score` | `criteria`: at least two **ordered** level descriptions | `score`, a fractional position in `[0, levels.length - 1]` + optional `probabilities` keyed by zero-based level index |
| `boolean` | optional `criteria.true` / `criteria.false` descriptions | `probability`, the model's estimated P(true) |

Two properties matter for omnis's safety argument:

- **`probability` on a boolean is P(true), not confidence in the answer.** The docs are explicit:
  "`0.98` signals a strong yes and `0.02` a strong no — not confidence in either outcome." Any
  threshold omnis uses must therefore be chosen in application code from labelled data, and
  `docs/spec/A4-agent-layer.md` §9.2's "when in doubt, do not archive" maps onto a threshold on
  `probability`, not onto a confidence value.
- **TypeSafe's separate confidence is not portable.** It is returned at
  `result.providerMetadata?.typesafe?.confidence`, keyed by question ID. The guide states it "is
  neither the selected option's probability nor a portable measure". omnis may log it; it must not
  gate a safety decision on it.

There is one shared state per call, not a batch: "no streaming, no multilabel classification, no
batching unrelated states — separate states need separate calls." Confirmed by the model page's
use cases: classification, routing, rubric assessment, automated verification
([model page](https://vercel.com/ai-gateway/models/jev)).

## The exact API omnis would call

Jev is reachable on Vercel AI Gateway as model id `typesafe-ai/jev-latest` via the experimental
`evaluate` API in AI SDK 7. The repo already pins `ai@7.0.107`, and the function is present in the
installed build (`evaluate as experimental_evaluate` in `ai/dist/index.d.ts`).

Signature, from
[ai-sdk.dev/docs/reference/ai-sdk-core/evaluate](https://ai-sdk.dev/docs/reference/ai-sdk-core/evaluate):

```ts
evaluate({
  model,          // evaluation-model instance, or a string id resolved by Gateway
  state,          // string | JSON object | JSON array — the one shared state
  questions,      // Record<string, { type: 'choice' | 'score' | 'boolean', instructions, criteria? }>
  maxRetries,     // default 2
  abortSignal,
  headers,
  providerOptions,
})
```

The response carries `answers` (one entry per question id, typed by that question's type),
`usage`, `warnings`, optional `rounding`, optional `providerMetadata`, and `response` with
`timestamp` / `modelId`.

### Wire shape

Recorded from the installed SDK against a stub transport on 2026-09-21 (probe output kept in
`tools/spikes/gate-jev/`), not taken from prose:

```
POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model
authorization: Bearer <AI Gateway key>
ai-model-id: typesafe-ai/jev-latest
ai-evaluation-model-specification-version: 4
content-type: application/json

{"state":"...","questions":{"scope":{"type":"choice","instructions":"...","criteria":{"work":"...","personal":"..."}}},"providerOptions":{}}
```

The gateway's own docs give the plain HTTP prefix as `https://ai-gateway.vercel.sh/v1` for
chat-completion-shaped calls and `https://ai-gateway.vercel.sh/v4/ai` as the AI SDK `baseURL`
default ([docs/ai-gateway](https://vercel.com/docs/ai-gateway),
[ai-sdk provider page](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)); the evaluation
endpoint above is the `/v4/ai` form.

**omnis will not hand-roll this HTTP call.** The endpoint and headers are SDK-owned and
undocumented as a public contract; calling `experimental_evaluate` through `createGateway()`
keeps omnis on the supported surface and keeps the wire format from becoming our problem.
`JevDecider` takes an injectable `fetch` so tests still exercise a real HTTP boundary against a
recorded response.

### Authentication

`AI_GATEWAY_API_KEY` is the SDK's default env var; `createGateway({ apiKey })` takes precedence
over it. Per the repo's A6 §9 scheme the key will live in Keychain as
`omnis.vercel.ai_gateway`, read at runtime in this order:

1. `OMNIS_AI_GATEWAY_API_KEY` — the launchd-injected form, matching how `t1/provider.ts` and
   `t2/provider.ts` read `OMNIS_OPENROUTER_API_KEY`.
2. Keychain item `omnis.vercel.ai_gateway`, read with `security find-generic-password -w`
   (the helper in `tools/auth-kit/verify.ts`) for a laptop dev session where launchd is not
   running.
3. Neither present ⇒ the provider reports unavailable and the router falls back to the existing
   LLM path. No key is required for any test in this repo.

The value is never logged. Only its presence is ever reported.

### Price, context, limits

From [vercel.com/ai-gateway/models/jev](https://vercel.com/ai-gateway/models/jev), fetched
2026-09-21:

- **$0.042 per 1M input tokens.**
- **Context window 32,000 tokens.**
- **Max output tokens: 0** as listed on the model page — consistent with a model that returns
  typed answers rather than generated text. `JevDecider` therefore prices a call from input
  tokens alone.
- The page states "Detailed capability metadata has not been reported for this model", so no
  latency, rate-limit, or structured-output claim is published. The changelog's only performance
  claim is relative and vendor-supplied: Jev "was up to 193.6x faster and 444.6x cheaper than
  LLMs on its workflow evaluations". **omnis treats both the relative claim and the 32k context
  as unverified until the real-key run in `tools/spikes/gate-jev/RESULT.md` measures them.**

Governance: the changelog states Zero Data Retention and No Training can be set per request via
`providerOptions.gateway.zeroDataRetention`. omnis's inbound mail is more sensitive than the
average gateway payload, so the provider sets `zeroDataRetention: true` on every call.

## How the community wires Jev into coding agents

Surveyed via [AnotiaWang/awesome-jev](https://github.com/AnotiaWang/awesome-jev) (fetched
2026-09-21). The recurring pattern is worth naming because it is the same trade omnis is
considering: **deterministic rules first, one batched Jev call for what the rules could not
settle, and a typed escalation back to the LLM for anything Jev is not confident about.**

- **`jev-engineering`** (Claude Code hook + MCP + loopback service) states the policy outright:
  deterministic rules first, then a single Jev request.
- **`jev-use`** (Claude Code / Codex / pi plugin) batches typed questions for an agent loop and
  ships a "typed escalation contract" that returns writing and low-confidence steps to the LLM.
- **`jev-axi`** scores shell commands for hazards pre-run but decides routine commands locally,
  "so nothing is sent".
- **`jev-belay`** spends one four-question Jev call only when files changed with no passing check
  since, and "fails open on errors".
- **`jev-pref`** turns an `AGENTS.md`-style preference file into a Jev linter.
- **`eve`**, Vercel's own agent framework, defaults its experimental `autoModel` to Gateway
  `typesafe-ai/jev` to pick a language model from an allowlist.
- The official TypeSafe agent skill installs with
  `claude plugin marketplace add typesafe-ai/skills`.

omnis's router follows the same shape: T0 rules stay first and unchanged; Jev is consulted only
where a T0 rule declined to conclude; anything Jev declines, errors on, or answers below the
call site's own threshold falls through to the existing LLM path. **Fail-open is the default,
and a Jev failure is never itself a decision.**

## Mapping: omnis decision → Jev question(s)

`DecisionKind` in `packages/agents/src/decision/types.ts` is the closed set of six decisions
below. Question ids are the contract between `decisions.ts` and each call site.

| # | omnis decision | Call site today | Jev questions | Answer → action |
| --- | --- | --- | --- | --- |
| 1 | work/personal scope + label | `classify.ts` stage 3 (`classifyWithT1`) | `scope` (choice: work/personal/unknown), `priority` (choice: now/today/week/fyi), `sensitivity` (choice) | Fills `ClassifyOutput`. Raises the same injection-flag block as T1: a non-empty `injection_flags` still yields `scope: "unknown"` and no artifact. |
| 2 | auto-archive confidence | `loops/auto-archive.ts` `decide()` → T1 | `archive` (boolean) | `probability >= T1_ARCHIVE_CONFIDENCE_MIN` (0.85) archives; below it, keep. The five `hardGate` checks run **before** Jev and are not Jev's to override. |
| 3 | draft-worthiness | `loops/draft.ts` trigger `needs_reply_score >= 0.5` | `worth_drafting` (boolean) | Only ever **lowers** the gate. Jev saying "not worth drafting" skips the loop; Jev saying "worth it" changes nothing, because writing is an LLM job. The answer is consumed only below `DRAFT_WORTHINESS_VETO_BELOW`. |
| 4 | follow-up nudge | `loops/followup.ts` (`sweepFollowups` → `person.inactive`) | `reach_out` (boolean) | Same veto-only shape as #3, with `FOLLOWUP_VETO_BELOW`. `pickFollowupChannel` and the `NO_COLD_OUTREACH_CHANNELS` gate are untouched and run afterwards. |
| 5 | delegation eligibility | `delegate/route.ts` `routeByRule` → L4 (LLM) | `delegate` (boolean), `runtime` (choice: omnis/codex/claude_code/claude_ds), `host` (choice: mini/macbook) | Only consulted when `routeByRule` returned `null` — every rule it *can* answer it still answers alone, so `pickRuntime`'s deterministic table keeps winning everywhere it applies. The Jev route records `rule_id: "jev_delegation"`, needs `P(delegate) >= DELEGATION_JEV_MIN`, and `DELEGATION_DAILY_CAP` / `DELEGATION_THREAD_CAP_24H` are enforced outside it. |
| 6 | sensitivity routing | `sensitivity.ts` `sensitivityFor` | `sensitivity` (choice: normal/personal/finance/legal/health) | Merged through `pickSensitivity`, whose priority order (health > legal > finance > personal > normal) is a **maximum** — Jev can raise a level, never lower one below what the T0 path already found. |

Two of the six (`draft-worthiness`, `follow-up nudge`) are *veto-only* by construction. That is
deliberate: both end in outbound content or outbound contact if approved, so a Jev "yes" is not
allowed to be the deciding vote.

### Safety rule: Jev never approves an outbound action by itself

This is the invariant the whole spike is constrained by, and it is why the mapping table's
"answer → action" column is full of deterministic guards rather than Jev thresholds:

- **Jev has no tools and cannot act.** It answers declared questions about a state; omnis's own
  `apply()` functions do all writing. A Jev answer that is wrong produces a wrong *proposal*, and
  the same pending-approval path every other proposal takes still has to run.
- **No egress decision is ever Jev-only.** Drafting, sending, following up, and delegating are
  A4 egress paths; each keeps its own gate (`hardGate`, `NO_COLD_OUTREACH_CHANNELS`,
  `DELEGATION_DAILY_CAP`, the pending-approval row) and Jev can only ever make the gate stricter
  or abstain.
- **Sensitivity only moves up.** `pickSensitivity` takes a maximum over candidates; Jev is one
  more candidate. A Jev miss on sensitivity cannot downgrade a finance item to normal.
- **Auto-archive keeps its five hard gates** — sensitivity ≠ normal, VIP, pending approval,
  injection flags, and the re-archive exclusion all short-circuit before Jev is asked anything.
  The VIP/sensitive-never-auto-archived invariant is therefore untouched by this spike, and the
  existing test for it (`packages/agents/test/integration/auto-archive.test.ts`, plus the
  `auto_archive.jsonl` hard gate in `tools/eval/validate.ts`) continues to guard it.
- **Jev failure is fail-open.** No key, a timeout, a malformed answer, an unsupported question
  type: the router returns `null` and the call site runs exactly what it runs today.

## Optional: Jev Review MCP and the `ds/` reviewer loop

Not installed — noted only because it is cheap and the fit is close.
[Jev Review](https://github.com/victorlucss/jev-review-vercel-ai) (a fork of
`NiazMorshed2007/jev-review`, MIT) is a local-first MCP server whose single tool `jev_review`
takes `task`, `diff`, `files`, `repositoryContext` and an optional `previousEvaluation`, and
returns 1–10 scores with 0–1 confidence per dimension, prioritised weaknesses, and deltas when a
prior evaluation is passed. It registers with
`claude mcp add --scope user jev-review-vercel -- node /abs/path/dist/server.js` and finds its key
via an exported `VERCEL_AI_GATEWAY`.

The relevant property for omnis is `previousEvaluation` + per-dimension **deltas**: the `ds/`
reviewer loop that reviews DeepSeek-authored diffs in this repo could pass the previous review's
result and act only on regressions, rather than re-litigating every dimension on every round.
That is a materially different use from the six decisions above (it reviews *our own* diff, not
inbound user data), and it is out of scope for this spike.

## What this spike does not establish

- **No Jev call has ever been made against the real service.** There is no gateway key yet. Every
  number in `tools/spikes/gate-jev/RESULT.md` from this attempt comes from mock mode, and the
  memo's pricing and context figures are the vendor's published ones, uncorroborated.
- **No accuracy claim.** The gate runner scores Jev against `auto_archive`, `route_note`, `task`
  and `followup`; the mock run's precision/recall measure the *harness*, not the model.
- **`agents.decision_provider` defaults to `"llm"`.** Nothing in omnis changes behaviour until
  the flag is set, and a test asserts that the default path makes zero Jev calls.
