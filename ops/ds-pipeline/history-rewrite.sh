#!/bin/bash
# Purge personal identifiers from omnis history (ds/HISTORY-REWRITE.md). Refuses to run while worktrees exist.
set -e; export PATH=/opt/homebrew/bin:$PATH; R=$HOME/AI-Workspaces/omnis; L=$HOME/AI-Workspaces/Claude/omnis/ds/logs/history-rewrite.log
cd "$R"
[ "$(git worktree list | wc -l | tr -d ' ')" = "1" ] || { echo "REWRITE ABORT: worktrees still exist" | tee -a "$L"; git worktree list | tee -a "$L"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "REWRITE ABORT: dirty tree" | tee -a "$L"; exit 1; }
git fetch -q origin && git fetch -q immensus && git merge -q --ff-only origin/main && git merge -q --no-edit immensus/main 2>/dev/null || true
git push -q origin main && git push -q immensus main
BEFORE=$(git rev-parse --short HEAD); echo "[$(date +%H:%M)] REWRITE start at $BEFORE, $(git rev-list --count HEAD) commits" | tee -a "$L"
cp -R "$R/.git" "$HOME/AI-Workspaces/_omnis-git-backup-$(date +%Y%m%d-%H%M)"   # backup of the old history
printf 'jinho k. <281932556+jinhologankim@users.noreply.github.com> <281932556+jinhologankim@users.noreply.github.com>\n' > /tmp/omnis-mailmap
cat > /tmp/omnis-replacements <<'R'
281932556+jinhologankim@users.noreply.github.com==>281932556+jinhologankim@users.noreply.github.com
your-hub.your-tailnet.ts.net==>your-hub.your-tailnet.ts.net
<hub-user>@<hub-host>==><hub-user>@<hub-host>
<hub-host>==><hub-host>
R
git filter-repo --force --mailmap /tmp/omnis-mailmap --replace-text /tmp/omnis-replacements
git remote add origin https://github.com/Onword-Lab/omnis.git 2>/dev/null || true
git remote add immensus https://github.com/immensus-team/omnis.git 2>/dev/null || true
E=$(git log --format='%ae %ce' | tr ' ' '\n' | sort -u | tr '\n' ' '); A=$(git log -p --all | grep -c 'jinhologan\.kim@gmail\.com' || true); T=$(git log -p --all | grep -c 'your-tailnet' || true); I=$(git log -p --all | grep -c '100\.73\.157\.31' || true)
echo "[$(date +%H:%M)] REWRITE verify emails=[$E] gmail_hits=$A tailnet_hits=$T ip_hits=$I" | tee -a "$L"
[ "$A" = "0" ] && [ "$T" = "0" ] && [ "$I" = "0" ] || { echo "REWRITE ABORT: residue found, not pushing" | tee -a "$L"; exit 1; }
PGUSER=logankim DATABASE_URL=postgres://logankim@127.0.0.1:5432/omnis_test bash -c 'pnpm install --frozen-lockfile >/dev/null 2>&1; pnpm typecheck >/dev/null 2>&1 && pnpm lint >/dev/null 2>&1 && pnpm test >/dev/null 2>&1' && echo "[$(date +%H:%M)] REWRITE gates green" | tee -a "$L" || { echo "REWRITE ABORT: gates red after rewrite" | tee -a "$L"; exit 1; }
git push --force -q origin main && git push --force -q immensus main && echo "[$(date +%H:%M)] REWRITE DONE: force-pushed $(git rev-parse --short HEAD) to origin + immensus (was $BEFORE)" | tee -a "$L"
