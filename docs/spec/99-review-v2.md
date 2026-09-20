# 99 — 전역 일관성 리뷰 v2 (pass 2)

2026-09-20. 대상: 마스터 v0.95, A1~A8 수정본(각 "수정 이력" 포함), `99-review.md`(pass 1), `../BRIEF-2026-09-20.md`.
pass 1의 진단은 반복하지 않는다. **닫힌 것 / 남은 것 / 새로 생긴 것**만 적는다.

---

## 1. pass 1에서 닫힌 항목

- **§1.1 (A3↔A4 단절 5건)** — 전부 닫힘. A3 v0.95가 `items.embedding`+부분 HNSW, `label_rules`(uuid), `agent_runs`, `persons` 5열 + `warming`, `tasks.kind`·`threads.meta`·`items.meta.pending`을 전부 편입했고 A4가 자체 DDL 2개를 삭제했다.
- **§1.2 (부록끼리 9건)** — 8건 닫힘: slot timeout(A6 `'3d'` 단일 오너), 포트 8787, PG17, 마이그레이션(`packages/db/migrations` + `_omnis_migrations`), 다이제스트 06:30/23:00, `author` 3열, 표기 3건(`delegate`/`calendar_write`, `@omnis/desktop`, 비용 상한 편집 가능). Keychain은 **부분**(§4-4), Phase 0 번호는 **A1만**(§4-2).
- **§1.3 (부록↔마스터 6건)** — 4건 닫힘: G1~G8 정의 신설, §6 표 갱신, §11에 자동 보관·ingestion 루프 추가(7→9), Phase 0 2주·14게이트. 채널 수와 Haiku 4.5는 **절반만**(§2-1, §2-2).
- **§2 (브리프 갭 7건)** — 전부 문서화됨: Hermes Phase B/C, A4 §10 L9 ingestion, 마스터 §11 자동 보관 규칙 4개 + A4 §9, 위임 자동 제안, `read_session` 축소의 명시, 라벨 칩 + ⌘K 검색, 앙상블 기각 근거.
- **§3 마스터 10건 / §4 결정 16건** — 전부 반영(§19 Q7~Q12 신설 포함).

---

## 2. 남은 모순

1. **마스터 §16 Phase C "7채널 전부 인박스에"** ↔ §2·§3·A5 §3.1·A8 §1.7 "8채널" → **마스터 §16**을 8채널로. (§2만 고치고 §16을 놓쳤다.)
2. **마스터 §5 D9 "T2 Claude Sonnet 5/Haiku 4.5"** ↔ §14·A4-D12·A4 §12.1 "T2 = Sonnet 5 하나" → **마스터 §5 D9**에서 Haiku 4.5 삭제.
3. **local-agent 설정 소스** — A6 §10.1 plist는 `--hub <url>` 인자, A2 §2.1은 `~/.omnis/local-agent.toml`. 우선순위 규칙이 어디에도 없다(A6 노트1, 미해결) → **A2**에 "CLI 인자가 TOML을 오버라이드" 한 줄, A6는 인용만.
4. **A5 §3.6 `threads.person_id`** — A3에 없는 컬럼(A5 노트1). A3 v0.95가 `persons.primary_thread_id`를 추가했으므로 이제 고칠 수 있다 → **A5**가 역방향 조인으로 재작성.
5. **스케줄 정본 ↔ seed** — A4 §6.1이 스케줄 오너인데 그 표의 5개(`auto_archive_sweep`, `task_remind`, `network_inactive_sweep`, `self_model_weekly`, `eval_weekly`)가 A3 `jobs` seed에 없고, 거꾸로 A3에만 있는 인프라 잡 6개가 A4 "전체 목록"에 없다 → **A3** seed에 5행 추가 + **A4** 표 제목을 "A4 소유분"으로 한정.

---

## 3. 브리프 대비 남은 갭

1. **맥북 로컬 파일 ingestion의 호스트가 미정.** A4 §10.1은 FSEvents를 쓴다고만 하고 어느 기기인지 없다. 허브는 미니이므로 그대로 읽으면 미니 파일만 들어온다. 브리프는 *"맥락에 따라 로컬 파일을 수집해 오라거나"* 와 맥북 로컬을 명시 → A4 §10.1에 host 열 + 맥북 `local-agent` 경유 경로.
2. **에이전트↔에이전트 직접 지시는 여전히 없다.** 모든 위임이 omnis L3 → 승인 → 대상 브리지다. 브리프의 *"서로에게 일을 시킬 수 있어야"* 와 다르고, 의도된 축소라는 설명은 §19 Q10 한 줄뿐이다.
3. **폰 알림이 초안에 도달하지 않는다** — §4-1과 동일 항목(브리프: *"초안을 작성하고 나에게 따로 알림"*).
4. 아이폰 "앱처럼 다운로드"는 Phase D까지 PWA(Q1에 명시됨, 수용 가능).

---

## 4. 수정 패스가 새로 만든 불일치

1. **Web Push 1종 (실질 blocker).** 마스터 §12와 A5 §4.4가 "Web Push는 한 종류(밤 다이제스트 준비됨)"로 못박았는데, A4 §3.6은 즉시 푸시(초안 80자 미리보기 + Approve)와 묶음 푸시(3시간 간격)를 정의한다. 지금 문장대로면 **폰에서 초안 알림이 사라진다** → **마스터 §12·A5 §4.4**를 "Digest 진입 푸시는 1종"으로 한정(알림 정책 오너는 A4 §3.6).
2. **A1 스파이크 번호가 두 문서에서 다른 뜻.** A1이 `A1-①`Calendar·`②`Beeper·`③`kmsg·`④`Slack·`⑤`Gmail로 리라벨했는데 A6 §11.1은 여전히 "A1-① Slack / A1-② Gmail", §11.2는 "A1-③ Outlook·④ Telegram·⑤ LinkedIn". 겹치는 5개 게이트의 **pass 기준도 다르다**(②: A6 "24h 무제재" vs A1 없음, ④: A6 "48h 연속" vs A1 "1회 출력") → **A6 §11.1·11.2**를 A1 번호로 정정하고 pass 기준은 A6 §11.3을 정본으로 선언.
3. **A7이 A3의 신설 테이블을 모른다.** A3 §8은 `calendar_events`와 `person_merges`를 `0002_core_inbox.sql`에 배정했는데 A7 US-A02 산출물에 둘 다 없고, US-A04는 `calendar_events`를 "A3 어디에도 정의돼 있지 않다 — UNVERIFIED"로 **명시 배제**한다(A3 §2.1에 DDL이 있으므로 문장 자체가 stale). 이대로면 Phase A가 A4 §7.1 미팅-종료 트리거와 §7.5 48시간 지표를 통째로 못 만든다 → **A7 US-A02/US-A04**.
4. **브리지 토큰 Keychain 이름 2종.** A2 §2.1 `omnis.bridge.token.<host>` ↔ A6 §9 `omnis.macbook.session_bus_token`/`omnis.mini.session_bus_token`. 둘 다 "A1 규칙을 따랐다"고 적었다 → **A6**를 A2 리터럴로(A1 스킴에 더 맞다).
5. **A5 §2.5 통합 검색이 없는 경로를 쓴다.** A5는 클라이언트가 `items.search_tsv`·`persons_name_trgm_idx`를 소비한다고 적었으나 A3 §7은 `search_tsv`를 Zero 복제에서 제외했고 A4 §14는 `GET /search`가 유일 경로라고 못박았다. 인덱스명도 `items.body_trgm_idx`↔A3 `items_body_trgm_idx`, "지연 목표치가 어디에도 없다"는 서술도 S-A4-7 신설로 stale → **A5 §2.5**를 A4 §14 `SearchResponse` 소비로 재작성.

---

## 5. 판정

**ready for Logan's review = Yes.** pass 1이 막았던 종류(스키마 단절, 미정의 목표 ID, role blocker)는 전부 닫혔고, 남은 것은 §2 5건·§4 5건 모두 **소유 부록이 분명한 기계적 수정**이라 Logan의 판단을 기다리지 않는다. 다만 **ralph 착수 전에 §4-3(A7)과 §4-2(A6 번호)는 반드시 먼저 닫아야 한다** — 전자는 Phase A 스토리가 테이블 2개를 빠뜨린 채 커밋되고, 후자는 Phase 0 실행자가 어느 pass 기준을 쓸지 모른다.

**Logan이 먼저 볼 5가지**

1. **자동 보관 판정 규칙 4개**(마스터 §11). 유일하게 취향이 정답인 항목. 규칙 ②(나에게 향한 CTA 없음, 신뢰도 0.85)가 실제로 Logan의 메일에서 어떻게 도는지가 제품 체감을 결정한다.
2. **폰 알림 정책**(§4-1). "Web Push 1종"을 그대로 두면 브리프의 *"따로 알림"* 이 맥에만 남는다. A4 §3.6의 3등급을 폰에도 적용할지 결정.
3. **위임 승인 큐의 상한**(A4 §4.4: 하루 5건, 스레드당 24시간 2건, confidence 0.70). *"먼저 일을 시키기도 하고"* 의 체감이 사실상 이 세 숫자에서 정해진다.
4. **Ingestion allowlist**(A4 §10.1, 기본값 전부 비어 있음). 로컬 폴더·Drive·GitHub repo를 Logan이 채우기 전까지 L9는 아무것도 읽지 않는다. "컨텍스트가 곧 제품"이므로 첫 입력 목록이 메모리 품질의 상한이다.
5. **Phase 0 2주를 지금 시작할지**, 그리고 FileVault ③이 fail일 때 OFF + tailnet-only를 수용할지(A6-D2), 맥북 상시전원/클램쉘(A6 §12의 마지막 `decisions_needed`).

---

*pass 1과 동일하게 진단만 한다. §2·§4의 적용은 소유 부록에서 별도 패스로.*
