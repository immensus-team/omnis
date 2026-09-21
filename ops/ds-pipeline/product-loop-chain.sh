#!/bin/bash
# Product loop round N: Opus tests as the user → Opus plans backlog → DeepSeek implements each item (Opus review) → Opus verifies → DeepSeek merges.
export PATH=/opt/homebrew/bin:$PATH; D=$HOME/AI-Workspaces/Claude/omnis/ds; R=${1:-1}; FOCUS="${2:-general usability}"; WT=$HOME/AI-Workspaces/omnis.plan-loop-r$R; LOOP=docs/design/loop/r$R
UNSET=$(env | grep -E '^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|MCP_)' | cut -d= -f1 | sed 's/^/-u /' | tr '\n' ' ')
opus() { gtimeout 3000 env $UNSET claude --model claude-opus-5 -p "$1" --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$2" 2> "$2.err"; }
echo "CHAIN loop-r$R: waiting for design wave 2 merge"
until grep -q "CHAIN design2: merge exit" "$D/logs/design2-chain.log" 2>/dev/null; do sleep 60; done
cd $HOME/AI-Workspaces/omnis && git pull -q --ff-only origin main; (git worktree list | grep -q "omnis.plan-loop-r$R " || wt switch --create plan/loop-r$R -y --no-cd >/dev/null); cd "$WT" && pnpm install >/dev/null 2>&1; createdb omnis_test_loop_r$R 2>/dev/null; DATABASE_URL=postgres://logankim@127.0.0.1:5432/omnis_test_loop_r$R pnpm db:migrate >/dev/null 2>&1; mkdir -p $LOOP
echo "CHAIN loop-r$R: start on $(git log -1 --format=%h)"
COMMON="$(cat $D/COMMON.md)"
SCEN="Scenarios (each at 1440×900 AND 390×844): S1 morning triage — read AI summaries, archive 3 threads keyboard-only, undo one; S2 rail channels + all/work/personal/agents/needs-approval tabs, add/remove a label chip, drag-reorder two rail icons; S3 open a Slack thread, draft a reply via the AI panel, see where it goes; S4 open an agent session, follow tool calls/cost/state, approve or reject a pending approval; S5 ⌘K: search a person, jump to a thread, run a command; S6 Today, Tasks, Network, Notes, Digest, Settings screens — do one real action in each; S7 archived view: find and unarchive; S8 iPhone width: bottom bar, sheet, ask bar, PWA shell; S9 resize 1440→390 continuously and note anything that wraps/overflows/jumps; S10 keyboard-only navigation; S11 collapse/expand and drag-resize the detail pane; S12 empty/loading/error states. For every friction point record: id, screen, width, severity (blocker/major/minor/polish), expected vs actual, exact repro, screenshot path, proposed fix (files)."
for P in logan newcomer; do
  WHO="You are Logan, founder of a small AI studio: 80 Slack/Gmail/KakaoTalk threads a day, three coding agents running, impatient, keyboard-first."; [ $P = newcomer ] && WHO="You are a first-day user who just connected Slack and Gmail: you do not know shortcuts, you read every label, you get lost easily, you use the mouse, and you judge polish against Apple Mail, Superhuman and Linear."
  opus "$COMMON

# ROLE: REAL USER TEST (Opus, verification role). $WHO Worktree $WT (branch plan/loop-r$R, DB omnis_test_loop_r$R). Boot the seeded app with Playwright (tools/e2e run.ts/seed.ts/shots.ts pattern) and actually USE it. Round focus: $FOCUS. $SCEN Save screenshots under $LOOP/test-$P/ and write $LOOP/findings-$P.md (table + one section per finding); be concrete and harsh; polish counts. Commit findings + screenshots ('loop r$R: user test $P') with the trailers (Implemented-by: Claude Opus)." "$D/logs/loop-r$R-test-$P.json" &
done; wait
echo "CHAIN loop-r$R: user tests done"
opus "$COMMON

# ROLE: PRODUCT PLANNER (Opus). Worktree $WT. Read $LOOP/findings-logan.md, $LOOP/findings-newcomer.md, the adoption list /Users/logankim/AI-Workspaces/Claude/omnis/research/ux/00-ADOPTION-LIST.md, docs/design/DESIGN-DIRECTION-v3.md, docs/design/POLISH-LOG.md and $D/FOLLOWUPS.md. Round focus: $FOCUS. Produce 6–8 items a DeepSeek implementer can each finish in ≤45 min, ordered by user impact (blockers/majors first, then adoption-list items matching the focus; include the FOLLOWUPS 'system → omnis channel rename' if it fits). Write $LOOP/BACKLOG.md AND one task file per item at $D/tasks/loop-r$R-NN.md (NN = 01..08) in this exact shape: '# <id>: <title>' newline, 'Worktree: $WT (branch plan/loop-r$R). Per-branch DB: omnis_test_loop_r$R.' newline, a self-contained brief (exact files/components, exact behavior, English copy, states, keyboard, motion timing, reduced-motion, which reference image/URL to look at), newline, 'Acceptance:' with a Playwright/RTL check and screenshots docs/design/loop/r$R/impl/<id>/{1440,390}.png, newline, 'Commit \"<id>: <title>\" with the trailers.' Also write $D/tasks/loop-r$R.list with the task file paths in order. Commit BACKLOG.md ('loop r$R: backlog')." "$D/logs/loop-r$R-plan.json"
echo "CHAIN loop-r$R: backlog written: $(wc -l < $D/tasks/loop-r$R.list 2>/dev/null) items"
while read -r T; do [ -f "$T" ] && "$D/run-task4.sh" "$WT" "$T" 3 || echo "CHAIN loop-r$R: $(basename $T) not approved"; done < "$D/tasks/loop-r$R.list"
opus "$COMMON

# ROLE: VERIFY AS THE USER (Opus). Worktree $WT. Re-run every finding in $LOOP/findings-*.md at its width and mark fixed / still open / regressed; re-run S9 (continuous resize) and S10 (keyboard-only) fully; note NEW findings. Write $LOOP/REPORT.md with before/after screenshot pairs, the findings table with status, the items merged, and 'Next round suggestions' (≤8, prioritized). Commit ('loop r$R: report') with the trailers." "$D/logs/loop-r$R-verify.json"
echo "CHAIN loop-r$R: verified; merging"
cd $HOME/AI-Workspaces/omnis && gtimeout 3600 claude-ds -p "$COMMON

# Merge plan/loop-r$R into main: git pull -q --ff-only origin main && git merge --no-ff plan/loop-r$R -m 'merge: plan/loop-r$R (product loop round $R)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>'; resolve conflicts keeping both; then with DATABASE_URL=postgres://logankim@127.0.0.1:5432/omnis_test: pnpm install && pnpm db:migrate && pnpm typecheck && pnpm lint && pnpm test; then pnpm e2e:phase-a (commit refreshed evidence 'e2e: refresh after loop r$R'); fix failures with minimal 'fix: post-merge — …' commits; push origin main and immensus main; redeploy the Mac mini per ops/mini/RUNBOOK.md and verify /health; remove the worktree and drop omnis_test_loop_r$R. Print main sha, tests, e2e, mini." --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$D/logs/loop-r$R-merge.json" 2> "$D/logs/loop-r$R-merge.err"
echo "CHAIN loop-r$R: merge exit=$? main=$(git log -1 --format=%h)"
