#!/usr/bin/env bash
# Gate ⑭ — worktrunk (CLI binary: `wt`) create/remove round trip, dry run.
#
# A7-D5's draft assumed `worktrunk create <branch>` / `worktrunk remove <story-id>`
# with worktrees under `.worktrees/`. Prior probe evidence
# (tools/spikes/_probes/2026-09-20-cli-probes.md, "Gate ⑦ (schema) and ⑭ evidence")
# already measured the real CLI and corrected both assumptions:
#   - binary is `wt`, subcommand is `wt switch --create <branch>` (alias `-c`)
#   - removal is `wt remove <branch>`
#   - worktree lands in worktrunk's default sibling layout `<repo-dir>.<branch-with-/-as-->`,
#     not `.worktrees/<slug>`
# This script re-encodes that corrected form against a scratch repo (never the
# real omnis repo or its branches) so it can be re-run later if worktrunk
# changes CLI shape again. See result.md — this task's PASS verdict reuses the
# prior measurement rather than re-running this script, per gate ⑦/⑧/⑭ reuse
# instructions.
set -euo pipefail

BRANCH="spike/gate-14-dryrun"

SCRATCH=$(mktemp -d)
git init -q "$SCRATCH"
(cd "$SCRATCH" && git commit -q --allow-empty -m "init")

PARENT_DIR=$(dirname "$SCRATCH")
SCRATCH_BASENAME=$(basename "$SCRATCH")
# worktrunk's sibling layout replaces `/` in the branch name with `-`.
SANITIZED_BRANCH=${BRANCH//\//-}
EXPECT_WORKTREE_DIR="${PARENT_DIR}/${SCRATCH_BASENAME}.${SANITIZED_BRANCH}"

echo "=== wt --help ==="
wt --help

echo "=== create: wt switch --create $BRANCH -y --no-cd ==="
(cd "$SCRATCH" && wt switch --create "$BRANCH" -y --no-cd)
test -d "$EXPECT_WORKTREE_DIR" \
  && echo "create_pass=true" || echo "create_pass=false"

echo "=== remove: wt remove $BRANCH -y ==="
(cd "$SCRATCH" && wt remove "$BRANCH" -y)
test ! -d "$EXPECT_WORKTREE_DIR" \
  && echo "remove_pass=true" || echo "remove_pass=false"

rm -rf "$SCRATCH" "$EXPECT_WORKTREE_DIR"
