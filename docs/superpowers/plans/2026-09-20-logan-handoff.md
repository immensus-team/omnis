# omnis — Logan 손이 필요한 것들 (2026-09-20)

Wave 0(커널·DB·protocol·디자인 토큰·무인 스파이크)은 에이전트가 돌리고 있다. 아래는 에이전트가 못 하는 것만 모았다. 각 항목의 상세 절차는 `docs/superpowers/plans/2026-09-20-phase-0-spikes.md`의 해당 Task에 체크리스트와 스크립트로 준비된다(Wave 1에서 생성). 순서는 개발 착수에 미치는 영향 순.

## A. 답이 필요한 결정 (기본값으로 진행 중, 바꾸려면 말해줘)

| # | 질문 | 지금 기본값 | 근거 위치 |
|---|---|---|---|
| Q1 | iPhone을 PWA로 시작(Phase B), 네이티브는 Phase D | PWA | 마스터 §19 |
| Q4 | 개인 인박스 본문을 DeepSeek에 보낼 범위 | personal·finance·legal·health·VIP는 Anthropic, 나머지 DeepSeek | §14 |
| Q13 | 위임된 Claude Code 실행 모드 | 게이트 ⑪ 결과로 결정. `--bare`는 API 키 과금이라 구독을 못 씀 | §19, tools/spikes/_probes |
| Q10 | 위임 자동 실행 범위 | 자동 제안 + 한 번 승인. 완전 자율은 런타임·레포별 허용 규칙을 열 때만 | §11 |
| Q11 | 비용 상한 도달 시 VIP 초안 | 10% 예비비로 계속 생성 | §14 |
| Q9 | 라이선스 | Apache-2.0 (LICENSE 파일 이미 커밋) | §19 |
| — | 자동 보관 기본 규칙 4개 | §11의 규칙. 취향이 정답이라 첫 주 다이제스트 보고 조정 | §11 |

## B. 현장·계정 작업 (게이트 7개)

| 게이트 | 무엇을 | 왜 Logan | 실패 시 |
|---|---|---|---|
| ③ FileVault + 자동 로그인 (미니) | 미니 앞에서 체크리스트대로 자동 로그인 설정 후 재부팅 관찰 | 재부팅 직후 로그인 화면은 원격으로 안 보임 | FileVault OFF + tailnet-only, Logan 승인 필요 |
| ④ kmsg read (미니) | `run.sh` 실행 후 System Settings → Accessibility 권한 Allow 1회, 48시간 관찰 | 접근성 권한 최초 승인은 GUI 클릭 | Notification Center DB + OCR 폴백 |
| ⑤ Tailscale Serve HTTPS | 미니 쪽 setup은 내가 대행. 아이폰 Safari에서 열어 SSL 에러 유무 확인 | 실기기 확인 | MagicDNS 재확인 → TailscaleKit을 Phase D로 앞당김 |
| ⑨ Slack Socket Mode | api.slack.com/apps에서 manifest로 앱 생성·설치, 토큰 2개를 Keychain에 저장, 테스트 DM 1건 | 워크스페이스 앱 설치는 Logan 계정 | Events API + Funnel 검토 |
| ⑩ Gmail watch + Pub/Sub | GCP 프로젝트 생성, Gmail API 활성화, OAuth 동의 1회, 테스트 메일 1건 | 계정 소유자만 가능 | `history.list` 1분 폴링(기능 손실 없음) |
| ① Calendar push via Funnel | Calendar OAuth 동의 1회, Funnel을 잠깐 여는 것 승인 | 공인 인터넷 노출 판단 | syncToken 폴링 1~5분(이미 기본 경로) |
| ② Beeper + WhatsApp 부번호 | 미니에 Beeper Desktop 설치, 부번호 폰으로 QR 페어링, 토큰 Keychain 저장, 테스트 발송 | 물리적 QR | whatsmeow Go 사이드카 |

준비물: 부번호가 든 휴대폰(②), 미니 앞에 앉을 30분(③④), GCP 과금 계정(⑩, 무료 범위).

## C. 지금 안 해도 되는 것
- WhatsApp 실번호 연결(Q2), KakaoTalk send(Q3, read 14일 안정 후) — Phase C.
- iPhone 네이티브 앱, 공개 README — Phase D.
