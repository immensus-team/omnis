#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/mini/preflight.sh"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

# 전부 "잘 안 됨" 상태를 흉내내는 가짜 바이너리 — 실패 목록에 6항목 전부 나와야 한다.
cat > "$FAKE_BIN/fdesetup"  <<'F'; chmod +x "$FAKE_BIN/fdesetup"
#!/bin/bash
echo "FileVault is Off."
F
cat > "$FAKE_BIN/defaults"  <<'F'; chmod +x "$FAKE_BIN/defaults"
#!/bin/bash
exit 1
F
cat > "$FAKE_BIN/pmset"     <<'F'; chmod +x "$FAKE_BIN/pmset"
#!/bin/bash
echo " sleep             1"
echo " displaysleep      1"
echo " autorestart       0"
F
cat > "$FAKE_BIN/launchctl" <<'F'; chmod +x "$FAKE_BIN/launchctl"
#!/bin/bash
exit 1
F
cat > "$FAKE_BIN/curl"      <<'F'; chmod +x "$FAKE_BIN/curl"
#!/bin/bash
exit 7
F
cat > "$FAKE_BIN/psql"      <<'F'; chmod +x "$FAKE_BIN/psql"
#!/bin/bash
echo "f"
F
export PATH="$FAKE_BIN:$PATH"

if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: preflight passed when everything is broken" >&2; exit 1
fi
echo "ok: preflight fails when everything is broken"

cat > "$FAKE_BIN/fdesetup"  <<'F'; chmod +x "$FAKE_BIN/fdesetup"
#!/bin/bash
echo "FileVault is On."
F
cat > "$FAKE_BIN/defaults"  <<'F'; chmod +x "$FAKE_BIN/defaults"
#!/bin/bash
echo "logan"
F
cat > "$FAKE_BIN/pmset"     <<'F'; chmod +x "$FAKE_BIN/pmset"
#!/bin/bash
echo " sleep             0"
echo " displaysleep      0"
echo " disksleep         0"
echo " autorestart       1"
echo " autorestartatconnect 0"
F
cat > "$FAKE_BIN/launchctl" <<'F'; chmod +x "$FAKE_BIN/launchctl"
#!/bin/bash
exit 0
F
cat > "$FAKE_BIN/curl"      <<'F'; chmod +x "$FAKE_BIN/curl"
#!/bin/bash
echo '{"models":[{"name":"nomic-embed-text-v1.5"}]}'
F
cat > "$FAKE_BIN/psql"      <<'F'; chmod +x "$FAKE_BIN/psql"
#!/bin/bash
echo "t"
F

"$SCRIPT" --check
echo "ok: preflight passes when everything is healthy"

# autorestart만 꺼져 있으면 (정전 복구 시 헤드리스 미니가 안 켜진다) 반드시 실패해야 한다.
cat > "$FAKE_BIN/pmset"     <<'F'; chmod +x "$FAKE_BIN/pmset"
#!/bin/bash
echo " sleep             0"
echo " displaysleep      0"
echo " disksleep         0"
echo " autorestart       0"
echo " autorestartatconnect 0"
F

if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: preflight passed with autorestart 0" >&2; exit 1
fi
echo "ok: preflight fails when autorestart is off"
echo "PASS"
