# Gate ⑭: worktrunk dry run

- **Question**: Does a worktree create/remove round trip actually work with `worktrunk` (the exact subcommands and flags are what A7-D5 left UNVERIFIED).
- **Owning appendix**: A7 (§3 "worktrunk worktree isolation procedure")
- **Owner**: agent(unattended)
- **Host**: macbook
- **Run date**: 2026-09-20 (initial measurement: `tools/spikes/_probes/2026-09-20-cli-probes.md` "Gate ⑦(schema) and ⑭ evidence"; re-confirmed in this task against a scratch repo via `tools/spikes/gate-14-worktrunk-dryrun/run.sh`, see `run.log`)
- **Result (Pass/Fail)**: **PASS** — `create_pass=true`, `remove_pass=true`
- **Measurements/Evidence**:
  - The binary is `wt`, not `worktrunk` (the brew formula name is worktrunk, the executable name is `wt`). There is no `worktrunk` on PATH (`which worktrunk` → not found), `which wt` → `/opt/homebrew/bin/wt`.
  - **create**: `wt switch --create <branch> -y --no-cd` (A7-D5's assumption `worktrunk create <branch>` gets the subcommand name wrong — the correct answer is `switch --create`, short flag `-c`).
  - **remove**: `wt remove <branch> -y` (A7-D5's assumption `worktrunk remove <story-id>` is right in form, except that it takes a branch name rather than a story ID).
  - The worktree is created **not** at `.worktrees/<story-id>` but with worktrunk's default sibling layout `<repo-dir>.<branch-with-/-as-->` (e.g. repo `omnis` + branch `spike/wt-dryrun` → `omnis.spike-wt-dryrun`; this task's scratch repo `tmp.NonKOfblxr` + branch `spike/gate-14-dryrun` → `tmp.NonKOfblxr.spike-gate-14-dryrun`, greppable in `run.log`). This conclusion is already reflected in `docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` §"Branches·Commits": "worktrees use worktrunk's default sibling layout `~/AI-Workspaces/omnis.<branch>` (gate ⑭ measurement, `tools/spikes/_probes`)".
  - `wt remove` logs that it processes "in background" asynchronously (`◎ Removing ... worktree & branch in background`), yet the follow-up `test ! -d` passed immediately — at the script level it was observed to work without issue (if a race is possible on large worktrees or slow disks, the `--foreground` flag can switch it to blocking; worth noting when documenting the A7 §3 procedure).
  - `run.sh`/`run.log` operate only against the scratch repo (`mktemp -d`) and do not touch the real omnis repo or any branch.
- **decided_by**: Fable(agent), prior measurement from the 2026-09-20 probe session
- **Notes**: A7-D5's fallback rule ("fail → fall back to plain `git worktree add`/`remove`") does not trigger — PASS. Note that the `worktrunk create <branch>` / `worktrunk remove <story-id>` / `.worktrees/<story-id>` wording in the A7 §3 body disagrees with the measurements above (binary name `wt`, subcommands `switch --create`/`remove`, path is the sibling layout) and therefore needs updating — this plan does not edit the A7 body directly (a constraint stated in the plan header); the contract document (`phase-a-interfaces.md`) has already been updated to the sibling layout.
