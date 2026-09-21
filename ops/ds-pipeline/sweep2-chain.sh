#!/bin/bash
export PATH=/opt/homebrew/bin:$PATH; D=$HOME/AI-Workspaces/Claude/omnis/ds; W=$HOME/AI-Workspaces
pids=()
for s in en2-kernel en2-agents en2-adapters en2-hubtools w5-registry; do "$D/run-task.sh" "$W/omnis.plan-$s" "$D/tasks/$s.md" 3 > "$D/logs/$s.chain.log" 2>&1 & pids+=($!); done
for p in "${pids[@]}"; do wait $p; done
ok=""; for s in en2-kernel en2-agents en2-adapters en2-hubtools w5-registry; do grep -q "RESULT $s APPROVED" "$D/logs/$s.chain.log" && ok="$ok plan/$s" || echo "CHAIN sweep2: $s NOT approved"; done
echo "CHAIN sweep2: merging:$ok"
cd $W/omnis && gtimeout 3600 claude-ds -p "$(cat $D/COMMON.md)

# Merge into main, in this order:$ok
Repo /Users/logankim/AI-Workspaces/omnis. For each branch: \`git pull -q --ff-only origin main && git merge --no-ff <branch> -m \"merge: <branch> (English sweep 2 / W5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\"\`; conflicts: keep main's structural changes and translate any Korean they bring in; apps/hub/src/main.ts: keep both the registry wiring and any translated comments. Then with DATABASE_URL=postgres://logankim@127.0.0.1:5432/omnis_test: \`pnpm install && pnpm db:migrate && pnpm typecheck && pnpm lint && pnpm test\` and \`pnpm e2e:phase-a\` (commit refreshed evidence if changed). Fix failures with minimal 'fix: post-merge — …' commits. Report \`LC_ALL=en_US.UTF-8 git ls-files apps packages tools | grep -v /dist/ | xargs grep -l '[가-힣]' | wc -l\`. Push origin main. If plan/w5-registry merged: redeploy the Mac mini per ops/mini/RUNBOOK.md and verify https://your-hub.your-tailnet.ts.net/health. Remove the merged worktrees and drop their omnis_test_* DBs. Print main sha, tests, e2e, mini, notes." --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$D/logs/sweep2-merge.json" 2> "$D/logs/sweep2-merge.err"
echo "CHAIN sweep2: merge exit=$? main=$(git log -1 --format=%h)"
