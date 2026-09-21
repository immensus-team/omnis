#!/bin/bash
export PATH=/opt/homebrew/bin:$PATH; D=$HOME/AI-Workspaces/Claude/omnis/ds; WT=$HOME/AI-Workspaces/omnis.plan-design-w2
echo "CHAIN design2: waiting for design wave 1 merge"
until grep -q "CHAIN design: merge exit" "$D/logs/design-chain.log" 2>/dev/null; do sleep 60; done
cd $HOME/AI-Workspaces/omnis && git pull -q --ff-only origin main && (git worktree list | grep -q "omnis.plan-design-w2 " || wt switch --create plan/design-w2 -y --no-cd >/dev/null) && cd "$WT" && pnpm install >/dev/null 2>&1; createdb omnis_test_design_w2 2>/dev/null; DATABASE_URL=postgres://logankim@127.0.0.1:5432/omnis_test_design_w2 pnpm db:migrate >/dev/null 2>&1
echo "CHAIN design2: start on $(git log -1 --format=%h)"
for t in D7 D8 D9 D10; do "$D/run-task4.sh" "$WT" "$D/tasks/design2-$t.md" 3 || { echo "CHAIN design2 stopped at $t"; exit 1; }; done
echo "CHAIN design2: all approved; merging"
cd $HOME/AI-Workspaces/omnis && gtimeout 3600 claude-ds -p "$(cat $D/COMMON.md)

$(cat $D/tasks/design2-merge.md)" --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$D/logs/design2-merge.json" 2> "$D/logs/design2-merge.err"
echo "CHAIN design2: merge exit=$? main=$(git log -1 --format=%h)"
