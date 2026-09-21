#!/bin/bash
# Watches every *.chain.log for approved results and publishes each approved commit to main immediately.
D=$HOME/AI-Workspaces/Claude/omnis/ds; S=$D/logs/published.txt; touch "$S"
while true; do
  grep -h -o "RESULT [A-Za-z0-9_-]* APPROVED attempt=[0-9]* head=[0-9a-f]*" $D/logs/*chain.log 2>/dev/null | while read -r _ name _ _ head; do
    sha=${head#head=}; grep -q "$sha" "$S" && continue
    "$D/publish.sh" "$sha" "$name" && echo "$sha $name" >> "$S" || echo "$sha $name FAILED" >> "$S"
  done
  sleep 60
done
