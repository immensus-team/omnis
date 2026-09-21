#!/bin/bash
# DeepSeek implements, objective gate, Claude Opus reviews. Usage: run-task.sh <worktree> <task.md> [max_attempts] [extra_verify_cmd]
set -u
export PATH=/opt/homebrew/bin:$PATH
WT="$1"; TASK="$2"; MAX="${3:-3}"; EXTRA="${4:-}"
D=$HOME/AI-Workspaces/Claude/omnis/ds; NAME=$(basename "$TASK" .md); LOG=$D/logs
mkdir -p "$LOG"; cd "$WT" || exit 2
COMMON=$(cat "$D/COMMON.md")
for a in $(seq 1 "$MAX"); do
  ISSUES=""; [ -s "$LOG/$NAME.issues" ] && ISSUES=$'\n\n# PREVIOUS ATTEMPT REJECTED — fix these first, then re-verify everything:\n'"$(cat "$LOG/$NAME.issues")"
  echo "[$(date +%H:%M:%S)] $NAME attempt $a: implement"
  gtimeout 3000 claude-ds -p "$COMMON

# TASK ($NAME, attempt $a of $MAX)
$(cat "$TASK")$ISSUES" --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$LOG/$NAME-impl-$a.json" 2> "$LOG/$NAME-impl-$a.err"
  echo "[$(date +%H:%M:%S)] $NAME attempt $a: implement exit=$? head=$(git log -1 --format=%h) dirty=$(git status --short | wc -l | tr -d ' ')"
  BASE=$(git merge-base HEAD main)
  V="lint=$(pnpm lint >/dev/null 2>&1 && echo pass || echo FAIL) typecheck=$(pnpm typecheck >/dev/null 2>&1 && echo pass || echo FAIL)"
  GATE_OUT=""; if [ -n "$EXTRA" ]; then GATE_OUT=$(bash -c "$EXTRA" 2>&1); GATE_RC=$?; V="$V gate=$([ $GATE_RC -eq 0 ] && echo pass || echo FAIL)"; fi
  echo "[$(date +%H:%M:%S)] $NAME attempt $a: verify $V"
  if [ -n "$EXTRA" ] && [ "${GATE_RC:-0}" -ne 0 ]; then printf 'OBJECTIVE GATE FAILED (fix ALL of this before anything else):\n%s\n' "$GATE_OUT" | head -c 6000 > "$LOG/$NAME.issues"; echo "VERDICT gate-rejected"; continue; fi
  rm -f .omnis-review.json
  UNSET=$(env | grep -E '^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|MCP_)' | cut -d= -f1 | sed 's/^/-u /' | tr '\n' ' ')
  gtimeout 2400 env $UNSET claude --model claude-opus-5 -p "$COMMON

# ROLE: independent, strict code/design REVIEWER (Claude Opus — Logan's rule: all verification is done by Opus; implementation was DeepSeek) (you did not write this code). Worktree: $WT. Base: $BASE (git merge-base with main).
Task under review:
$(cat "$TASK")

Do, in order: (1) \`git log --oneline $BASE..HEAD\`, \`git diff $BASE..HEAD --stat\`, read the full diff of every non-binary file. (2) RE-RUN \`pnpm lint\`, \`pnpm typecheck\` and every test/verify command the task names (per-branch DB). Orchestrator pre-check: $V. (3) Check every acceptance item of the task against the actual code and, for UI tasks, Read every screenshot committed by this task next to the reference images named in the task and judge honestly whether it reads as the reference (density, typography, spacing, glass, motion) and whether anything wraps/overflows/misaligns. (4) Reject on: any failing command; any non-English UI string/comment/test name/doc line added; skipped or deleted tests; missing commit trailers; dirty tree; leftover .omnis-task*.md; secrets; horizontal overflow; generic-AI-looking UI; acceptance not met. Minor cosmetic nits alone are NOT grounds for rejection — list them as notes.
Write your verdict to $WT/.omnis-review.json as strict JSON: {\"approved\": true|false, \"issues\": [\"file:line — what is wrong — how to fix\", ...], \"notes\": [\"...\"]} and print the same JSON as your final message. Do not modify any other file." --permission-mode bypassPermissions --strict-mcp-config --output-format json > "$LOG/$NAME-review-$a.json" 2> "$LOG/$NAME-review-$a.err"
  python3 - "$WT/.omnis-review.json" "$LOG/$NAME.issues" "$LOG/$NAME-review-$a.json" <<'PY'
import sys,json,re
p,ip,fallback=sys.argv[1:4]
v=None
try: v=json.load(open(p))
except Exception:
    try:
        t=json.load(open(fallback)).get('result','')
        m=re.search(r'\{.*"approved".*\}',t,re.S); v=json.loads(m.group(0)) if m else None
    except Exception: v=None
if not v: open(ip,'w').write('reviewer produced no verdict; re-verify all acceptance items and commit any missing work'); print('VERDICT none'); sys.exit(1)
if v.get('approved'): open(ip,'w').write(''); print('VERDICT approved notes=%d'%len(v.get('notes') or [])); sys.exit(0)
open(ip,'w').write('\n'.join('- '+i for i in v.get('issues') or [])); print('VERDICT rejected issues=%d'%len(v.get('issues') or [])); sys.exit(1)
PY
  R=$?; rm -f "$WT/.omnis-review.json"
  echo "[$(date +%H:%M:%S)] $NAME attempt $a: review exit=$R"
  if [ $R -eq 0 ]; then echo "RESULT $NAME APPROVED attempt=$a head=$(git log -1 --format=%h)"; rm -f "$LOG/$NAME.issues"; exit 0; fi
done
echo "RESULT $NAME FAILED after $MAX attempts head=$(git log -1 --format=%h)"; exit 1
