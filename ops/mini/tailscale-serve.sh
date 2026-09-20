#!/bin/bash
# US-B34: hub API + PWA를 tailnet HTTPS 하나에 마운트한다(A6 §3).
# 실측(RUNBOOK "이 배포가 미니에 실제로 바꾼 것"): --set-path=/api가 이미 미니에서 돈다. sudo 불필요.
set -euo pipefail

HUB_PORT="${OMNIS_HUB_PORT:-8787}"
WEB_PORT="${OMNIS_WEB_PORT:-5173}"

do_mount() {
  tailscale serve --bg --https=443 --set-path=/api "http://127.0.0.1:${HUB_PORT}"
  tailscale serve --bg --https=443 --set-path=/ "http://127.0.0.1:${WEB_PORT}"
  echo "mounted: /api -> 127.0.0.1:${HUB_PORT}, / -> 127.0.0.1:${WEB_PORT}"
}

do_check() {
  local status
  status="$(tailscale serve status --json 2>/dev/null || echo '{}')"
  node -e '
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      let s;
      try { s = JSON.parse(data || "{}"); } catch { s = {}; }
      const web = s.Web || {};
      const paths = Object.values(web).flatMap((h) => Object.keys(h.Handlers || {}));
      if (!paths.some((p) => p.includes("/api"))) {
        console.error("no /api mount found in tailscale serve status");
        process.exit(1);
      }
      console.log("ok: /api mount present");
    });
  ' <<< "$status"

  local funnel
  funnel="$(tailscale funnel status 2>&1 || true)"
  if echo "$funnel" | grep -qi "funnel on"; then
    echo "FAIL: Funnel is ON — A6 §3은 Funnel을 상시 OFF로 정했다. 'tailscale funnel 443 off'로 끈다." >&2
    exit 1
  fi
  echo "ok: funnel is off"
}

case "${1:-}" in
  --mount) do_mount ;;
  --check) do_check ;;
  *) echo "usage: tailscale-serve.sh [--mount|--check]" >&2; exit 64 ;;
esac
