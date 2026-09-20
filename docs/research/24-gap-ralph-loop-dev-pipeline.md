# GAP 5: The build pipeline itself — ralph loop with Opus / Sonnet / Haiku / DeepSeek V4.1 Flash

Researched 2026-09-20. Every fact below carries a source + fetch date. VERIFIED = confirmed against a primary source this session; UNVERIFIED = could not confirm against a primary source.

## 1. TL;DR

omnis's dev pipeline doesn't need to be designed from scratch — it just needs two local tools that are already installed on this machine to be combined: oh-my-claudecode's `ralph` skill (PRD-driven story loop + tiered reviewer + mandatory deslop/regression re-verification) and the per-task git worktree isolation of `claude-squad`/`worktrunk`. On top of that, only one DeepSeek tier needs to be added: split each task into self-contained pieces ("files + acceptance criteria + verify command") and delegate via `claude-ds -p ...`. **The most important new finding**: "Fable" is not a nickname in the brief but a real Claude Code model alias (the top tier above `opus`), and in headless (`-p`)/Agent SDK mode the consent prompt for usage-credit spend **never appears — the charge simply goes through** — so `fable` must never be the default worker in an unattended ralph loop; reserve it for interactive sessions that Logan is watching, such as planning. The ToS boundary is already verified: calling the unmodified `claude` binary as a subprocess is fine, but routing around it to use an OAuth token with the Agent SDK is explicitly prohibited.

## 2. Facts

- Claude Code subagent `model` field accepts `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit`; omitted → picks per "subagent model order". VERIFIED (raw HTML fetch) — https://code.claude.com/docs/en/sub-agents (fetched 2026-09-20).
- **"Fable" is a real, distinct Anthropic model tier, not Logan's private name for the orchestrator.** `model-config` docs: "`fable` — Uses the Fable model for your provider for your hardest and longest-running tasks"; `best` resolves to Fable "where Fable is available to you, otherwise the same model as opus" — i.e. Fable sits above Opus 5 in the tier order. Page last modified 2026-09-15. VERIFIED — https://code.claude.com/docs/en/model-config (fetched 2026-09-20).
- Fable billing is usage-credit-based, gated by plan/seat tier, and **in `-p` (headless) mode or through the Agent SDK, Claude Code never shows the consent prompt — a Fable request that would bill usage credits is billed without asking.** In interactive terminal sessions it does prompt, with a 5-minute default `dialogExpiry` for remote/background sessions. VERIFIED — same source.
- `ghuntley.com/ralph`: the "Ralph" technique is `while :; do cat PROMPT.md | claude-code; done` — a bash loop that re-feeds the same prompt every iteration, relying on git history and files-on-disk as the only state carried forward. Recommended stack: `PROMPT.md` (instructions) + `@fix_plan.md` (prioritized backlog) + `@specs/` (specs). Core discipline: "one item per loop... if it starts going off the rails, then you narrow it down to just one item." Explicit warning: "You'll wake up to a broken codebase that doesn't compile" — requires monitoring, `git reset --hard` on runaway loops. VERIFIED — https://ghuntley.com/ralph/ (fetched 2026-09-20).
- oh-my-claudecode's local `ralph` skill (already installed) is a PRD-driven loop: auto-generates `prd.json` with per-story `acceptanceCriteria` and `passes: bool`, picks the highest-priority `passes:false` story, delegates to tiered agents ("Simple lookups: LOW/Haiku; Standard work: MEDIUM/Sonnet; Complex analysis: HIGH/Opus"), verifies each acceptance criterion with fresh command evidence before marking `passes:true`, then runs a **mandatory tiered reviewer gate** (STANDARD=Sonnet floor, THOROUGH=Opus for >20 files or security/architecture) that must never be the same context as the implementer, followed by a **mandatory deslop pass + regression re-verification** before the loop is allowed to exit. VERIFIED (local primary source) — `/Users/logankim/.claude/plugins/cache/omc/oh-my-claudecode/4.14.5/skills/ralph/SKILL.md` (read 2026-09-20).
- The official `ralph-loop` Claude plugin (separate from OMC's) implements the bare re-feed loop with `--max-iterations` and a `--completion-promise` string the model may only output when "completely and unequivocally TRUE." VERIFIED (local primary source) — `/Users/logankim/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/commands/ralph-loop.md` (read 2026-09-20).
- `smtg-ai/claude-squad`: 8,497★, pushed 2026-08-20, "Manage multiple AI terminal agents like Claude Code, Codex, OpenCode, and Amp" — isolates each session in its own tmux pane **and** git worktree so parallel sessions never collide on files; it is a TUI meant for a human to sit in and tab between sessions. VERIFIED (`gh repo view`) — https://github.com/smtg-ai/claude-squad (fetched 2026-09-20).
- `max-sixty/worktrunk`: 8,110★, pushed 2026-09-19 (one day before this research), "a CLI for Git worktree management, designed for parallel AI agent workflows," Rust, topics `git`/`agents`/`codex`/`worktrees`. Non-TUI, script-first surface — no human needs to be attached. VERIFIED (`gh repo view`) — https://github.com/max-sixty/worktrunk (fetched 2026-09-20).
- Anthropic's Claude Code legal page, verbatim: "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users." And: it "does not... prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription." "Developers building products... including those using the Agent SDK, should use API key authentication." VERIFIED — https://code.claude.com/docs/en/legal-and-compliance (fetched 2026-09-20; cross-confirmed against the same page fetched earlier this project in `12-cost-optimization.md`).
- DeepSeek Flash pricing per 1M tokens (the model `claude-ds` targets): input cache-hit $0.003 off-peak / $0.006 peak; input cache-miss $0.15 off-peak / $0.30 peak; output $0.60 off-peak / $1.20 peak. Peak window = 01:00–04:00 and 06:00–10:00 UTC Mon–Fri (excl. Chinese holidays); off-peak = everything else, including all weekends. 1M context, 384K max output. VERIFIED — https://api-docs.deepseek.com/quick_start/pricing (fetched 2026-09-20).
- Current Claude API pricing per 1M tokens: Opus 5 — $5 in / $25 out / $0.50 cached-read; Sonnet 5 — $2 in / $10 out / $0.20 cached-read; Haiku 4.5 — $1 in / $5 out / $0.10 cached-read. VERIFIED — https://claude.com/pricing (fetched 2026-09-20). No published flat per-token price was found for Fable — it is billed through usage credits on subscription plans, not the standard API price table, so it cannot be cost-modeled the same way as Opus/Sonnet/Haiku. UNVERIFIED (absence, not a negative claim) as of this fetch.
- `claude-ds` (the user's own DeepSeek-via-Claude-binary wrapper) contract, already established practice: `claude-ds -p "<self-contained task: files, acceptance criteria, verify command>" --permission-mode bypassPermissions --strict-mcp-config --output-format json`, run in a dedicated git branch/worktree, diff reviewed and tests rerun by a separate pass before merge. Source: user's own global CLAUDE.md (primary, not a web source; not independently re-verified this session).

## 3. Options / comparison

| Concern | Option A | Option B | Recommendation |
|---|---|---|---|
| Worktree isolation | `claude-squad` (tmux TUI, human-attended, 8.5k★) | `worktrunk` (scriptable CLI, no TUI required, 8.1k★, purpose-built "for parallel AI agent workflows") | **worktrunk** for the unattended ralph loop; claude-squad optionally for Logan's own manual debugging/supervision sessions |
| Loop engine | Bare `ralph-loop` plugin (re-feed PROMPT.md, `--max-iterations`, completion-promise) | OMC's `ralph` skill (PRD/story-driven, tiered reviewer, mandatory deslop+regression gate) | **OMC `ralph` skill** as the loop; it already implements ~80% of this spec (story tracking, tiered routing, review gate). Add a DeepSeek delegation tier to Step 3. |
| Top-tier model in the loop | `fable` (newest, most capable, usage-credit billed, silent billing in headless mode) | `opus` (fixed API/subscription pricing, no silent-billing gap) | **`opus`** for any headless/build-loop step; reserve `fable` for interactive planning sessions Logan is present for |
| Mechanical/bulk implementation | Sonnet | DeepSeek V4.1 Flash via `claude-ds` | **DeepSeek** for fully-specified, bounded-diff tasks (near-zero marginal cost); Sonnet for anything needing judgment |

## 4. Recommendation for omnis

**Architecture.** Run the omnis build as the OMC `ralph` skill against a `prd.json` that Fable (interactive, Logan-attended, one session at the start of each work block) refines from the plan docs into concrete stories. Each story gets a fourth field beyond OMC's default schema: `assignedTier: deepseek | haiku | sonnet | opus`. Add DeepSeek as a new delegation branch in the skill's Step 3, invoked as a subprocess (`claude-ds -p ...`) rather than a Claude Code subagent, since DeepSeek isn't a Claude Code model alias — everything else (Haiku/Sonnet/Opus) stays as native subagent `Task()` calls with `model=`.

**Task template** (extends the PRD story format the `ralph` skill already writes):
```json
{
  "id": "US-014",
  "title": "Nightly digest: group archived threads by sender",
  "files": ["apps/api/src/digest/grouping.ts", "apps/api/src/digest/grouping.test.ts"],
  "acceptanceCriteria": [
    "groupBySender() returns Map<senderId, Thread[]> sorted by thread count desc",
    "npm test -- digest/grouping passes"
  ],
  "verifyCommand": "npm test -- digest/grouping",
  "assignedTier": "deepseek",
  "worktree": "omnis/.worktrees/US-014",
  "branch": "ralph/US-014",
  "passes": false
}
```

**Model routing per task class.**
- **DeepSeek (claude-ds):** spec fully determined, single-module diff, no cross-cutting architecture decision, has an automatable verify command (test/build/lint). This is most CRUD, UI components from an existing design-token spec, boilerplate migrations, test-writing for already-implemented code.
- **Haiku:** trivial lookups, renames, single-file fixes, doc updates.
- **Sonnet:** standard feature work needing judgment, all diff review (implementer/reviewer split, never self-approved), memory-consolidation logic, cross-agent orchestration code.
- **Opus:** architecture decisions, security-sensitive paths (auth, PII handling for the inbox/memory layer), THOROUGH-tier review on >20-file or security diffs, unsticking a story that failed 2+ times at a lower tier.
- **Fable:** planning/PRD-refinement only, run interactively so the usage-credit consent prompt actually fires. Never the default headless build worker — this matches both the ToS-adjacent silent-billing risk found this session and Logan's own brief: "절대 fable로 모든 일들을 다 처리하려고 하지마." ("Never try to handle every piece of work with fable.")

**Review and verification gates.** Keep OMC ralph's existing structure as-is: implementer → fresh verify-command evidence → mark `passes:true` → tiered reviewer (Sonnet floor, Opus for risky) in a *separate* context → mandatory deslop pass on the changed-file set → regression re-run → merge. Add one DeepSeek-specific rule: a DeepSeek diff is never self-merged and never reviewed by DeepSeek — Sonnet reviews every DeepSeek diff at minimum, matching the existing `claude-ds` practice already in the user's CLAUDE.md.

**Worktree/branch strategy.** One `worktrunk`-managed worktree per in-flight story (`omnis/.worktrees/<story-id>` on branch `ralph/<story-id>`), so parallel DeepSeek/Sonnet/Haiku task runners never collide. The orchestrator (Opus, in the main worktree) merges each approved branch back sequentially after its review+verify gate, deletes the worktree, then unblocks dependent stories. Reserve claude-squad's tmux TUI for when Logan wants to watch/steer sessions by hand — not for the unattended loop.

**Failure and retry policy.** Borrow ghuntley's own guardrails: max 3 attempts per story at its assigned tier before auto-escalating one tier (DeepSeek→Sonnet→Opus, never silently to Fable), a hard `--max-iterations` wall-clock cap per ralph run (official plugin already supports this), and `git reset --hard` to the last merged-and-verified commit if a loop iteration leaves the tree broken. The completion-promise gate stays strict: only fires when every PRD story is `passes:true` *and* reviewer-verified.

**Per-phase token budget.** Planning (Fable, interactive): unbounded but consent-gated — Logan approves usage-credit spend in the moment, so this is self-limiting. Build (headless ralph loop): explicitly exclude `fable` from the model pool; route Opus/Sonnet/Haiku through the already-owned Max subscription via the unmodified `claude` binary (ordinary-use ToS carve-out, $0 marginal — but watch for "ordinary individual use" drift under sustained automation, see Open Questions), and DeepSeek through the separate API key at ~$0.003–0.15 in / $0.60 out per MTok off-peak. This build-time spend is additive to, and separate from, the ~$20–50/month runtime-inference estimate already modeled in `12-cost-optimization.md` — that number covers omnis *serving* Logan, not omnis *building itself*.

**Effort: M** — everything load-bearing exists locally (ralph skill, worktrunk, claude-ds contract); the work is wiring a DeepSeek branch into ralph's Step 3, a worktrunk wrapper, and `assignedTier`/`verifyCommand` on the PRD schema.

**Risk.** ToS: low if the boundary stays literal — unmodified `claude`/`claude-ds` binaries as subprocesses, `fable` excluded from headless runs, no OAuth-token harvesting. Account-ban: low–medium — "ordinary individual use" has no published usage threshold, so sustained near-24/7 scripted looping is a genuinely unresolved risk. Maintenance: medium — ralph loops drift and burn tokens unsupervised (ghuntley's own warning), so the max-iteration cap and human checkpoint are load-bearing, not optional.

## 5. What to borrow

- **oh-my-claudecode `ralph` skill** — `/Users/logankim/.claude/plugins/cache/omc/oh-my-claudecode/4.14.5/skills/ralph/SKILL.md` — the entire PRD/story/tiered-reviewer/deslop/regression structure. This should *be* the omnis build loop, not a reference for building a new one.
- **Official `ralph-loop` plugin** — `/Users/logankim/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/commands/ralph-loop.md` and `scripts/setup-ralph-loop.sh` — for the bare `--max-iterations` / completion-promise wall-clock cap mechanism if OMC's skill needs a harder outer bound.
- **Ghuntley's three-file stack** (`PROMPT.md`, `@fix_plan.md`, `@specs/`) — https://ghuntley.com/ralph/ — the "one item per loop, narrow down when it goes off the rails" discipline is worth encoding as an explicit rule in the PRD-refinement step, since OMC's skill doesn't currently say this in so many words.
- **`worktrunk`** — https://github.com/max-sixty/worktrunk — for the actual worktree-per-story mechanism in the headless loop.
- **`claude-squad`** — https://github.com/smtg-ai/claude-squad — for Logan's own interactive multi-session supervision, not the automated loop.
- **Claude Code's native `model: fable|opus|sonnet|haiku|inherit` subagent field** — https://code.claude.com/docs/en/sub-agents — use this directly for in-session tier routing instead of hand-rolling a router; only DeepSeek needs an out-of-band subprocess call since it isn't a Claude Code alias.

## 6. Open questions

- Does sustained, scripted, near-24/7 ralph-loop usage on a Max plan still count as "ordinary individual use" under the ToS, or does it need Anthropic's explicit sign-off at some usage threshold? Not resolved by any fetched doc.
- Is Fable reachable via a plain Console API key with fixed per-token pricing, or only via subscription plans with usage-credit billing? If API-key-only-never, it can't be used in the headless pipeline at all regardless of the consent-prompt issue; if API-key-available, it might be safely usable in `-p` mode with a hard budget cap instead of being excluded outright.
- Does `claude-ds`'s Anthropic-compatible endpoint preserve DeepSeek's cache-hit/cache-miss token accounting the same way the raw DeepSeek API does? This affects whether the $0.003/$0.15/$0.60 per-MTok estimate holds at claude-ds scale.
- worktrunk vs. claude-squad is a same-week trending-repo choice (both <1 month of heavy traction visible) — needs a hands-on trial run against the actual omnis repo before locking in, not just a feature comparison.
- Where should the DeepSeek-vs-Sonnet routing threshold (LOC/complexity heuristic) actually sit? Needs calibration against 10–20 real omnis stories, not a theoretical rule.
- How does progress surface into omnis's own agent-session inbox threads before those threads exist? This report assumes the `stream-json`/`app-server` event bridge already designed in `09-agents-as-inbox.md`, but that bridge itself is still a design, not a built thing — sequencing risk if GAP 5's pipeline is needed before GAP 9's bridge is real.

## 7. Sources

- [The Ralph Technique](https://ghuntley.com/ralph/) — fetched 2026-09-20
- [Claude Code — Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) — fetched 2026-09-20
- [Claude Code — Sub-agents](https://code.claude.com/docs/en/sub-agents) — fetched 2026-09-20
- [Claude Code — Model configuration](https://code.claude.com/docs/en/model-config) — fetched 2026-09-20
- [Claude API Pricing](https://claude.com/pricing) — fetched 2026-09-20
- [DeepSeek API Pricing](https://api-docs.deepseek.com/quick_start/pricing) — fetched 2026-09-20
- [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad) — fetched 2026-09-20 (`gh repo view`)
- [max-sixty/worktrunk](https://github.com/max-sixty/worktrunk) — fetched 2026-09-20 (`gh repo view` + web)
- Local primary sources (read 2026-09-20): `~/.claude/plugins/cache/omc/oh-my-claudecode/4.14.5/skills/ralph/SKILL.md`; `~/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/commands/ralph-loop.md`; user's global `~/.claude/CLAUDE.md` (`claude-ds` contract)
- Reused/cross-confirmed from this project's own prior research: `/Users/logankim/AI-Workspaces/Claude/omnis/research/09-agents-as-inbox.md` (claude-squad worktree isolation), `/Users/logankim/AI-Workspaces/Claude/omnis/research/12-cost-optimization.md` (Anthropic ToS quote, DeepSeek/Claude pricing baseline)
