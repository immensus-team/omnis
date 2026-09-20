# 계정 연결 체크리스트

순서대로. Phase A 3개(Slack/Gmail/Calendar)만 끝내면 온보딩은 끝난다 — 나머지는 필요할 때.

## Phase A — 지금 (맥북, 총 ~25분)

1. **Slack** (~10분) — [`slack/README.ko.md`](slack/README.ko.md)
2. **Gmail + Calendar** (~15분, 한 번의 Google 동의로 둘 다) — [`google/README.ko.md`](google/README.ko.md)
3. 확인:
   ```bash
   cp tools/auth-kit/accounts.example.json tools/auth-kit/accounts.local.json
   # accounts.local.json 열어서 teamId/email 채우기
   pnpm auth:verify
   ```
   `slack`/`gmail`/`gcal` 세 행 모두 `keychain=ok api=ok`면 끝.

## Phase B — 나중 (어댑터 아직 없음, 콘솔 단계만 미리 봐두기용)

4. **Outlook** — [`outlook/README.ko.md`](outlook/README.ko.md)
5. **Telegram** — [`telegram/README.ko.md`](telegram/README.ko.md)

## Phase C — 미니 앞에서 (GUI 세션 필요, ~30분)

6. **KakaoTalk / WhatsApp(Beeper) / LinkedIn / Codex 로그인** —
   [`mini/README.ko.md`](mini/README.ko.md)

## 막히면

- `pnpm auth:verify`가 `keychain=missing`: `detail` 열에 **빠진 항목 이름**이 그대로 찍힌다.
  `tools/auth-kit/keychain-add.sh`로 저장한 이름이 그것과 정확히 일치하는지 확인(각 README의
  "Keychain에 저장" 절 참고). Slack은 `...xoxb.<team_id>`와 `...xoxb.<team_id>.app` 두 항목이
  모두 있어야 `keychain=ok`이 된다.
- `api=fail`: 토큰이 revoke됐거나 스코프가 부족한 것 — detail 열에 에러 메시지가 그대로 찍힌다
  (토큰 값 자체는 절대 안 찍음).
- 값은 어디에도 다시 안 적는다 — 틀렸으면 `keychain-add.sh`를 다시 실행(`-U`라 덮어쓴다).
