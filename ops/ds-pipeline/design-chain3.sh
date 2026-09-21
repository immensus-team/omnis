#!/bin/bash
export PATH=/opt/homebrew/bin:$PATH; D=$HOME/AI-Workspaces/Claude/omnis/ds; WT=$HOME/AI-Workspaces/omnis.plan-design-w1
: > "$D/logs/design-D6fix.issues"
"$D/run-task4.sh" "$WT" "$D/tasks/design-D6fix.md" 2 || { echo "CHAIN design stopped at D6fix"; exit 1; }
"$D/run-task4.sh" "$WT" "$D/tasks/design-D5.md" 3 || echo "CHAIN design: D5 not approved after 3 attempts — merging what is approved"
echo "CHAIN design: merging"
cd $HOME/AI-Workspaces/omnis && gtimeout 3600 claude-ds -p "$(cat $D/COMMON.md)

$(cat $D/tasks/design-merge.md)
Also push immensus main after origin (git push immensus main). Merge ONLY up to the last APPROVED commit (see $D/logs/design-chain.log RESULT lines) — if D5 was not approved, merge the D6fix-approved sha instead of the branch tip." --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$D/logs/design-merge.json" 2> "$D/logs/design-merge.err"
echo "CHAIN design: merge exit=$? main=$(git log -1 --format=%h)"
