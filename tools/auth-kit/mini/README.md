# 미니에서 하는 것 — KakaoTalk / WhatsApp / LinkedIn / Codex

이 넷은 GUI 세션이 필요해서 미니 화면 앞에서(또는 Screen Sharing으로) 직접 해야 한다 —
SSH 셸에서는 안 된다(Keychain도 GUI 세션 전용, `ops/mini/RUNBOOK.md` §4). 전제조건(자동 로그인,
화면 잠금 안 함, `pmset`/`caffeinate`)은 이미 미니 전체에 적용돼 있어야 한다 — 그 절차는
여기서 다시 적지 않는다, `docs/spec/A6-ops-infra.md` §2(`omnis-reapply-settings` LaunchAgent)가
정본이다.

## KakaoTalk (kmsg, A1 §2.8)

1. 미니의 KakaoTalk.app에 정상 로그인, **자동 로그인 On**. 2FA는 새 기기 등록 1회 + sub-device
   연결마다 모바일 4자리 보안 인증번호(카카오 공식 정책).
2. `brew install channprj/tap/kmsg`
3. **Accessibility 권한**: System Settings → Privacy & Security → Accessibility → 터미널
   (또는 kmsg를 구동하는 프로세스)에 체크. kmsg는 AX API로 KakaoTalk.app UI를 읽는다 —
   이 권한 없이는 아무것도 안 된다.
4. `kmsg auth login`(비밀번호를 kmsg 자체 저장소에 넣는 기능)은 **쓰지 않는다** —
   KakaoTalk.app 자체 로그인 유지만으로 충분하다(A1 §2.8, "비밀 최소화").
5. 확인: `kmsg chats --json && kmsg read <chat_id> --background-safe --json` (A1-③ 스파이크,
   §4). KakaoTalk.app 포커스가 뺏기지 않아야 정상.
6. send는 처음부터 열지 않는다 — **read 2주 안정 후 승인제로 연다**(A1 §2.8, 마스터 Q3 기본값).

Keychain 항목 없음 — KakaoTalk.app 자체 로그인만 쓴다(A1 §1.3 표).

## WhatsApp — Beeper (A1 §2.6) + 부번호 파일럿

1. Beeper Desktop 앱 설치(무료, Public beta) → 안에서 WhatsApp 계정을 QR로 페어링
   — **부번호로 먼저 파일럿한다**(마스터 Q2 기본값, 본번호 계정정지 리스크 회피).
2. Settings → Integrations → Desktop API용 Bearer 토큰 발급
3. Settings → Integrations → Advanced → **Remote Access** 활성화
4. 터널은 **Tailscale로만**(Beeper 자체 터널 없음, Funnel/Cloudflare 쓰지 않음 — 기존 tailnet
   ACL 재사용, A1 §2.6)
5. 저장:
   ```bash
   tools/auth-kit/keychain-add.sh omnis.beeper.token
   ```
6. **personal use only** — 대량 발송 금지, 자동 즉답 금지(Beeper 공식 문서 경고, A1 §2.6).

whatsmeow 폴백(A1 §2.7)은 A1-② 스파이크가 실패할 때만 — 그전까지는 손대지 않는다.

## LinkedIn (Playwright 상주 프로필, A1 §2.9)

1. 미니에서 `playwright install chromium`
2. Playwright로 Chromium을 띄워 LinkedIn에 **1회 수동 로그인**(2FA 포함)
3. 그 프로필 디렉터리(쿠키/localStorage)를 그대로 보존 — **재로그인을 최소화**한다
   (`mautrix/linkedin#55`의 20초 세션사망 버그를 피하기 위한 설계, A1 §2.9)
4. 자격증명 자체는 저장하지 않는다 — Keychain 항목 없음(A1 §1.3 표). 프로필 디렉터리
   자체가 시크릿이니 백업/이관 시 취급 주의.
5. 폴링은 5~15분 랜덤화 간격 — 프로필 대량 열람 금지(계정정지 리스크, A1 §2.9).

## Codex CLI 로그인

미니의 `local-agent`가 Codex를 브리지한다(A6 §10.2). Codex CLI 자체 인증이 필요:

```bash
codex login
```

브라우저 OAuth 창이 뜬다 — 미니 GUI 세션에서 실행해야 한다(headless `codex app-server`는
로그인 셸 세션에 이미 있는 인증을 그대로 쓴다, A6-D10). 로그인 후 `codex app-server`가
JSON-RPC로 정상 응답하는지는 A6 §11 스파이크 ⑦(`codex app-server generate-json-schema`)
절차로 확인한다.

## 검증

이 4개는 `pnpm auth:verify`가 확인하지 않는다 — KakaoTalk/LinkedIn은 Keychain 항목이 없고,
Beeper/Codex는 API 왕복 확인 로직이 아직 verify.ts에 없다(Slack/Gmail/Calendar만 배선돼
있음, `tools/auth-kit/verify.ts`). 각 절차의 "확인" 단계(위 kmsg 명령, LinkedIn 로그인 성공
화면, `codex app-server` 스파이크)로 개별 확인한다.
