#!/bin/bash
export PATH=/opt/homebrew/bin:$PATH; D=$HOME/AI-Workspaces/Claude/omnis/ds; WT=$HOME/AI-Workspaces/omnis.plan-design-w1
for t in D2b D3 D4 D6 D5; do "$D/run-task3.sh" "$WT" "$D/tasks/design-$t.md" 3 || { echo "CHAIN design stopped at $t"; exit 1; }; done
echo "CHAIN design: all tasks approved; merging"
cd $HOME/AI-Workspaces/omnis && gtimeout 3600 claude-ds -p "$(cat $D/COMMON.md)

$(cat $D/tasks/design-merge.md)" --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$D/logs/design-merge.json" 2> "$D/logs/design-merge.err"
echo "CHAIN design: merge exit=$? main=$(git log -1 --format=%h)"
