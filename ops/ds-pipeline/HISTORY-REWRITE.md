# TOP PRIORITY — purge personal identifiers from git history

**Why this is now urgent:** `immensus-team/omnis` went PUBLIC on 2026-09-21. Everything below is
readable by anyone, in the working tree AND in all 553 commits.

**Run this only AFTER** the design chain finishes and every `omnis.plan-*` worktree is merged and
removed. A history rewrite invalidates every worktree, branch and open chain.

## What to replace

| Target | Now | Replace with | Where |
| --- | --- | --- | --- |
| Author + committer email | `281932556+jinhologankim@users.noreply.github.com` | `281932556+jinhologankim@users.noreply.github.com` | 551 of 553 commits |
| Same email in file contents | `281932556+jinhologankim@users.noreply.github.com` | the same noreply address | 66 tracked files |
| Tailnet host | `your-hub.your-tailnet.ts.net` | `your-hub.your-tailnet.ts.net` | 5 occurrences |
| Mini IP | `<hub-user>@<hub-host>` / `<hub-host>` | `<hub-user>@<hub-host>` / `<hub-host>` | 8 occurrences |

Leave `vigor@127.0.0.1` alone — it is a local Postgres user, not an address.

## How

```bash
brew install git-filter-repo          # not installed yet

# stop new commits from reintroducing it, first
cd ~/AI-Workspaces/omnis
git config user.email "281932556+jinhologankim@users.noreply.github.com"

# author/committer rewrite
printf 'jinho k. <281932556+jinhologankim@users.noreply.github.com> <281932556+jinhologankim@users.noreply.github.com>\n' > /tmp/mailmap

# content rewrite
cat > /tmp/replacements <<'R'
281932556+jinhologankim@users.noreply.github.com==>281932556+jinhologankim@users.noreply.github.com
your-hub.your-tailnet.ts.net==>your-hub.your-tailnet.ts.net
<hub-user>@<hub-host>==><hub-user>@<hub-host>
<hub-host>==><hub-host>
R

git filter-repo --mailmap /tmp/mailmap --replace-text /tmp/replacements
```

`git filter-repo` drops the remotes; re-add both and force-push:

```bash
git remote add origin   https://github.com/Onword-Lab/omnis.git
git remote add immensus https://github.com/immensus-team/omnis.git
git push --force origin main && git push --force immensus main
```

## Verify

```bash
git log --format='%ae %ce' | sort -u                    # only the noreply address
git log -p --all | grep -c 'jinhologan\.kim@gmail\.com' # 0
git log -p --all | grep -c 'your-tailnet'                 # 0
pnpm typecheck && pnpm lint && pnpm test                # tree still green
```

## Caveat to tell Logan

The repo was public during the window, so any clone or fork taken in that time keeps the old
history, and GitHub serves old commits by SHA for a while even after a force-push. If that matters,
the clean options are GitHub Support (purge cached views) or delete-and-recreate the repo.
