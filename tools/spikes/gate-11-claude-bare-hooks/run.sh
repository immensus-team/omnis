#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
REPO_ROOT="$(pwd)"
GATE_DIR="$REPO_ROOT/tools/spikes/gate-11-claude-bare-hooks"
OUT="$GATE_DIR/out"

# deviation 4 (see result.md): every artifact this script writes goes into $OUT, which is
# gitignored (`tools/spikes/**/out/`) and wiped at the start of each run.
#  - `claude --debug-file` APPENDS: greping a cumulative file counts markers left by earlier
#    runs as this run's result, so a future re-run (e.g. after a Claude Code fix) would stay
#    pinned to today's verdict. Fresh dir = every measurement is this run's.
#  - Claude Code also drops a `latest` symlink next to --debug-file, and the tracked
#    hooks-settings.json must not be rewritten in place — both used to dirty the branch.
rm -rf "$OUT"
mkdir -p "$OUT"

# deviation 1 (see result.md): the checked-in hooks-settings.json (plan step 5, kept as the
# literal illustration) uses a path relative to cwd, which resolves in the repo root but throws
# MODULE_NOT_FOUND whenever Claude Code's cwd is the fixture worktree. Generate the settings
# file actually passed to --settings here, with an absolute script path.
SETTINGS="$OUT/hooks-settings.json"
cat > "$SETTINGS" <<JSON
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node $GATE_DIR/hook-receiver.mjs" }] }
    ]
  }
}
JSON

# deviation 2 (see result.md): the plan's prompt "run: ls" let the model answer from the
# directory context it already had without ever invoking the Bash tool, so no PreToolUse event
# could fire either way. Force a real Bash tool_use, with a command free of `$`/backticks (an
# unrelated built-in guard blocks those).
PROBE_CMD="echo GATE11_PROBE_MARKER"
PROMPT="You must call the Bash tool now, even if you already know the answer. Run exactly this command: $PROBE_CMD"

check() {
  # deviation 3 (see result.md): our omnis hook blocks (exit 2), so Claude Code logs its firing
  # under "(PreToolUse) error:", while the always-allow project hook (exit 0) logs under
  # "(PreToolUse) success:" -- match on the hook's own marker text regardless of that label.
  local dbg="$1" label="$2"
  grep -q 'Hook PreToolUse:Bash (PreToolUse) .*:\\nGATE11_HOOK_FIRED' "$dbg" && echo "${label}_omnis_hook_fired=true" || echo "${label}_omnis_hook_fired=false"
  grep -q 'Hook PreToolUse:Bash (PreToolUse) .*:\\nPROJECT_HOOK_FIRED' "$dbg" && echo "${label}_project_hook_fired=true" || echo "${label}_project_hook_fired=false"
}

echo "=== fixture: fresh worktree cwd with its own .claude/settings.json project hook ==="
FIXTURE_PARENT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_PARENT"' EXIT
FIXTURE_DIR="$FIXTURE_PARENT/gate11-project-fixture"
mkdir -p "$FIXTURE_DIR/.claude"
git init -q "$FIXTURE_DIR"
cp "$GATE_DIR/project-hook.mjs" "$FIXTURE_DIR/.claude/project-hook.mjs"
cat > "$FIXTURE_DIR/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .claude/project-hook.mjs" }] }
    ]
  }
}
JSON

# deviation 5 (see result.md): mode (a) needs API-key auth -- `--bare` never reads OAuth/Keychain
# (_probes premise 2). On this machine no ANTHROPIC_API_KEY is exported, but `claude-ds` is on PATH
# and is literally `exec claude "$@"` with ANTHROPIC_AUTH_TOKEN exported from the Keychain, i.e.
# exactly the API-key-authenticated Claude Code that mode (a) calls for. Use it as the driver so
# the gate's core question is measured instead of blocked at the login screen.
if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  MODE_A_DRIVER=claude
elif command -v claude-ds >/dev/null 2>&1; then
  MODE_A_DRIVER=claude-ds
else
  MODE_A_DRIVER=""
fi

# deviation 6 (see result.md): the plan ran mode (a) at the repo root with no project fixture,
# where project_hook_fired is vacuously false. Run it in the same fixture cwd as mode (b) so both
# halves of the pass condition are actually measured.
echo "=== mode (a): --bare + --settings + API-key auth (driver=${MODE_A_DRIVER:-none}, cwd = fixture worktree) ==="
if [[ -z "$MODE_A_DRIVER" ]]; then
  echo "mode_a_skipped=true (no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN and no claude-ds on PATH)"
else
  (
    cd "$FIXTURE_DIR"
    "$MODE_A_DRIVER" -p --bare --debug hooks --debug-file "$OUT/mode-a.debug.log" \
      --settings "$SETTINGS" \
      --permission-mode manual \
      "$PROMPT" < /dev/null > "$OUT/mode-a.log" 2>&1
  ) || true
  check "$OUT/mode-a.debug.log" mode_a
fi

echo "=== mode (b): non-bare + --settings <omnis-hooks.json> + --permission-mode manual, cwd = fixture worktree ==="
(
  cd "$FIXTURE_DIR"
  claude -p --debug hooks --debug-file "$OUT/mode-b.debug.log" \
    --settings "$SETTINGS" \
    --permission-mode manual \
    "$PROMPT" < /dev/null > "$OUT/mode-b.log" 2>&1
) || true
check "$OUT/mode-b.debug.log" mode_b
