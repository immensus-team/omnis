# Outlook / Microsoft 365 연결 (A1 §2.4) — Phase B

**어댑터 코드가 아직 없다** (`packages/adapters/`에 slack/gmail/google-calendar만 있고
outlook 디렉터리 자체가 없음, Wave 5 시점 확인). 아래는 Phase B 진입 시 쓸 콘솔 단계만 —
Keychain 저장/verify는 어댑터가 생긴 뒤에 이 문서를 다시 채운다.

## Entra ID(Azure AD) 앱 등록

1. https://entra.microsoft.com → **App registrations → New registration**
2. **계정 유형**: "Accounts in any organizational directory and personal Microsoft accounts"
   (`/common` authority) — 개인 Outlook.com과 회사 M365를 단일 등록으로 커버(A1 §2.4)
3. **API permissions → Add a permission → Microsoft Graph → Delegated**:
   - `Mail.ReadWrite`
   - `Mail.Send`
   - `Calendars.ReadWrite`
4. Publisher verification은 멀티테넌트 배포 앱 전용이라 개인 단일 사용자 앱은 불요(A1 §2.4 verified)
5. Authorization code flow로 1회 동의 → refresh token 발급

## Keychain (어댑터 구현 후 적용)

A1 §1.3 스킴대로면 `omnis.outlook.<upn>` (upn = 로그인 이메일). 어댑터가 생기면:

```bash
tools/auth-kit/keychain-add.sh "omnis.outlook.<upn>" "<upn>"
```

지금은 이 명령을 실행해도 `pnpm auth:verify`가 outlook 행을 만들지 않는다 — verify.ts에
아직 채널이 등록되지 않았다(어댑터 자체가 없어서).
