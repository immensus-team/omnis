#!/bin/bash
export PATH=/opt/homebrew/bin:$PATH; D=$HOME/AI-Workspaces/Claude/omnis/ds; WT=$HOME/AI-Workspaces/omnis.plan-design-w2
"$D/run-task4.sh" "$WT" "$D/tasks/design2-D10.md" 2 || echo "CHAIN design2: D10 not approved after 2 more attempts — merging D7–D9 (+ D10 as-is is NOT included)"
echo "CHAIN design2: merging"
LAST=$(grep -o "RESULT design2-D10 APPROVED attempt=[0-9]* head=[0-9a-f]*" "$D/logs/design2-chain.log" | tail -1 | grep -o "head=[0-9a-f]*" | cut -d= -f2); [ -z "$LAST" ] && LAST=$(grep -o "RESULT design2-D9 APPROVED attempt=[0-9]* head=[0-9a-f]*" "$D/logs/design2-chain.log" | tail -1 | grep -o "head=[0-9a-f]*" | cut -d= -f2)
cd $HOME/AI-Workspaces/omnis && gtimeout 3600 claude-ds -p "$(cat $D/COMMON.md)

$(cat $D/tasks/design2-merge.md)
IMPORTANT: merge exactly commit $LAST (the last Opus-approved D-task head on plan/design-w2), not the branch tip, i.e. \`git merge --no-ff $LAST\`. Conflicts in apps/desktop/src/app.css, App.tsx, packages/ui: keep both sides (the W4b screens' additions AND the design wave's restyling) and re-run the affected tests + the responsive/overflow Playwright checks before committing. Push origin main and immensus main." --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$D/logs/design2-merge.json" 2> "$D/logs/design2-merge.err"
echo "CHAIN design2: merge exit=$? main=$(git log -1 --format=%h)"
