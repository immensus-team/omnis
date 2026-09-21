#!/bin/bash
export PATH=/opt/homebrew/bin:$PATH; D=$HOME/AI-Workspaces/Claude/omnis/ds; WT=$HOME/AI-Workspaces/omnis.plan-w4b
echo "CHAIN w4b: waiting for design wave 1 merge"
until grep -q "CHAIN design: merge exit" "$D/logs/design-chain.log" 2>/dev/null; do sleep 60; done
cd $HOME/AI-Workspaces/omnis && git pull -q --ff-only origin main; (git worktree list | grep -q "omnis.plan-w4b " || wt switch --create plan/w4b -y --no-cd >/dev/null); cd "$WT" && pnpm install >/dev/null 2>&1; createdb omnis_test_w4b 2>/dev/null; DATABASE_URL=postgres://logankim@127.0.0.1:5432/omnis_test_w4b pnpm db:migrate >/dev/null 2>&1
echo "CHAIN w4b: start on $(git log -1 --format=%h)"
for n in 2 3 4 5 6 7 8 9 10; do "$D/run-task4.sh" "$WT" "$D/tasks/w4b-T$n.md" 3 || echo "CHAIN w4b: T$n NOT approved after 3 attempts — continuing"; done
echo "CHAIN w4b: tasks done; merging"
cd $HOME/AI-Workspaces/omnis && gtimeout 3600 claude-ds -p "$(cat $D/COMMON.md)

$(cat $D/tasks/w4b-merge.md)" --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$D/logs/w4b-merge.json" 2> "$D/logs/w4b-merge.err"
echo "CHAIN w4b: merge exit=$? main=$(git log -1 --format=%h)"
