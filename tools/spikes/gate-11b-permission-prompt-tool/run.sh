#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
REPO_ROOT="$(pwd)"
GATE_DIR="$REPO_ROOT/tools/spikes/gate-11b-permission-prompt-tool"
OUT="$GATE_DIR/out"

# out/ is gitignored (tools/spikes/**/out/) and wiped every run, same rationale as gate-11
# deviation 4: --debug-file appends, so a stale file would corrupt this run's verdict.
rm -rf "$OUT"
mkdir -p "$OUT"

NODE_BIN="$(command -v node)"
SERVER="$GATE_DIR/mcp-permission-server.ts"

mcp_config() {
  # $1 = log path this mode's server instance writes to
  cat <<JSON
{
  "mcpServers": {
    "omnis_gate11b": {
      "command": "$NODE_BIN",
      "args": ["$SERVER"],
      "env": { "GATE11B_LOG_PATH": "$1" }
    }
  }
}
JSON
}

PERM_TOOL="mcp__omnis_gate11b__approval_prompt"
# deviation (see result.md): gate-11's literal probe `echo ...` never reaches canUseTool at all —
# Claude Code's built-in read-only-Bash classifier auto-approves `echo` before the permission-mode
# step, so --permission-prompt-tool is never consulted (measured: permissionDecisionMs=2, no MCP
# call). `touch` is a filesystem write, not on that allowlist, so in `manual` (= SDK `default`)
# mode it must fall through to canUseTool/--permission-prompt-tool.
PROBE_CMD="touch /tmp/gate11b_probe_marker.txt"
# same reliability fix as gate-11 deviation 2: force a real Bash tool_use, no $/backticks.
PROMPT="You must call the Bash tool now, even if you already know the answer. Run exactly this command: $PROBE_CMD"

echo "=== fixture: fresh worktree cwd with its own .claude/settings.json project hook ==="
FIXTURE_PARENT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_PARENT"' EXIT
FIXTURE_DIR="$FIXTURE_PARENT/gate11b-project-fixture"
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

check() {
  # judge from the MCP server's own request log + --debug output, never the model's prose
  # (gate-11 found the model can skip the Bash call and narrate an answer instead).
  local reqlog="$1" dbg="$2" label="$3"
  if [[ -s "$reqlog" ]] && grep -q '"tool_name":"Bash"' "$reqlog"; then
    echo "${label}_permission_tool_invoked_for_bash=true"
    if grep '"tool_name":"Bash"' "$reqlog" | tail -1 | grep -q '"decision":"deny"'; then
      echo "${label}_bash_denied=true"
    else
      echo "${label}_bash_denied=false"
    fi
  else
    echo "${label}_permission_tool_invoked_for_bash=false"
    echo "${label}_bash_denied=false"
  fi
  grep -qi "GATE11B_PROJECT_HOOK_FIRED" "$dbg" 2>/dev/null && echo "${label}_project_hook_fired=true" || echo "${label}_project_hook_fired=false"
  grep -qi 'Calling MCP tool: approval_prompt' "$dbg" 2>/dev/null && echo "${label}_debug_shows_mcp_tool_call=true" || echo "${label}_debug_shows_mcp_tool_call=false"
}

run_mode() {
  # $1=label $2=driver(cmd) $3..=extra driver flags (e.g. --bare), rest fixed
  local label="$1" driver="$2"; shift 2
  local reqlog="$OUT/$label.requests.ndjson"
  local cfg="$OUT/$label.mcp-config.json"
  local dbg="$OUT/$label.debug.log"
  mcp_config "$reqlog" > "$cfg"
  echo "=== $label: driver=$driver extra_flags=[$*] cwd=fixture worktree ==="
  local t0 t1
  # macOS `date` has no %N; use python3 for a millisecond timestamp.
  t0=$(python3 -c 'import time; print(int(time.time()*1000))')
  (
    cd "$FIXTURE_DIR"
    "$driver" -p "$@" \
      --debug hooks,mcp,permissions --debug-file "$dbg" \
      --mcp-config "$cfg" --strict-mcp-config \
      --permission-prompt-tool "$PERM_TOOL" \
      --permission-mode manual \
      "$PROMPT" < /dev/null > "$OUT/$label.log" 2>&1
  ) || true
  t1=$(python3 -c 'import time; print(int(time.time()*1000))')
  echo "${label}_latency_ms=$((t1 - t0))"
  check "$reqlog" "$dbg" "$label"
}

# mode (a): non-bare, subscription auth (the plain `claude` binary carries OAuth)
run_mode mode_a claude

# mode (b): --bare, driven through claude-ds (API key auth) — --bare never reads
# OAuth/Keychain (gate-11 deviation 5), so it needs an API-key-authenticated driver.
if command -v claude-ds >/dev/null 2>&1; then
  run_mode mode_b claude-ds --bare
else
  echo "mode_b_skipped=true (claude-ds not on PATH)"
fi
