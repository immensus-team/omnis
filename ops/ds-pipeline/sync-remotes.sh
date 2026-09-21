#!/bin/bash
# keep origin and immensus main identical; merge Logan's web edits from immensus into main
export PATH=/opt/homebrew/bin:$PATH; R=$HOME/AI-Workspaces/omnis; L=$HOME/AI-Workspaces/Claude/omnis/ds/logs/publish.log
while true; do
  cd "$R" && git fetch -q origin && git fetch -q immensus 2>/dev/null
  if [ -z "$(git status --porcelain)" ]; then
    git merge -q --ff-only origin/main 2>/dev/null
    if ! git merge-base --is-ancestor immensus/main HEAD; then git merge -q --no-edit immensus/main 2>>"$L" && echo "[$(date +%H:%M)] SYNC merged immensus/main (web edit)" >> "$L"; fi
    [ "$(git rev-parse origin/main)" != "$(git rev-parse HEAD)" ] && git push -q origin main 2>>"$L"
    [ "$(git rev-parse immensus/main)" != "$(git rev-parse HEAD)" ] && git push -q immensus main 2>>"$L" && echo "[$(date +%H:%M)] SYNC pushed immensus $(git rev-parse --short HEAD)" >> "$L"
  fi
  sleep 180
done
