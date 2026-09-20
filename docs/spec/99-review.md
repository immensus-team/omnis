# 99 — 전역 일관성 리뷰

2026-09-20. 대상: 마스터 `00-omnis-design.md`, `A1`~`A8`, `BRIEF-2026-09-20.md`, `research/00-SYNTHESIS.md`.
각 부록의 자체 "리뷰 노트"는 반복하지 않고 **부록끼리 또는 부록↔마스터가 어긋나는 것**만 모은다.

---

## 1. 모순

### 1.1 Blocker — A4가 쓰는 스키마가 A3에 없다

A4 자체 리뷰가 3건(`sensitivity`, `calendar_events`, Task 라우팅 필드)을 잡았는데 **5건이 더 있다.** 전부 A4의 SQL이 A3 DDL을 직접 참조해 그대로는 구현 불가다. **고칠 쪽은 전부 A3.**

| A4 | 참조 | 영향 |
|---|---|---|
| §2.2 kNN SQL | `items.embedding` | 없으면 T0 kNN($0 경로)이 통째로 죽고 §10.1의 월 $21 추정이 무너진다 → `vector(768)`+부분 HNSW |
| §2.3 | `label_rules` 테이블 | A4가 자체 DDL을 들고 있다. `0003_labels.sql`로 편입. `label_rules.id/label_id`는 `text`인데 A3 `labels.id`는 `uuid` |
| §1.7 | `agent_runs` | A4-D16이 "평가·비용·감사의 단일 소스"로 못박았는데 A3 §8 목록에 없다 |
| §7.2~7.4 | `persons.first_contact_at / item_count / primary_thread_id / cadence_days / priority_score`, `relationship_state='warming'` | CHECK가 `unknown/new/active/dormant/closed`라 §7.4 출력이 **런타임 CHECK 위반** |
| §7.3, §8.3, §3.1 | `tasks.kind`, `threads.meta`, `items.meta.pending` | A3엔 `draft_meta`뿐. 컬럼 추가 + A4 표기 정정 |

### 1.2 부록끼리 값이 다른 것

형식: `항목 — 충돌 → 고칠 쪽`.

- **`idle_replication_slot_timeout`** — A3 §7 `'2h'` ↔ A6-D4 `'3d'` → **A3**. GUC는 `postgresql.conf` 소관이고 논증은 A6에만 있다
- **Keychain 명명** — A1 `omnis.slack.xoxp.<team_id>` ↔ A6-D9 `omnis-slack-bot-token` → **A6**. A1이 코드 예시에 박았고 external_id 세그먼트가 필요
- **허브 로컬 포트** — A6 §1/§3 `127.0.0.1:8642` ↔ A2 §4.4 Hermes가 같은 포트 → **A6+마스터**. 미니에서 둘 다 뜨면 충돌, 허브를 `8787`로
- **Postgres 버전** — A3 "16+" ↔ A6 `@17` ↔ A7 CI "16" → **A3·A7**, 17 고정
- **마이그레이션 경로·파일명·추적표** — A3 `db/migrations/0001_extensions.sql`·`_omnis_migrations` ↔ A7 `packages/db/migrations/0001_core.sql`·`schema_migrations` → **A7**. A3가 스키마 오너이므로 US-A02~A04를 A3의 8파일 분할로 재작성(A7 노트1의 `agent_runtimes` 누락도 A3 `0004`가 덮는다)
- **다이제스트 시각** — A4 06:30/23:00 ↔ A3 `jobs` 07:00/22:30 ↔ A5 카피 "00:30" → **A3·A5**. 스케줄 오너는 A4
- **Phase 0 번호** — A1 §4 ③=kmsg ↔ 마스터/A6 ③=FileVault → **A1**을 `A1-①~⑧`로
- **`author` 값 집합** — A1 `person|system` ↔ A3 3컬럼 ↔ A2 agent → **A1·A2**를 A3로 정렬
- **표기 3건** — A7이 아직 `delegate.run`/`calendar.write`; A8 `@omnis/app` ↔ A7 `@omnis/desktop`; A5 §3.9 "비용 상한 읽기 전용" ↔ A4 §10.4 "Settings에서 변경" → **A7 / A8 / A5**

### 1.3 부록↔마스터

- **§2 "채널 7개"** ↔ §3·§8·A1은 **8개**. 마스터 오기.
- **G1~G6이 어디에도 정의되지 않았다.** §16·A1 §2.1·A2-D4·A6 §11이 전부 인용하는데 마스터 §2 표엔 G 번호가 없다. 게다가 A1은 "G5(5초)", A2/A6는 "G5(2초)" — **같은 ID에 다른 값**(A1이 G1을 G5로 오기).
- **§6 표가 A3와 4곳 불일치**(A3 노트3). A3가 더 정확하므로 **마스터를 갱신**.
- **§11 루프 7개 중 자동 보관을 생산하는 루프가 없다** — A4 §6.4의 `auto_archived`가 소유자 없이 떠 있다.
- **§14 T2의 "Haiku 4.5"**가 A4 §10.1 라우팅표에 한 번도 안 나온다.
- **§16 Phase 0 "1주"** — 부록 추가분까지 30개(§5). 1주 불가.

---

## 2. 브리프가 요구했는데 비거나 얇은 것

1. *"맥미니의 코덱스 에이전트와 헤르메스도... 맥북의 코덱스 에이전트, 딥시크 에이전트, 헤르메스도 다 접근 및 사용이 가능하다는거야."* → **최대 갭.** D1/A2-D9가 Hermes를 "Phase C 이후 선택, 안 쓰면 영구 보류"로 내렸다. 더해 A2 §2.1엔 **미니용 TOML 예시가 없고 Hermes용 `[[runtime]]` 스키마도 없다**(`binary`/`pinned_version`은 HTTP 클라이언트에 무의미).
2. *"local, drive, github, 등등의... 수집 가능한 모든 데이터를 모아서 제작해줘."* → 마스터 §10 한 문단, A3의 `source_kind`와 폴링 잡뿐. **A1은 채널 전용, A4 루프 7개에 ingestion이 없다** — 허용 폴더·청킹·실패 처리의 소유 부록이 없다.
3. *"Archive 기능이 있어서... 매일 밤 내가 summary를 보고 다시 한번 더 확인"* → 되살리기 UX(A4 §6.4·A5 §3.8)는 훌륭하나 **"무엇을 자동 보관하는가"의 규칙·티어·임계가 전무.**
4. *"에이전트가... 코덱스, 혹은 헤르메스 에이전트에게 상황에 맞게 먼저 일을 시키기도 하고"* → A4 §4.4/§5.1이 위임을 **수동 트리거 전용**으로 확정. 근거(`17`)는 타당하나 브리프와 정면으로 다르니 §19로 올려야 한다.
5. *"인박스 및 에이전트 세션들끼리 서로 상호 Understand하고 act... 다른 대화를 전부 이해하고"* → A2-D13/§6이 `read_session`을 요약으로 제한하고 **`inbox:` 세션은 아예 못 읽게** 막았다. 개발 세션이 인박스 *스레드*를 읽는 경로도 없다 — 의도된 절충이나 축소임을 명시해야 한다.
6. *"auto-labeled peope according to topics"* → 라벨을 **화면에 그리는 규칙이 없다**(A5 노트2). 마스터 §3의 "통합 검색"도 화면·Phase 배정 모두 없다.
7. *"병렬로 저렴 모델 혹은 오픈소스 모델을 돌려서 성능을 낼건지"* → A4 §10은 cascade만 평가. 병렬/앙상블을 왜 버렸는지 한 줄이 없다.

---

## 3. 마스터 수정 권고 (old → new)

1. **§2** `채널 7개` → `채널 8개`.
2. **§2 지표표 앞** G 정의 신설: `G1 채널 수신 ≤5초 / G2 8채널+4런타임 단일 정규화 / G3 초안 60초 SLA / G4 승인 없는 외부 전송 0 / G5 기기 간 동기화 ≤2초 / G6 standalone(§4.2 D12)`. 이어서 A1 §2.1 `G5(5초)` → `G1(5초)`.
3. **§6 표** `accounts…auth_ref` → `account_secrets(Zero 제외)`; `pending_approvals…payload` → `args + decision`; `digests…items[]` → `item_ids`; `threads…labels[]` → `thread_labels(조인)`. 행 추가: `items.sensitivity`, `items.embedding`, `threads.meta`, `agent_runs`, `label_rules`, `person_merges`.
4. **§11 표** 행 2개 추가 — `자동 보관`(반응형/T0+T1/read만/`status='archived'`, 7일 undo)과 `ingestion`(배치/T0/로컬·Drive·GitHub→`memories`). §10의 ingestion 소유 부록을 A4로 명시.
5. **§7 승인 게이트** 끝에: `자동 보관은 egress가 아니므로 승인이 아니라 7일 undo로 보장한다(A4 §6.4).` (A4-D3의 `archive.apply` 삭제와 짝.)
6. **§14** `T2 Claude Sonnet 5 / Haiku 4.5` → `T2 Claude Sonnet 5`.
7. **§15·§4.2** 허브 로컬 포트 `8787` 명기(Hermes `8642` 충돌).
8. **§16 Phase 0** `1주` → `2주. 게이트 14개(§16 8개 + A1-①② + S-A2-1·2 + S-A3-2 + worktrunk), 나머지 16개는 Phase 진입 시.`
9. **§16 Phase B** 범위에 `통합 검색` 추가(현재 어느 Phase에도 없다).
10. **§19** Q7 Hermes 편입 Phase(**B에 read-only, C에 위임**) / Q8 Phase D 맥북 상시전원 vs 미니 병행(**미니 병행**) / Q9 라이선스(**Apache-2.0**) / Q10 위임 자동 트리거(**수동 유지**, 브리프와의 차이 명시).

---

## 4. 결정 필요 항목 (중복 제거·빌드 영향 순)

형식: `결정 (출처) → 권고 기본값`.

1. A4가 쓰는 스키마를 A3에 반영(§1.1) → **전부 A3에 추가.** Phase A~B 대부분이 물려 있다
2. `events_rolloff` 잡의 DB role (A3 blocker) → **SECURITY DEFINER 함수**로 감싸고 `omnis_hub`는 호출만
3. 허브 로컬 포트 → **8787**
4. Hermes 편입 Phase → **B에 read-only 어댑터** + A2 §2.1에 Hermes `[[runtime]]`(`base_url`, `token_keychain_item`)·미니 TOML 예시 추가
5. 자동 보관 루프 소유자 + `archive.apply` → **A4-D3에서 삭제**, 마스터 §11에 루프 신설
6. FileVault ON 가부 (A6-D2) → 스파이크 ③ 먼저. 실패 시 OFF + tailnet-only, Logan 승인
7. Opus 3회 실패 시 종료 조건 (A7 노트2) → **중단 + Logan 에스컬레이션.** fable 자동 상승 금지 유지
8. `omnis` RuntimeKind 처리 (A2 노트1) → `agent_runtimes`에 1 row만, `RuntimeAdapter` 없음
9. 동시성 캡 기준 (A2 노트3) → **호스트당 활성 턴 4개**(프로세스 기준은 Codex에 무의미)
10. Phase D 맥북 상시전원 (A6 §12) → **미니 병행**(capture sidecar)
11. iPhone Digest 진입로 (A5 노트1) → Today 상단 카드 + Web Push 1종, 탭바 5칸 유지
12. topic/person 라벨 시각 표현 (A5 노트2) → InboxRow 2행 우측 칩 2개 + `+N`
13. KakaoTalk send 버튼 게이팅 (A5 노트4) → 14일 미만이면 비활성 + 잔여일 표시
14. `vip` vs cadence 우선순위 (A4 노트5) → **vip 오버라이드(14일)**
15. Adapter `archive()`/`disconnect()` (A1 노트2) → 추가. A1-D1을 "메서드 목록은 확장"으로 정정
16. 라이선스 (A8-D9) → **Apache-2.0**

---

## 5. 통합 스파이크 (중복 제거 30개)

**중복 제거**: 마스터 ⑧ = `S-A3-4` = `S-A4-3`(로컬 임베딩 처리량). `A6-10` = `S-A4-1`(로컬 소형 분류기).

**Phase 0 게이트 14개 — 통과 전 Phase A 착수 금지** (`내용 → pass`).
① Calendar watch via Funnel → 핸드셰이크+알림 1건 · ② Beeper+WhatsApp 부번호 send → 200+수신+24h 무제재 · ③ FileVault ON+자동 로그인 → 재부팅 후 무개입 GUI 세션 · ④ kmsg read → 48h 연속, 권한 재요청 0 · ⑤ Serve HTTPS @ iPhone → SSL 에러 0 · ⑥ Zero+Postgres → 반영 ≤2초(G5) · ⑦ Codex app-server 핀+1턴 → 에러 0 · ⑧ nomic-embed → 1,000문장 ≤120s, p95 ≤300ms · A1-① Slack Socket Mode → ≤5초(G1) · A1-② Gmail watch+Pub/Sub → `historyId` 수신 · S-A2-1 `-p --bare` hook 주입 → 승인 게이트가 뜸 · S-A2-2 `--permission-mode`↔profile → 3 profile 확정 · S-A3-2 Zero의 `vector`/`tsvector`/`uuid[]`/generated → 복제+쿼리 성공 · A7-1 `worktrunk` 드라이런 → create/remove 왕복.

**Phase 진입 시 16개** (pass 기준은 각 부록 원문 유지).
A1-③ Outlook webhook · A1-④ Telegram QR · A1-⑤ LinkedIn 알림메일 파싱 · S-A2-3~6 · S-A3-1·3·5 · **S-A4-1(=A6-10)** 로컬 분류기 선정(recall ≥0.9, 오탐 ≤0.15, p95 ≤800ms) · S-A4-2 · S-A4-4 · **S-A4-5** cache-hit ≥60% · **A6-9** 8프로세스 RSS 합 ≤10GB · A7-2 Tauri UI 테스트.
**A6-9와 S-A4-5는 Phase A 종료 기준의 전제**라 Phase A 안에 반드시 돈다.

---

## 6. 판정

**ready for Logan's review = No.** 골격(3테제, 4층, D1~D16, 채널 매트릭스, 승인 게이트)은 검토할 만큼 단단하다. 다만 **§1.1의 A3↔A4 단절 5건은 읽으면 보이는 오타가 아니라 코딩 에이전트가 Phase A 중반에 멈추는 종류**이고, A3 role blocker와 G1~G6 미정의까지 더하면 지금 ralph를 돌려봐야 스키마 협상에 시간을 태운다. §3의 10건과 §4의 1~5번만 닫으면 ready — 반나절 분량이다.

**Logan이 먼저 볼 5가지**

1. **Hermes를 Phase B로 당길 것인가** (§2 1행). 브리프가 두 호스트에 명시한 요구인데 지금은 "영구 보류 가능"이다. 답에 따라 A2 §2.1과 마스터 §3·§16이 함께 바뀐다.
2. **위임 자동 트리거를 포기할 것인가** (§2 4행). *"먼저 일을 시키기도 하고"* 대 A4의 수동 전용. omnis의 핵심 차별점이고 상용 전례가 없어 Logan만 정할 수 있다.
3. **자동 보관의 판정 규칙** (§2 3행). 밤 다이제스트 명세는 훌륭한데 "무엇을 보관할지"가 비어 있다. 어떤 메일을 안 봐도 되는지는 취향이라 기본 규칙을 직접 정해야 한다.
4. **비용 상한에 걸렸을 때의 동작** (§19 Q4 + A4 §10.4). A4는 `degraded`에서 민감·VIP 스레드를 T1로 강등하지 않고 **초안 생성을 아예 중단**한다 — 상한에 걸리면 VIP 초안이 사라진다는 뜻인데 이게 맞는지.
5. **Phase D의 정직한 정의를 어디까지 감수할 것인가** (§4-10, D12). 맥북이 유일한 상시 노드가 되면 잠자는 순간 서비스가 멈춘다. 기본값 미니 병행은 "결국 맥북만으로"라는 브리프 최종 그림과 다르다.

---

*본 문서는 진단만 한다. §3·§4의 적용은 Logan 확인 후 별도 패스에서.*
