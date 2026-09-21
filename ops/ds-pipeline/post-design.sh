#!/bin/bash
# After design wave 1 merges: history rewrite (needs ds/GO-REWRITE from Logan), then start design wave 2 + W4b.
export PATH=/opt/homebrew/bin:$PATH; D=$HOME/AI-Workspaces/Claude/omnis/ds
until grep -q "CHAIN design: merge exit" "$D/logs/design-chain.log" 2>/dev/null; do sleep 60; done
echo "POST-DESIGN: design wave 1 merged; waiting for GO-REWRITE"
until [ -f "$D/GO-REWRITE" ]; do sleep 30; done
cd $HOME/AI-Workspaces/omnis && git worktree prune && git worktree list
"$D/history-rewrite.sh" && echo "POST-DESIGN: rewrite ok" || echo "POST-DESIGN: rewrite FAILED — chains NOT started"
grep -q "REWRITE DONE" "$D/logs/history-rewrite.log" || exit 1
cd "$D" && (nohup bash -c './design2-chain.sh 2>&1 | tee -a logs/design2-chain.log' >/dev/null 2>&1 &) && (nohup bash -c './w4b-chain.sh 2>&1 | tee -a logs/w4b-chain.log' >/dev/null 2>&1 &)
echo "POST-DESIGN: design2 + w4b chains started"
