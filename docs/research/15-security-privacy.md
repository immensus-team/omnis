# 15 — Threat Model & Security Architecture

## 1. TL;DR (한국어)

omnis는 WhatsApp/Telegram/Slack/Kakao/Gmail 세션과, Logan 대신 답장하고 두 대 기기에서 코드를 실행하는 agent들을 한 프로세스에 모은다. 공격 표면이 "받은 편지함 전체 + 실행 권한"이라 OWASP LLM Top 10 2025 1위인 prompt injection이 핵심 리스크다(이메일/DM은 untrusted data). MVP 필수: macOS Keychain으로 토큰 보관(Tauri keychain plugin), SQLCipher로 메시지 DB 암호화, Tailscale ACL(tag 기반)로 mini를 tailnet 전용 노출, per-channel/per-contact 권한 모델(read/draft/send-approval/send-autonomous), outbound는 human-in-the-loop 기본값, 모든 agent action audit log, kill switch. WhatsApp/Kakao/LinkedIn은 비공식 클라이언트라 ToS 위반 시 계정 정지 리스크가 실재하므로 human-like cadence·rate limit이 필수. FileVault는 macOS 전원 차단 시에만 보호하므로 SQLCipher가 별도로 필요하다.

## 2. Facts

- macOS `security` CLI(`add-generic-password`, `find-generic-password`)로 Keychain에 시크릿을 저장/조회할 수 있다. `-w` 값은 shell history에 남을 수 있어 주의 필요. — https://zottmann.org/2023/04/30/til-how-to.html (fetched 2026-09-20) VERIFIED
- Tauri v2의 Stronghold 플러그인은 더 이상 권장되지 않으며 v3에서 제거(deprecated) 예정이다; OS 네이티브 키체인 통합에는 `tauri-plugin-keyring`(rust `keyring` crate 래핑) 계열을 쓰고, Stronghold는 암호화 키 자체를 keyring에 보관하는 용도로만 남는다. — https://v2.tauri.app/plugin/stronghold/ , https://github.com/HuakunShen/tauri-plugin-keyring , https://github.com/tauri-apps/tauri/discussions/7846 (fetched 2026-09-20) VERIFIED
- SQLCipher는 SQLite 파일 전체(데이터+메타데이터+인덱스+저널)를 AES-256으로 투명 암호화하며, PRAGMA key로 여는 것 외엔 애플리케이션 코드 변경이 불필요하다. 기본 KDF는 PBKDF2 640,000회 반복. 오버헤드는 연산에 따라 5~15%. — https://github.com/sqlcipher/sqlcipher , https://oneuptime.com/blog/post/2026-02-02-sqlcipher-encryption/view (fetched 2026-09-20) VERIFIED
- FileVault(AES-XTS)는 Mac이 꺼져 있을 때만 완전 보호를 제공한다; 로그인한 상태에서는 디스크 데이터가 평문처럼 접근 가능하므로, "프로세스가 살아있는 동안의" 메시지 DB 보호에는 FileVault만으로 불충분하고 앱 레벨 암호화(SQLCipher)가 별도로 필요하다. — https://support.apple.com/guide/security/volume-encryption-with-filevault-sec4c6dc1b6e/web (fetched 2026-09-20) VERIFIED
- 1Password CLI(`op`)는 `op://vault/item/field` 형식의 secret reference와 `op inject`/`op run`으로 평문을 파일에 남기지 않고 시크릿을 주입할 수 있다; 무인 자동화에는 `OP_SERVICE_ACCOUNT_TOKEN` 환경변수 기반 인증을 쓴다. Hermes Agent 자체 문서에도 1Password CLI 연동 skill이 존재한다(옵션 보안 스킬). — https://www.1password.dev/cli/secret-references , https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/security/security-1password (fetched 2026-09-20) VERIFIED
- sops+age는 YAML/JSON의 값만 암호화하고 키는 평문으로 남겨 git diff/review가 가능하며, 여러 recipient(age public key)에게 데이터 키를 wrap해 팀/기기별 접근을 분리한다. Kubernetes/GitOps용으로 흔히 쓰이지만 로컬 dotfile/config 암호화에도 그대로 적용 가능. — https://www.jonashietala.se/blog/2026/05/31/sops_age_and_sealed_secrets/ (fetched 2026-09-20) VERIFIED
- Tailscale Serve는 로컬 서비스를 tailnet에만 노출하며, identity header(예: `Tailscale-User-Login`)는 태그가 아닌 실제 사용자에게만 채워지고 스푸핑 방지를 위해 들어오는 요청의 동일 헤더는 제거 후 재주입한다. ACL은 Grants(신형) 또는 ACL(구형) 문법으로 device tag 단위 접근 제어가 가능하다. — https://tailscale.com/docs/features/tailscale-serve , https://tailscale.com/docs/concepts/tailscale-identity , https://tailscale.com/docs/features/access-control/acls (fetched 2026-09-20) VERIFIED
- OWASP Top 10 for LLM Applications 2025는 Prompt Injection(LLM01)을 2회 연속 1위로 유지했고, RAG나 fine-tuning으로는 완전히 막을 수 없으며 least-privilege tooling + I/O filtering + human approval + adversarial testing의 defense-in-depth를 권고한다. — https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf (fetched 2026-09-20) VERIFIED
- Anthropic 자체 프로덕트(Claude Code, Claude Cowork)의 containment 설계: Claude Code는 OS 샌드박스(macOS Seatbelt / Linux bubblewrap)로 파일은 읽기 자유·쓰기는 workspace로 제한, 네트워크는 기본 차단. Claude Code의 permission 승인율이 약 93%로 "approval fatigue"가 발생해 model-based classifier가 사전 위험 행동의 약 83%를 차단하는 auto mode를 도입했다. Cowork는 VM(hypervisor) 격리 + egress allowlist proxy를 쓴다. — https://www.anthropic.com/engineering/how-we-contain-claude (fetched 2026-09-20) VERIFIED
- Anthropic의 브라우저 에이전트 prompt-injection 방어는 (1) 시뮬레이션된 악성 웹 콘텐츠로 RL 학습, (2) untrusted 콘텐츠 전체를 스캔하는 classifier, (3) 상시 red-team으로 구성되며, adaptive Best-of-N 공격 기준 공격성공률(ASR) 1%를 달성했다고 밝혔다 — 단, "1%도 여전히 유의미한 리스크"라고 명시. — https://www.anthropic.com/news/prompt-injection-defenses (fetched 2026-09-20) VERIFIED
- OWASP MCP Security Cheat Sheet: tool allowlist는 이름뿐 아니라 파라미터 스키마·리턴 스키마까지 고정(hash pinning)해야 하며, confused-deputy 방지를 위해 요청마다 세션/토큰이 현재 요청자 것인지 검증하고 서버별로 scoped credential을 분리 발급해야 한다. OAuth 토큰은 OS 네이티브 credential store(macOS Keychain 등)에만 저장하고 평문 config에 넣지 않는다. 파괴적/금전적/데이터공유 작업에는 explicit human confirmation을 강제한다. — https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html (fetched 2026-09-20) VERIFIED
- Simon Willison의 Dual-LLM 패턴(2023)은 Privileged LLM(도구 호출 가능, 원 사용자 쿼리만 봄)과 Quarantined LLM(신뢰 못 할 데이터를 처리하지만 도구 호출 권한 없음)을 분리한다. Google DeepMind의 후속작 CaMeL은 커스텀 인터프리터로 capability/의존성을 추적해 AgentDojo 벤치마크에서 injection 공격의 67%를 방어했다고 보고됐다. — https://simonwillison.net/2025/Apr/11/camel/ (fetched 2026-09-20) VERIFIED
- whatsapp-web.js는 WhatsApp Web의 "공식 버전"에 붙는 방식이라 완전 리버스 엔지니어링 라이브러리(Baileys 등)보다는 밴 위험이 낮다고 알려져 있지만, 여전히 비공식 연결이며 실제 밴 트리거는 "먼저 연락한 적 없는 사람에게 선제 메시지 발송", 응답 없는 메시지 누적 등 행동 패턴이다(2026년 업데이트로 unanswered-message 카운팅 추가). — https://wwebjs.dev/ , https://wapisimo.dev/blog/en/whatsapp-unofficial-api-ban-risk (fetched 2026-09-20) VERIFIED(정성적 평가는 업체 블로그 기반이라 신뢰도 medium)
- Telegram MTProto 유저 계정 자동화(Telethon 등)는 대량 join/고빈도 발송/스크래핑 등 "abusive automation"으로 판단되면 서버가 계정을 제한·영구 정지할 수 있다; bot API가 아닌 user API는 서버 입장에서 "사람"으로 취급되므로 사람다운 사용 패턴 유지가 리스크를 낮춘다. — https://github.com/LonamiWebs/Telethon (fetched 2026-09-20) VERIFIED
- LinkedIn 공식 User Agreement는 "headless browser"나 탐지 가능한 확장 프로그램을 포함한 모든 자동화 소프트웨어/스크래핑을 명시적으로 금지한다. 위반 시 단계적으로 24~72시간 connection-request 일시정지부터 영구 제한까지 갈 수 있고, 2026년 기준 "Reputation Gradient"(계정 나이·수락률·이력 기반 동적 한도)가 적용된다고 보도됨. — https://www.linkedin.com/help/linkedin/answer/a1341387 , https://www.linkedin.com/help/linkedin/answer/a1340567 (fetched 2026-09-20) VERIFIED (ToS 부분은 1차 소스, 수치·"Reputation Gradient" 용어는 업체 블로그 기반이라 medium)
- 카카오톡은 자체 안티어뷰징 시스템으로 비정상 이용 패턴을 자동 감지해 이용제한조치를 내리며, 2021년 3월 카카오톡 봇 계정 및 봇 소유자의 본계정까지 대규모 정지된 선례가 있다(비공식 봇 사용에 대한 책임은 사용자 본인). — https://talksafety.kakao.com/measure , https://namu.wiki/w/카카오톡 봇 (fetched 2026-09-20) VERIFIED(선례는 나무위키 출처라 신뢰도 medium)

## 3. Options / Comparison

| 영역 | 옵션 A | 옵션 B | 옵션 C | omnis 적합성 |
|---|---|---|---|---|
| 토큰 보관 (macOS) | `security` CLI 직접 호출 + Keychain | `tauri-plugin-keyring`(앱이 Tauri일 경우) | 1Password CLI(`op`) + service account | Tauri 앱이면 B, CLI/스크립트 레이어는 A 또는 C 병행 |
| config/설정 시크릿(git 추적) | sops+age | git-crypt | 평문 .env(비권장) | sops+age — diff 가능, 기기별 age recipient 분리 용이 |
| 메시지 DB 암호화 | SQLCipher | FileVault 단독 의존 | 앱 레벨 필드 암호화(선택적) | SQLCipher 필수, FileVault는 보조 |
| mini 노출 | Tailscale (ACL + Serve) | VPN(WireGuard 수동) | 공인 IP + reverse proxy | Tailscale — 이미 구축됨(vigor 참고), identity header로 agent별 구분 가능 |
| Prompt injection 방어 | Dual-LLM / CaMeL식 분리 | 단일 LLM + classifier 스캔만 | 아무 방어 없음 | MVP는 classifier 스캔 + tool allowlist + human-in-the-loop(단일 LLM), Dual-LLM 분리는 Later |
| WhatsApp 연결 | whatsapp-web.js(비공식) | WhatsApp Business API(공식, 유료) | 사용 안 함 | MVP는 whatsapp-web.js(1인 개인용, 저비용) + 엄격한 rate limit, 자금 생기면 Business API 검토 |
| Telegram 연결 | MTProto user account(Telethon류) | Bot API | 둘 다(계정+봇 채널 구분) | user account 필요(개인 DM 수집 목적), cadence 제한 필수 |

## 4. Recommendation for omnis

**설계 원칙**: omnis는 "받은 편지함"과 "실행 권한"을 같은 프로세스에 두는 순간 단일 장애점(SPOF)이자 단일 공격 표면이 된다. 통제는 채널 계정 자체(ToS/ban)와 agent 실행 권한(prompt injection) 두 축으로 분리해서 설계해야 한다.

### Must-have for MVP
1. **시크릿 저장** — macOS Keychain(모든 OAuth 토큰/API 키), Tauri 앱이면 keyring plugin으로 감싼다. 절대 config 파일에 평문 저장 금지. Effort: S. Risk: 낮음(macOS 성숙 기능).
2. **at-rest 암호화** — 메시지 스토어는 SQLCipher로 전환(SQLite 기반이면 파일 헤더만 바꾸면 됨). FileVault는 이미 켜져 있다고 가정하되 그것만으론 부족하다는 걸 문서화. Effort: S. Risk: 낮음(5~15% 오버헤드, 이미 검증된 라이브러리).
3. **tailnet-only 노출** — 미니의 api_server(:8642) 등은 Tailscale ACL(tag:hub, tag:client)로 제한하고 `tailscale serve`의 identity header로 "어느 클라이언트의 어느 agent"가 요청했는지 로그에 남긴다. Effort: S(이미 vigor로 tailnet 구축돼 있음). Risk: 낮음.
4. **Agent 권한 모델** — 채널×연락처 단위로 `read / draft / send-with-approval / send-autonomous` 4단계. 기본값은 항상 `draft`(제안만, 발송은 사람 승인). `send-autonomous`는 화이트리스트 연락처(예: 정기 보고용 봇)에만, opt-in. Effort: M(UI+데이터 모델 필요). Risk: 중간 — 잘못 설계하면 나중에 리팩터링 비용 큼, 처음부터 세분화해서 설계.
5. **outbound human-in-the-loop 기본값** — 모든 send 액션은 발송 전 사람이 실제 내용을 보고 승인(OWASP MCP cheat sheet 권고와 동일). "요약"이 아니라 실제 발송될 텍스트 전문을 보여줄 것. Effort: S~M.
6. **prompt injection 최소 방어선** — (a) inbox에서 온 텍스트는 항상 "data"로 태깅해 시스템 프롬프트와 분리, (b) 발송/코드실행 도구는 작업 단위로 allowlist(예: "이 이메일 답장 초안 작성" 작업에는 send 도구 자체를 아예 안 준다), (c) untrusted 콘텐츠에 대해 최소 하나의 classifier 스캔(Anthropic 모델 자체의 injection 저항 + 자체 룰 기반 키워드 스캔 병행). Dual-LLM 전면 도입은 Later. Effort: M. Risk: 중간~높음 — 이 리스크가 omnis의 존재 이유(에이전트가 광범위 접근권 보유)와 직결되므로 과소투자 금지.
7. **audit log** — 모든 agent action(읽음/초안 생성/발송/코드실행)을 append-only 로그에 남기고(SQLite 별 테이블도 충분), 최소 90일 보관. Effort: S.
8. **kill switch** — 전역 토글 하나로 모든 autonomous 액션을 즉시 멈추는 기능(UI 버튼 + CLI). Effort: S.
9. **채널별 human-like cadence** — WhatsApp/Kakao/LinkedIn/Telegram 자동 발송에는 rate limit + 랜덤 지연 + "먼저 연락하지 않은 사람에게 선제 발송 금지" 규칙을 하드코딩. Effort: S. Risk: 이 자체가 ban 리스크에 대한 완화책이지 회피책은 아님 — 문서에 명시.

### Later (post-MVP)
- **Dual-LLM / CaMeL식 분리**: privileged planner LLM과 untrusted-content-handling LLM을 분리해 injection이 도구 호출 자체를 오염시키지 못하게. Effort: L. Risk: 아키텍처 재작업 필요하지만 장기적으로 가장 강력한 방어.
- **sops+age 기반 config 암호화 + git 커밋**: 개발 편의(diff 가능) 대비 회사 GitHub에 config를 올리는 리스크 상쇄. Effort: S이지만 지금 당장 필요성은 낮음(1인 솔로 개발이라 git 협업 압박 적음).
- **1Password 통합**: 이미 Hermes Agent가 1Password skill을 지원하므로, 1인 사용자에게는 Keychain으로 충분할 수도 있음 — 여러 vault/여러 사람과 공유가 필요해지면 도입. Effort: M.
- **WhatsApp Business API 전환**: 계정이 커지거나 예산이 생기면 공식 API로 ban 리스크 원천 제거. Effort: L(승인 절차 + 비용).
- **VM/컨테이너 수준 agent 격리**(Anthropic Cowork 방식): 맥미니에서 여러 agent 세션이 동시에 도는 만큼, 나중에 코드실행 agent를 sandbox(bubblewrap 등)로 격리. Effort: L.
- **hub-in-MacBook 전환 시 변경점**: (1) Tailscale ACL이 "mini→client"에서 "peer-to-peer"로 바뀌어 사설 tag 구조 재설계 필요, (2) 카카오톡/LinkedIn 세션(현재 mini에 상주)을 어디에 둘지 재결정 — API-less 채널은 여전히 "이 세션을 유지하는 한 대"가 필요하므로 완전 hub-less는 카카오톡·LinkedIn이 공식 API를 받지 않는 한 사실상 불가능, (3) SQLCipher 키 배포를 여러 기기 간 동기화하는 문제가 새로 생김(현재는 미니 하나만 키를 가지면 됨).

## 5. What to borrow

- **Anthropic Claude Code의 샌드박스 전략**(Seatbelt/bubblewrap, "읽기는 자유·쓰기는 workspace 제한·네트워크 기본 차단")을 macOS mini/맥북에서 도는 코드실행 agent(Codex, claude-ds)에 그대로 적용 — https://www.anthropic.com/engineering/how-we-contain-claude 의 "Sandboxing & Isolation" 섹션 참고.
- **Anthropic의 auto-mode classifier 아이디어**("승인율 93%로 approval fatigue 발생 → model-based classifier가 사전 차단") — omnis의 approval UI 설계 시 "매번 물어보기"가 아니라 위험도 낮은 액션은 classifier로 자동 필터링하고 위험도 높은 것만 사람에게 올리는 구조를 채택.
- **OWASP MCP Security Cheat Sheet의 tool allowlist hash-pinning**(이름뿐 아니라 파라미터 스키마까지 고정) — omnis가 MCP 스타일로 채널별 도구(send_slack, send_whatsapp 등)를 노출한다면 그대로 적용.
- **Hermes Agent의 1Password skill 문서**(`hermes-agent.nousresearch.com/docs/user-guide/skills/optional/security/security-1password`) — 이미 Logan이 Hermes를 미니에서 24/7 돌리고 있으므로, 구조를 그대로 참고해 omnis의 시크릿 관리 skill로 이식 가능.
- **1Password CLI의 secret reference 패턴**(`op://vault/item/field`, `op run`) — 코드/설정에 평문 없이 시크릿을 주입하는 패턴을 omnis의 agent 실행 스크립트(claude-ds 호출 등)에 그대로 적용.
- **Tailscale Serve의 identity header 재주입 방식**(스푸핑 방지를 위해 들어오는 헤더는 무조건 제거 후 재주입) — omnis가 "어느 클라이언트/agent가 요청했는가"를 신뢰성 있게 로그로 남기는 메커니즘의 참고 구현.

## 6. Open questions

- WhatsApp을 whatsapp-web.js(비공식)로 갈지, 예산이 생기면 바로 WhatsApp Business API로 갈지 — 지금 결정할지, 계정 정지를 한 번 겪고 결정할지?
- `send-autonomous` 권한을 부여할 연락처/상황의 구체적 기준(예: "정기 보고 받는 팀원"만? "먼저 온 메시지에 대한 정형 답변"만?)이 아직 미정 — 제품 기획서(다른 리서치 파일)와 연동 필요.
- 맥미니 한 대가 단일 장애점인데, 미니가 죽었을 때 카카오톡/LinkedIn 세션 복구 전략(재로그인 필요 여부, QR/2FA 재인증 빈도)은 별도 조사가 필요함(이 문서 범위 밖).
- Dual-LLM/CaMeL식 아키텍처를 Vercel AI SDK/eve 위에서 어떻게 구현할지는 SDK 리서치 파일과 교차 확인 필요.
- 회사(Onword Lab) GitHub에 코드를 올린다고 했는데(브리프 3번 줄), private repo인지 확인 필요 — public이면 sops+age 암호화가 MVP로 격상돼야 함.

## 7. Sources

- https://zottmann.org/2023/04/30/til-how-to.html (macOS Keychain CLI)
- https://v2.tauri.app/plugin/stronghold/
- https://github.com/HuakunShen/tauri-plugin-keyring
- https://github.com/tauri-apps/tauri/discussions/7846
- https://github.com/sqlcipher/sqlcipher
- https://oneuptime.com/blog/post/2026-02-02-sqlcipher-encryption/view
- https://support.apple.com/guide/security/volume-encryption-with-filevault-sec4c6dc1b6e/web
- https://www.1password.dev/cli/secret-references
- https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/security/security-1password
- https://www.jonashietala.se/blog/2026/05/31/sops_age_and_sealed_secrets/
- https://tailscale.com/docs/features/tailscale-serve
- https://tailscale.com/docs/concepts/tailscale-identity
- https://tailscale.com/docs/features/access-control/acls
- https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf
- https://www.anthropic.com/engineering/how-we-contain-claude
- https://www.anthropic.com/news/prompt-injection-defenses
- https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
- https://simonwillison.net/2025/Apr/11/camel/
- https://wwebjs.dev/
- https://wapisimo.dev/blog/en/whatsapp-unofficial-api-ban-risk
- https://github.com/LonamiWebs/Telethon
- https://www.linkedin.com/help/linkedin/answer/a1341387
- https://www.linkedin.com/help/linkedin/answer/a1340567
- https://talksafety.kakao.com/measure
- https://namu.wiki/w/카카오톡 봇
- https://github.com/block/buzz (참고용 리포지토리 — 브리프에서 언급된 오픈소스, description: "A hive mind communication platform", 33,695 stars, Apache-2.0)

(모든 URL 확인일자: 2026-09-20)
