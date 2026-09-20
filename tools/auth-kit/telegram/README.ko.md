# Telegram (mtcute) 연결 (A1 §2.5) — Phase B

**어댑터 코드가 아직 없다** — `packages/adapters/`에 telegram 디렉터리가 없고, `mtcute`도
저장소 어디에도 import되어 있지 않다(Wave 5 시점 `grep -ri mtcute` 전체 결과 없음). 인터랙티브
로그인 플로우(QR 또는 phone+code)는 **전혀 구현돼 있지 않다** — 아래는 Phase B 진입 시
따라갈 콘솔 단계만이고, 실행 가능한 스크립트는 이 kit에 없다.

## `api_id`/`api_hash` 발급

1. https://my.telegram.org 로그인
2. **API development tools** → 앱 생성 → `api_id`/`api_hash` 발급
3. **공개 배포 절대 금지**(A1 §2.5 verified) — 이 값은 코드에 커밋하지 않고 Keychain에만 둔다

## 로그인 (Phase B, 어댑터 구현 후)

A1 §2.5 설계: mtcute 클라이언트 초기화 → 최초 페어링은 QR 로그인(omnis 화면에 QR 렌더 →
아이폰으로 스캔) 또는 phone+code(2FA 걸려있으면 cloud password 추가 입력) → mtcute 내장
SQLite 세션 파일을 로컬에 저장, 그 파일을 감싸는 암호화 키만 Keychain에 보관.

## Keychain (어댑터 구현 후 적용)

A1 §1.3: `omnis.telegram.session_key` (다계정 미지원이라 external_id 생략).

```bash
tools/auth-kit/keychain-add.sh omnis.telegram.session_key
```

지금은 이 명령을 실행해도 `pnpm auth:verify`가 telegram 행을 만들지 않는다 — 어댑터가
없어 확인할 API 호출 자체가 없다.
