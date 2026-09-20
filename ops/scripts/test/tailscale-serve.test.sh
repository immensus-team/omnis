#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/mini/tailscale-serve.sh"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

write_fake_tailscale() {
  # $1 = serve status json, $2 = funnel status text
  cat > "$FAKE_BIN/tailscale" <<FAKETS
#!/bin/bash
if [ "\$1" = "serve" ] && [ "\$2" = "status" ]; then
  cat <<'JSON'
$1
JSON
elif [ "\$1" = "funnel" ] && [ "\$2" = "status" ]; then
  echo "$2"
else
  echo "ok"
fi
FAKETS
  chmod +x "$FAKE_BIN/tailscale"
}
export PATH="$FAKE_BIN:$PATH"

# 1) With no /api mount, --check must fail.
write_fake_tailscale '{"Web":{}}' "Funnel off."
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed with no /api mount" >&2; exit 1
fi
echo "ok: --check fails when /api is not mounted"

# 2) With the /api mount present and Funnel off, --check must pass.
write_fake_tailscale '{"Web":{"mini.ts.net:443":{"Handlers":{"/api":{"Proxy":"http://127.0.0.1:8787"}}}}}' "Funnel off."
"$SCRIPT" --check
echo "ok: --check passes with /api mounted and funnel off"

# 3) If Funnel is on, --check must fail even when the mount is correct.
write_fake_tailscale '{"Web":{"mini.ts.net:443":{"Handlers":{"/api":{"Proxy":"http://127.0.0.1:8787"}}}}}' "Funnel on."
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed while funnel is on" >&2; exit 1
fi
echo "ok: --check fails when funnel is on"

echo "PASS"
