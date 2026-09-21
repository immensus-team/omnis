#!/bin/bash
D=$HOME/AI-Workspaces/Claude/omnis/ds
until grep -q "RESULT jev-spike APPROVED" "$D/logs/jev-spike.chain.log" 2>/dev/null; do grep -q "RESULT jev-spike FAILED" "$D/logs/jev-spike.chain.log" 2>/dev/null && { echo "CHAIN jev: spike failed, not running the real eval"; exit 1; }; sleep 60; done
echo "CHAIN jev: spike approved, running the real eval"
"$D/run-task4.sh" "$HOME/AI-Workspaces/omnis.plan-jev" "$D/tasks/jev-real.md" 3
