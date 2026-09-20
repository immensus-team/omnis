# worktrunk confirmed usage (A7-D5, evidence from the gate-14 dry run)

- Binary name: `wt` (the brew formula name is `worktrunk`, but the executable installed on PATH is `wt`). `which worktrunk` → not found, `which wt` → `/opt/homebrew/bin/wt`.
- Worktree creation: `wt switch --create <branch> -y --no-cd` → the worktree is created not at `.worktrees/<story-id>` but in worktrunk's default sibling layout `<repo-dir>.<branch-with-/-as-->` (e.g. repo `omnis` + branch `ralph/<story-id>` → `omnis.ralph-<story-id>`) (confirmed by gate-14).
- Worktree removal: `wt remove <branch> -y` (it takes a branch name, not a story ID). Removal happens asynchronously in the background, but the follow-up `test ! -d` passed immediately (if a race is a concern, `--foreground` switches it to blocking).
- The "immediately before starting a story" step of the ralph loop (A7 §3) uses these two commands as-is. A7-D5's "UNVERIFIED — spike" marking is resolved by this document.
- A7-D5's fallback rule ("fail → plain `git worktree add`/`remove`") does not trigger — gate-14 PASS.
- Reproduction evidence: `tools/spikes/gate-14-worktrunk-dryrun/result.md`, `run.log`.
