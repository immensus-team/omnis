# Slack 연결 (A1 §2.1)

예상 소요: 10분.

## 1. 앱 생성 (manifest에서)

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. 워크스페이스 선택 → `tools/auth-kit/slack/manifest.yaml` 내용을 붙여넣기 → **Create**
3. 왼쪽 메뉴 **Socket Mode**: 이미 manifest로 켜져 있는지 확인. **App-Level Token**을 새로 만들어야
   한다 — **Basic Information → App-Level Tokens → Generate Token**, 스코프 `connections:write`,
   이름은 아무거나(예: `socket`). 발급되는 토큰이 `xapp-...` 형태 — 이게 App-Level Token이다.

## 2. 설치

1. **OAuth & Permissions** → **Install to Workspace** → 권한 확인 화면에서 **허용**
   (본인 워크스페이스 설치라 즉시 승인됨, A1 §2.1)
2. 설치 후 이 화면에 두 토큰이 보인다:
   - **Bot User OAuth Token** — `xoxb-...`
   - **User OAuth Token** — `xoxp-...`

## 3. 토큰 3개 복사

| 토큰 | 형태 | 어디서 |
|---|---|---|
| Bot (xoxb) | `xoxb-...` | OAuth & Permissions |
| User (xoxp) | `xoxp-...` | OAuth & Permissions |
| App-Level | `xapp-...` | Basic Information → App-Level Tokens |

워크스페이스의 **Team ID**도 적어둔다 (OAuth & Permissions 페이지 URL이나 워크스페이스
설정 → About에서 `T`로 시작하는 값).

## 4. Keychain에 저장

어댑터 코드(`packages/adapters/slack/src/index.ts` `connect()`)가 실제로 읽는 이름 그대로 —
`<team_id>`는 위에서 적어둔 Team ID로 바꿔서 실행:

```bash
tools/auth-kit/keychain-add.sh "omnis.slack.xoxb.<team_id>" "<team_id>"
# 값 입력 프롬프트에 xoxb-... 붙여넣기

tools/auth-kit/keychain-add.sh "omnis.slack.xoxb.<team_id>.app" "<team_id>"
# 값 입력 프롬프트에 xapp-... 붙여넣기
```

(xoxp 유저 토큰은 v1 send 경로에서 아직 쓰이지 않는다 — `packages/adapters/slack/src/index.ts`가
지금은 xoxb만 읽는다. 필요해지면 `omnis.slack.xoxp.<team_id>`로 같은 방식으로 추가하면 된다.)

값은 절대 셸 히스토리나 로그에 남기지 않는다 — `keychain-add.sh`가 `read -s`로 프롬프트만
받는다(A6 §9).

## 5. 검증

```bash
pnpm auth:verify
```

`slack` 행이 `keychain=ok api=ok`로 나오면 끝 — `keychain=ok`은 위 4단계의 두 항목
(`...xoxb.<team_id>`와 `...xoxb.<team_id>.app`)이 **둘 다** 있다는 뜻이다. 하나만 넣었으면
`keychain=missing`이 뜨고 `detail` 열에 빠진 항목 이름이 그대로 찍힌다.
`api=fail`이면 토큰이 revoke됐거나 잘못 붙여넣은 것 — 1~2단계부터 다시.
