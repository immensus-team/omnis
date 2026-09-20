# Tailscale ACL (US-B34, A6 §3)

미니는 공인 인터넷에 어떤 포트도 열지 않는다. 노출은 전부 `tailscale serve`를 거친 HTTPS(443) 하나다.

## Grants

```json
{
  "tagOwners": {
    "tag:hub": ["logan@onwordlab.ai"],
    "tag:client": ["logan@onwordlab.ai"]
  },
  "grants": [
    { "src": ["tag:client"], "dst": ["tag:hub"], "ip": ["tcp:443"] }
  ],
  "ssh": [
    { "action": "check", "src": ["tag:client"], "dst": ["tag:hub"], "users": ["logan", "vigor"] }
  ]
}
```

## Postgres(5432)·Ollama(11434)를 `dst`에 넣지 않는 이유

클라이언트(맥북·아이폰)가 tailnet 너머로 직접 열어야 하는 것은 hub API(443 아래 `/api/`, `tailscale serve`가 127.0.0.1:8787로 프록시)뿐이다. Postgres와 Ollama는 hub 프로세스(또는 그 안의 local-agent 브리지)를 거쳐서만 쓰인다 — ACL에 5432/11434를 열면 클라이언트가 hub의 승인 게이트·감사 로그를 건너뛰고 DB/모델에 직접 접속하는 경로가 생긴다. 공격 표면을 hub API 하나로 좁히는 것이 A6 §3의 tailnet-only 원칙이다.

## Funnel

**상시 OFF.** `tailscale funnel status`가 "Funnel off."가 아니면 `bash ops/mini/tailscale-serve.sh --check`가 실패한다(§8 모니터링, US-B42가 이 스크립트를 healthcheck-ping.sh의 한 항목으로 물린다). Funnel은 공인 인터넷 노출이라 Calendar `events.watch` 같은 웹훅 수신이 꼭 필요한 스파이크 동안만 임시로 켰다가 즉시 끈다(A6 §3) — Phase B에는 그런 경로가 없다.

## 마운트

```bash
bash ops/mini/tailscale-serve.sh --mount   # /api -> :8787, / -> :5173 (US-B35 PWA 빌드 산출물)
bash ops/mini/tailscale-serve.sh --check   # 마운트 + funnel off 확인만, 아무것도 안 바꾼다
```

## 실측과의 차이 (2026-09-20 RUNBOOK 기록)

RUNBOOK의 "이 배포가 미니에 실제로 바꾼 것" 표(11:3x 항목)에 따르면, `--set-path=/api`로 마운트했을 때
Serve가 prefix `/api`를 떼고 백엔드에 넘겨 허브의 `/api/zero-token`이 `/zero-token`으로 도착해 404가
났고, 당시 임시 조치로 허브를 `/`에 직접 마운트했다(PWA 빌드가 아직 없던 시점). 이 스크립트를 실제
`--mount`로 미니에 적용하기 전에는, 허브 라우트가 `/api` 프리픽스 없이 등록돼 있는지(Serve의 프리픽스
스트립과 맞물리는지) 먼저 확인해야 한다 — 이 확인·수정은 허브 라우팅 코드 쪽 작업이라 이 태스크(순수
운영 스크립트) 범위 밖이다.
