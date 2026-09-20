# Google 연결 — Gmail + Calendar (A1 §2.2, §2.3)

예상 소요: 15분. **한 번의 동의로 Gmail + Calendar 둘 다 커버된다** — 같은 Cloud
프로젝트, 같은 OAuth client, 같은 refresh token을 재사용한다
(`packages/adapters/google-calendar/src/index.ts`의 주석: *"auth.keychainService는 호출자가
omnis.gmail.<email>을 그대로 넘긴다(재사용)"*). 계정을 추가로 연결할 때마다 이 문서를 처음부터
반복한다.

## 1. Cloud 프로젝트 + API

1. https://console.cloud.google.com → 새 프로젝트 생성 (또는 기존 프로젝트 선택)
2. **APIs & Services → Library**에서 활성화:
   - Gmail API
   - Google Calendar API
   - Cloud Pub/Sub API (Gmail push용, A1 §2.2)

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External**
3. 스코프에 `gmail.modify`, `calendar` 추가
4. Test users에 본인 이메일 추가 후 저장
5. **반드시 Production으로 게시(Publish)** — Testing 상태로 두면 refresh token이 정확히
   7일 후 만료된다(A1 §2.2 verified). **Publishing status → PUBLISH APP**

## 3. OAuth Desktop client

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Desktop app**
3. 생성되면 **Client ID**와 **Client secret**이 나온다 — 둘 다 복사

## 4. Pub/Sub 토픽 (Gmail push, A1 §2.2)

```bash
gcloud pubsub topics create omnis-gmail
gcloud pubsub subscriptions create omnis-gmail-pull --topic=omnis-gmail
gcloud pubsub topics add-iam-policy-binding omnis-gmail \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

(pull subscription이라 공인 엔드포인트가 필요 없다 — 미니가 아웃바운드로만 폴링한다, A1 §2.2.)

## 5. Refresh token 발급

코드에 아직 인앱 OAuth 플로우가 없다(`apps/desktop/src/screens/Onboarding.tsx`의
`OAuthClient.connect()`는 테스트용으로 주입되는 인터페이스일 뿐, 실제 구현이 없다 — 아래
"확인된 것/안 된 것" 참고). 대신 Google 공식 **OAuth 2.0 Playground**로 1회성으로 받는다:

1. https://developers.google.com/oauthplayground
2. 오른쪽 위 톱니바퀴(Settings) → **Use your own OAuth credentials** 체크 → 3단계의
   Client ID/secret 붙여넣기
3. 왼쪽 **Step 1**에서 스코프 입력창에 직접:
   `https://www.googleapis.com/auth/gmail.modify` 와
   `https://www.googleapis.com/auth/calendar` 두 줄 추가 → **Authorize APIs** → 본인 계정으로
   로그인/동의
4. **Step 2**에서 **Exchange authorization code for tokens** → **Refresh token** 값 복사
   (access token은 버려도 된다 — 만료되면 재발급되므로 `verify.ts`가 매번 refresh token으로 갱신한다)

## 6. Keychain에 저장

```bash
# refresh token — 어댑터가 실제로 읽는 이름 (Gmail·Calendar 공용, A1 §1.3)
tools/auth-kit/keychain-add.sh "omnis.gmail.<email>" "<email>"

# OAuth client — 스펙 표에는 없는 항목(클라이언트는 계정별이 아니라 앱 단위 시크릿이라
# omnis.<service>.<kind> 확장 규칙을 그대로 적용, A6 §9). hub/desktop이 아직 이 값을
# config로 읽어들이는 배선이 없어서(Wave 5 시점 미배선) verify.ts가 당분간 여기서 직접 읽는다.
tools/auth-kit/keychain-add.sh omnis.google.oauth_client_id
tools/auth-kit/keychain-add.sh omnis.google.oauth_client_secret
```

`<email>`은 본인 Gmail 주소 그대로 (예: `281932556+jinhologankim@users.noreply.github.com`).

## 7. 검증

```bash
pnpm auth:verify
```

`gmail`/`gcal` 두 행이 `keychain=ok api=ok`면 끝.

## 확인된 것 / 안 된 것

- 실제로 코드가 읽는 Keychain 항목: `omnis.gmail.<email>` 하나뿐(Gmail·Calendar 공용) — 확인됨
  (`packages/adapters/gmail/src/keychain.ts`, `packages/adapters/google-calendar/src/index.ts`).
- OAuth client id/secret은 어댑터 생성자(`GmailAdapterDeps.oauthClientId/oauthClientSecret`)에
  주입되는 값인데, hub/desktop 어디에도 이 값을 config나 env에서 읽어오는 배선이 아직 없다
  (Wave 5 시점 확인, `apps/hub/src/config.ts`에 Google 관련 필드 없음). `omnis.google.oauth_client_*`
  Keychain 이름은 이 kit이 임의로 정한 잠정 규칙 — hub 배선이 붙는 Wave에서 정식 이름으로
  바뀔 수 있다.
- Onboarding 화면(`apps/desktop/src/screens/Onboarding.tsx`)이 "다운로드한 client JSON을
  읽는 경로"를 갖고 있을 거라 예상했지만, 실제로는 `OAuthClient.connect()`라는 주입 인터페이스만
  있고 구현체가 없다 — 그래서 이 문서는 수동 OAuth Playground 경로로 대체했다(위 §5).
