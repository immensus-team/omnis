#!/bin/bash
export PATH=/opt/homebrew/bin:$PATH; D=$HOME/AI-Workspaces/Claude/omnis/ds
"$D/run-task.sh" "$HOME/AI-Workspaces/omnis.plan-w4a-cost" "$D/tasks/w4a-cost-finalize.md" 2 || echo "CHAIN w4a: cost NOT approved — merging the three approved branches only"
cd $HOME/AI-Workspaces/omnis && gtimeout 3600 claude-ds -p "$(cat $D/COMMON.md)

$(cat $D/tasks/w4a-merge.md)
$( [ -s $D/logs/w4a-cost-finalize.issues ] && echo 'NOTE: plan/w4a-cost was NOT approved — skip it; merge only search, transcript, settings.' )" --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$D/logs/w4a-merge.json" 2> "$D/logs/w4a-merge.err"
echo "CHAIN w4a: merge exit=$? main=$(git log -1 --format=%h)"
