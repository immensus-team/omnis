#!/bin/bash
# publish.sh <sha> <label> — merge an approved commit into main, gate, push to origin + immensus
export PATH=/opt/homebrew/bin:$PATH; SHA="$1"; LABEL="$2"; R=$HOME/AI-Workspaces/omnis; L=$HOME/AI-Workspaces/Claude/omnis/ds/logs/publish.log
cd "$R" || exit 2
git pull -q --ff-only origin main || { echo "[$(date +%H:%M)] PUBLISH $LABEL: pull failed" >> "$L"; exit 1; }
if git merge-base --is-ancestor "$SHA" HEAD; then echo "[$(date +%H:%M)] PUBLISH $LABEL: $SHA already on main" >> "$L"; exit 0; fi
if ! git merge --no-ff -q "$SHA" -m "merge: $LABEL ($SHA)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" 2>>"$L"; then git merge --abort; echo "[$(date +%H:%M)] PUBLISH $LABEL: CONFLICT merging $SHA — left for the chain's merge step" >> "$L"; exit 1; fi
gate() { PGUSER=logankim DATABASE_URL=postgres://logankim@127.0.0.1:5432/omnis_test_publish bash -c 'createdb omnis_test_publish 2>/dev/null; pnpm install --frozen-lockfile >/dev/null 2>&1; pnpm db:migrate >/dev/null 2>&1; pnpm typecheck >/dev/null 2>&1 && pnpm lint >/dev/null 2>&1 && pnpm test >/dev/null 2>&1'; }
if gate || { sleep 60; gate; }; then
  git rev-parse HEAD > $HOME/AI-Workspaces/Claude/omnis/ds/logs/verified-head; git push -q origin main && git push -q immensus main && echo "[$(date +%H:%M)] PUBLISH $LABEL: merged $SHA → main $(git log -1 --format=%h), pushed origin+immensus" >> "$L"
else
  git reset -q --hard origin/main; echo "[$(date +%H:%M)] PUBLISH $LABEL: GATE FAILED on merge of $SHA — reset, not pushed" >> "$L"; exit 1
fi
