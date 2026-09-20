# Open-source long-term memory for omnis (2026-09-20 리서치)

## 1. TL;DR

Hermes Agent와 OpenClaw는 둘 다 같은 패턴을 쓴다: 로컬 `MEMORY.md`/`USER.md`(+`SOUL.md`/`IDENTITY.md`) flat-file을 기본값으로 두고, 그 위에 pluggable **MemoryProvider**(Honcho, Mem0, Supermemory 등)를 붙이는 이중 구조다. 이건 Logan이 원하는 "Hermes/하네싱들이 쓰는 오픈소스 메모리"의 실체이자, omnis가 그대로 베낄 수 있는 검증된 아키텍처다. omnis는 이미 Postgres를 mini에서 돌리므로, Neo4j 같은 무거운 신규 의존성(Graphiti/Zep) 대신 **mem0(OSS, Apache-2.0, TS SDK, pgvector 지원)**을 1차 벡터/semantic 메모리로, Postgres 위에 직접 만든 bi-temporal entity 테이블(Graphiti의 valid/invalid 타임스탬프 스키마를 차용)을 Network/CRM용 엔티티 그래프로 쓰는 하이브리드를 추천한다. Honcho는 벤치마크가 가장 강하지만 AGPL-3.0이라 나중에 앱으로 배포할 계획과 충돌 위험이 있어 fallback으로만 둔다.

## 2. Facts

- Hermes Agent(NousResearch)의 내장 메모리는 `~/.hermes/memories/MEMORY.md`(~2,200자)와 `USER.md`(~1,375자) 두 파일이며, 세션 시작 시 "frozen snapshot"으로 시스템 프롬프트에 주입되고 `memory` 툴(add/replace/remove)로 관리된다. 용량 초과 시 auto-compact 없이 에러를 반환한다. — VERIFIED, https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md (fetched 2026-09-20)
- `SOUL.md`/`AGENTS.md`는 이미 context에 있는 정보로 간주되어 memory 저장에서 의도적으로 제외된다(중복 방지). — VERIFIED, 위 출처 동일
- Hermes는 `agent/memory_provider.py`의 `MemoryProvider` ABC로 외부 메모리를 플러그인화한다. 인터페이스: `name`, `is_available()`, `initialize()`, `get_tool_schemas()`, `handle_tool_call()`, `get_config_schema()`, `save_config()` + 선택적 훅 `prefetch()`/`sync_turn()`/`on_session_end()`/`on_pre_compress()`/`shutdown()`. 동시에 **하나의 외부 provider만 활성화** 가능. — VERIFIED, https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/memory-provider-plugin.md (fetched 2026-09-20)
- Hermes가 지원하는 외부 memory provider 목록에 Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory가 포함된다. — VERIFIED (WebSearch 결과 다건 교차확인, fetched 2026-09-20), 일부 목록은 서드파티 정리글(hermesatlas.com)이라 provider 존재 자체는 신뢰하되 완전성은 미검증.
- 별도 session_search(SQLite 풀텍스트)가 과거 대화 전체를 검색 가능하게 하여, MEMORY.md 용량 한계를 우회한다. — VERIFIED, 위 memory.md 출처
- OpenClaw(openclaw/openclaw, GitHub 기준 **390,095 stars**, TypeScript, license: NOASSERTION — 표준 OSS 라이선스 파일 없음)는 기본적으로 Workspace Markdown(`USER.md`, `MEMORY.md`, `IDENTITY.md`)을 쓰며, 수동 업데이트 + 세션 간 자동 영속성 없음이 기본이다. Honcho를 붙이면 자동 영속화 + 유저/에이전트 프로필 모델링 + semantic search가 추가되고, "Honcho와 내장 markdown 메모리는 병행 가능"하다고 공식 문서가 명시한다. — VERIFIED, https://docs.openclaw.ai/concepts/memory-honcho (fetched 2026-09-20); star/license는 `gh api repos/openclaw/openclaw` 직접 조회 (fetched 2026-09-20)
- Honcho(plastic-labs/honcho): GitHub **7,258 stars**, license **AGPL-3.0**, Python FastAPI 코어 + Python(`honcho-ai`)/TypeScript(`@honcho-ai/sdk`) SDK. "peer" 개념으로 유저·에이전트·그룹·프로젝트·아이디어를 전부 동일한 1급 엔티티로 모델링하고, 대화 후 비동기로 reasoning을 돌려 구조화된 표현을 만든다("reasoning-first", not retrieval-first). managed(api.honcho.dev), `honcho start`(로컬 스택), 완전 self-host(Docker Compose) 세 가지 배포 방식 지원. Claude Code/OpenCode/OpenClaw/Hermes와 통합 문서 존재. — VERIFIED, `gh api repos/plastic-labs/honcho` + README (fetched 2026-09-20)
- mem0(mem0ai/mem0): GitHub **65,649 stars**, license **Apache-2.0**, Python 코어. OSS 모드는 `Memory`/`AsyncMemory` 클래스로 완전 로컬 실행 가능(LLM+embedder를 Ollama, vector store를 Qdrant/Chroma/pgvector로 설정). TypeScript SDK는 npm `mem0ai` 패키지, OSS 서브패스 `mem0ai/oss`로 로컬 모드 지원. Graph memory 기능(Neo4j 옵션)도 있으나 코어 기능은 아니고 별도 설정. — VERIFIED, `gh api repos/mem0ai/mem0` + WebSearch 교차확인 (fetched 2026-09-20)
- Zep은 2026년에 오픈소스 전략을 바꿨다: 원래의 "Zep Community Edition"(메모리 서비스 본체) 유지보수를 **중단**하고, **Graphiti**(temporal knowledge graph 엔진)만 활성 오픈소스 프로젝트로 집중하기로 했다. 이유는 open-core 방식(기능을 일부러 제한해 유료 유도)에 대한 불편함. 기존 Zep CE 저장소는 Apache-2.0으로 계속 공개되지만 더 이상 업데이트되지 않는다. — VERIFIED, https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/ (fetched 2026-09-20)
- Graphiti(getzep/graphiti): GitHub **31,013 stars**, license **Apache-2.0**. 모든 edge(관계)에 4개의 타임스탬프를 붙이는 **진짜 bi-temporal** 모델: fact가 실제로 유효해진 시점/무효화된 시점(valid time), 시스템이 그 사실을 학습한 시점/더 이상 사실이 아님을 학습한 시점(transaction time). 백엔드로 Neo4j, FalkorDB, Amazon Neptune 지원(TS 네이티브 SDK는 없음 — Python 서비스로 띄우고 HTTP/MCP로 호출하는 구조). — VERIFIED, `gh api repos/getzep/graphiti` + https://www.getzep.com/ai-agents/temporal-knowledge-graph/ (fetched 2026-09-20)
- Letta(letta-ai/letta, 구 MemGPT): GitHub **24,801 stars**, license **Apache-2.0**. OS-inspired 2-tier 메모리(in-context core memory + out-of-context archival/recall memory를 LLM이 스스로 paging)가 핵심 아이디어. Agent runtime 전체(서버+데스크톱 앱 포함)가 무겁다 — 단순 메모리 라이브러리가 아니라 완결형 에이전트 플랫폼. — VERIFIED, `gh api repos/letta-ai/letta` + WebSearch (fetched 2026-09-20)
- cognee(topoteretes/cognee): GitHub **30,842 stars**, license **Apache-2.0**. 셀프호스팅 knowledge graph 엔진, 문서/코드/티켓/대화 등 임의 포맷을 ingest해서 그래프로 연결하는 데 특화("ECL" ingest 파이프라인). 대화형 세션 메모리보다는 문서·지식 코퍼스 통합에 강점이 있는 포지셔닝. — VERIFIED, `gh api repos/topoteretes/cognee` (fetched 2026-09-20)
- LangMem(langchain-ai/langmem): GitHub **1,672 stars**, license **MIT**. LangGraph 없이도 쓸 수 있는 함수형 프리미티브(Memory Manager: 추출/갱신/삭제/병합, Prompt Optimizer)로, 저장소를 직접 제공하는 서비스가 아니라 "메모리 로직 라이브러리"에 가깝다. — VERIFIED, `gh api repos/langchain-ai/langmem` (fetched 2026-09-20)
- supermemory(supermemoryai/supermemory): GitHub **30,573 stars**, license **MIT**, TypeScript. "완전 로컬 실행 가능"을 표방하는 memory+RAG+connector 통합 API. Hermes Agent의 공식 memory-provider 문서에서 최소 설정(API 키만 입력) 예시로 직접 언급된다. — VERIFIED, `gh api repos/supermemoryai/supermemory` + Hermes memory-provider-plugin.md (fetched 2026-09-20)
- Memori(GibsonAI/memori): GitHub **16,836 stars**, license 필드가 GitHub API상 `NOASSERTION`(비표준/명확한 SPDX 라이선스 파일 미검출 — 사용 전 LICENSE 파일 직접 재확인 필요). SQL-native(SQLite/Postgres/MySQL) 메모리 엔진, `memori.enable()` 한 줄로 기존 LLM 호출에 메모리를 붙이는 방식, conscious_ingest(단기 워킹 메모리)/auto_ingest(DB 검색) 두 모드. — VERIFIED stars/구조, UNVERIFIED 정확한 라이선스 (`gh api` 기준, 재확인 필요), fetched 2026-09-20

## 3. Options / comparison

| 옵션 | License | Stars(9/20 기준) | TS 친화성 | Bi-temporal | Entity/Person 모델링 | 로컬(M4 16GB) 적합성 | 비용 구조 |
|---|---|---|---|---|---|---|---|
| **mem0 (OSS)** | Apache-2.0 | 65,649 | 좋음(`mem0ai` npm, `/oss` 서브패스) | 약함(충돌 해소는 하나 진짜 bi-temporal 아님) | 약함(그래프 옵션은 부가기능) | 좋음(Ollama+Qdrant/pgvector로 완전 로컬) | 임베딩+LLM 호출당(로컬 모델 쓰면 거의 무료) |
| **Honcho** | AGPL-3.0 | 7,258 | 좋음(`@honcho-ai/sdk`) | 중간(peer representation이 시간에 따라 갱신, 명시적 bi-temporal 스키마는 아님) | 최고("peer" = user/agent/group/project 전부 1급 엔티티) | 가능(FastAPI+Docker self-host)하나 백그라운드 reasoning용 LLM 호출 필요 | LLM 호출(reasoning) 비용 + self-host면 인프라만 |
| **Graphiti** | Apache-2.0 | 31,013 | 없음(Python only, HTTP/MCP로 우회) | 최고(4-timestamp bi-temporal edge, 논문 기반) | 좋음(지식그래프 네이티브) | 부담(Neo4j 풀스택은 16GB에 무거움, FalkorDB가 대안) | 임베딩+LLM 추출 + 그래프 DB 운영비 |
| **Letta** | Apache-2.0 | 24,801 | 보통(REST/SDK 있으나 "메모리 라이브러리"가 아니라 "에이전트 런타임 전체"를 들여오는 것) | 없음 | 약함 | 무거움(자체 에이전트 서버) | LLM 호출 |
| **cognee** | Apache-2.0 | 30,842 | 보통 | 약함 | 중간(문서/코드 중심 그래프) | 가능 | 임베딩+LLM 추출 |
| **LangMem** | MIT | 1,672 | 없음(Python) | 없음 | 없음(로직만 제공, 저장은 직접) | 좋음(라이브러리라 오버헤드 적음) | LLM 호출만 |
| **supermemory** | MIT | 30,573 | 최고(TS 네이티브, Hermes 공식 provider) | 명시 안 됨 | 약함(RAG+connector 중심) | 좋음("fully locally" 표방) | 무료 OSS + 매니지드 옵션 |
| **Memori** | NOASSERTION(재검증 필요) | 16,836 | 보통(SQL 기반이라 언어 무관하게 쉬움) | 약함 | 약함 | 최고(SQLite 한 줄) | LLM 추출 호출만 |
| **file/markdown+embeddings (Hermes/OpenClaw 방식)** | 직접 구현이므로 해당 없음 | — | 완벽(직접 TS로 구현) | 직접 구현해야 함 | 직접 구현해야 함 | 최고(제로 의존성) | 임베딩만(선택) |

## 4. Recommendation for omnis

**하이브리드 3-레이어**를 추천한다. 하나의 벤더에 다 걸지 않는다.

1. **Self-model 레이어 (S, 위험 낮음)**: Hermes/OpenClaw 패턴을 그대로 복제 — `~/.omnis/memory/USER.md`, `SOUL.md`(Logan의 선호/톤/관계 컨텍스트), `AGENTS.md`(에이전트별 규칙). 세션 시작 시 frozen snapshot으로 시스템 프롬프트에 주입, add/replace/remove 툴로 관리, 글자 수 제한 + session_search(Postgres full-text, 이미 mini에 Postgres가 있으므로 SQLite 대신 재사용)로 보완. 새 의존성 0개.
2. **Episodic/semantic 레이어 (S~M, 위험 낮음)**: **mem0 OSS**를 인박스 메시지(Slack/Kakao/Gmail/Telegram 등) + 로컬 파일 + Drive + GitHub ingestion의 1차 저장소로 채택. 이유: Apache-2.0(배포 걱정 없음), TS SDK 존재, 이미 계획된 Postgres+pgvector 위에서 완전 로컬로 돌 수 있음(임베딩만 Vercel AI Gateway의 저가 모델 또는 로컬 임베딩 모델), 65k stars로 유지보수 리스크가 가장 낮음. bi-temporal이 약한 건 omnis 규모(1인, 데이터량 적음)에서는 크리티컬하지 않다.
3. **Entity/Network 레이어 (M, 위험 낮음)**: Graphiti나 Honcho를 통째로 들여오지 않고, Postgres에 **직접 만든 엔티티 테이블**(person, org, relationship, fact)에 Graphiti의 4-timestamp bi-temporal 컬럼(`valid_from`, `valid_until`, `recorded_at`, `invalidated_at`)만 스키마로 차용한다. Network/CRM 기능이 요구하는 "이 사람과 마지막으로 언제 얘기했고 그때 뭘 약속했나" 같은 쿼리는 이 정도 스키마로 충분히 커버되고, Neo4j/FalkorDB라는 새 런타임을 16GB mini에 얹지 않아도 된다.

**Fallback**: mem0의 reasoning 품질이 기대에 못 미치면(특히 모순 처리·유저 프로파일링) **Honcho self-host**로 교체. Honcho가 벤치마크상 가장 강하고 peer 모델이 Network 기능과 개념적으로 가장 잘 맞지만, **AGPL-3.0이 리스크**다 — omnis를 나중에 앱으로 패키징해 배포/판매할 계획이 있다면(브리프에 "나중엔 로컬 맥북+아이폰 다운로드 서비스" 목표가 명시됨) Honcho 코드를 수정해서 쓸 경우 네트워크로 서비스하는 순간 소스 공개 의무가 걸릴 수 있다. Honcho를 API를 통해서만 호출(수정 없이 그대로 self-host, 별도 프로세스)하는 형태로 격리하면 이 리스크는 크게 줄어든다.

**하지 말 것**: Letta(전체 에이전트 런타임을 통째로 들여오는 건 omnis 자체가 이미 에이전틱 오케스트레이션 레이어라 역할이 겹침), Graphiti를 1차 저장소로 삼는 것(Neo4j 풀스택 운영비가 1인 프로젝트엔 과함 — 나중에 그래프 품질이 정말 부족하면 그때 FalkorDB로 재검토).

## 5. What to borrow

- **아키텍처 자체**: Hermes의 "내장 flat-file + pluggable MemoryProvider, 동시 활성화는 1개" 패턴을 그대로 가져온다. 참고: `NousResearch/hermes-agent` → `agent/memory_provider.py`(ABC), `website/docs/developer-guide/memory-provider-plugin.md`(인터페이스 스펙: `initialize`, `get_tool_schemas`, `handle_tool_call`, `prefetch`, `sync_turn`, `on_pre_compress`).
- **frozen-snapshot 설계**: 세션 중 메모리 변경은 즉시 디스크엔 반영되지만 프롬프트엔 다음 세션부터 반영 — LLM prefix cache를 살리기 위한 트릭. omnis도 여러 인박스 채널이 동시에 LLM 호출을 트리거하므로 캐싱 비용 절감에 직접 적용 가능.
- **용량 관리 UX**: 자동 압축 없이 에이전트가 스스로 "지울 항목"을 찾게 하는 방식(Hermes memory.md) — 별도 배치 job 없이 에이전트 턴 안에서 처리되므로 구현 비용이 낮다.
- **"둘 다 켜도 된다"는 원칙**: OpenClaw 공식 문서가 "내장 markdown + Honcho 병행 가능"이라 명시한 것처럼, omnis도 self-model(markdown)과 episodic(mem0) 레이어를 분리해서 병행 — 이게 위 3레이어 추천의 근거.
- **Honcho의 peer 개념**: 코드를 가져오는 게 아니라 데이터 모델을 borrow — "user, agent, group, project, idea가 전부 동일한 1급 엔티티"라는 프레임을 omnis의 Network/CRM 스키마 설계에 그대로 적용(사람뿐 아니라 프로젝트/에이전트 세션도 같은 테이블 패턴으로).
- **Graphiti의 bi-temporal edge 스키마**: `getzep/graphiti`의 edge 타임스탬프 4종(valid_at/invalid_at/created_at/expired_at) 설계를 Postgres 테이블 컬럼으로 그대로 이식.
- **Supermemory의 최소 설정 UX**: Hermes provider 문서에서 Supermemory가 "API 키 하나만 물어보고 나머지는 알아서" 하는 설정 마법사 패턴 — omnis의 온보딩(맥미니 최초 세팅)에서 각 채널 연결 UX에 참고.

## 6. Open questions

- mem0 OSS의 그래프 메모리 기능(Neo4j 옵션)을 켜지 않고 순수 벡터+엔티티 테이블 조합으로 Network/CRM의 "관계" 쿼리(예: "이 사람을 통해 소개받은 사람들")까지 커버 가능한지 — 실제 프로토타입으로 검증 필요.
- Honcho의 AGPL-3.0이 "self-host, 무수정, API로만 호출"하는 구성에서 실제로 안전한지 — 라이선스 자문이 아니라 프로젝트 결정 사항이므로 Logan 확인 필요.
- Memori(GibsonAI)의 정확한 라이선스가 GitHub API상 NOASSERTION으로 뜬 것 — LICENSE 파일 직접 열람 필요(오탐 가능성 있음).
- KakaoTalk/LinkedIn처럼 API가 없는 채널에서 수집한 데이터를 메모리 파이프라인에 넣을 때의 ToS 리스크는 이 리서치 범위 밖(별도 채널 수집 리서치에서 다뤄야 함).
- 임베딩 비용: Vercel AI Gateway의 저가/오픈 임베딩 모델 vs 로컬(Apple Silicon MLX) 임베딩의 실측 지연시간/정확도 비교가 아직 없음.
- Hermes가 리스트한 OpenViking, Hindsight, Holographic, RetainDB, ByteRover 프로바이더는 이번 리서치에서 개별 검증하지 않았음(제출 범위 밖으로 판단, 필요시 후속 리서치).

## 7. Sources

- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md (2026-09-20)
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/memory-provider-plugin.md (2026-09-20)
- https://hermes-agent.nousresearch.com/docs/user-guide/features/memory (2026-09-20)
- https://hermes-agent.nousresearch.com/docs/developer-guide/memory-provider-plugin/ (2026-09-20)
- https://docs.openclaw.ai/concepts/memory-honcho (2026-09-20)
- https://github.com/openclaw/openclaw (gh api, 2026-09-20)
- https://github.com/plastic-labs/honcho (README + gh api, 2026-09-20)
- https://honcho.dev/ (2026-09-20)
- https://github.com/mem0ai/mem0 (gh api, 2026-09-20)
- https://mem0.ai/blog/open-source-ai-agents-with-built-in-memory (2026-09-20)
- https://docs.mem0.ai/cookbooks/companions/local-companion-ollama (2026-09-20)
- https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/ (2026-09-20)
- https://github.com/getzep/graphiti (gh api, 2026-09-20)
- https://www.getzep.com/ai-agents/temporal-knowledge-graph/ (2026-09-20)
- https://github.com/letta-ai/letta (gh api, 2026-09-20)
- https://github.com/topoteretes/cognee (gh api, 2026-09-20)
- https://github.com/langchain-ai/langmem (gh api, 2026-09-20)
- https://github.com/supermemoryai/supermemory (gh api, 2026-09-20)
- https://supermemory.ai/blog/supermemory-will-make-your-hermes-agent-crazy-powerful/ (2026-09-20)
- https://github.com/GibsonAI/memori (gh api + GitHub discussions, 2026-09-20)
- https://www.marktechpost.com/2025/09/08/gibsonai-releases-memori-an-open-source-sql-native-memory-engine-for-ai-agents/ (2026-09-20)

## Verification (adversarial)

Re-checked 2026-09-20 against primary sources only (`gh api`, raw file contents via GitHub Contents API, official docs). Where a claim could be checked against actual source code rather than a rendered doc page, source code was preferred.

| # | Claim | Verdict | Evidence (URL, fetched 2026-09-20) | Correction |
|---|---|---|---|---|
| 1 | Hermes memory = `~/.hermes/memories/MEMORY.md` (2,200 char) + `USER.md` (1,375 char), frozen-snapshot injection at session start, `memory` tool add/replace/remove, no auto-compact (hard error instead) | **CONFIRMED** | Raw file: `gh api repos/NousResearch/hermes-agent/contents/website/docs/user-guide/features/memory.md` | None. Table in the doc, "frozen snapshot" language, and "Memory does not auto-compact... returns an error" all match verbatim. |
| 2 | Hermes `MemoryProvider` ABC in `agent/memory_provider.py`; only **one** external provider active at a time; provider list = Honcho, Mem0, Supermemory, OpenViking, Hindsight, Holographic, RetainDB, ByteRover | **CONFIRMED** | Raw file: `agent/memory_provider.py` (docstring: "activated via `memory.provider` (ONE external provider at a time)"); directory listing `gh api repos/NousResearch/hermes-agent/contents/plugins/memory` → exactly `byterover, hindsight, holographic, honcho, mem0, openviking, retaindb, supermemory` | Upgrade only: the original source marked the provider list "confidence: high, list not individually verified." It is now confirmed directly from the plugin directory listing, not just WebSearch. |
| 3 | OpenClaw: 390,095 stars, TS, license NOASSERTION; defaults to Workspace Markdown (USER/MEMORY/IDENTITY.md), no auto cross-session persistence; docs say built-in markdown + Honcho "can work together" | **CONFIRMED** | `gh api repos/openclaw/openclaw` → `{"stars":390096,"license":"NOASSERTION"}`; https://docs.openclaw.ai/concepts/memory-honcho → exact sentence "Honcho and the builtin memory system can work together. Builtin search keeps local Markdown available alongside Honcho's cross-session memory." | Star count is 390,096 as of 2026-09-20 (was 390,095 at original fetch) — normal organic drift, not material. |
| 4 | mem0: Apache-2.0, 65,649 stars, TS SDK (`mem0ai` npm, `mem0ai/oss` subpath) runs fully locally on Ollama + Qdrant/Chroma/pgvector; graph memory (Neo4j) optional, not core | **CONFIRMED** | `gh api repos/mem0ai/mem0` → `{"stars":65649,"license":"Apache-2.0"}`; `mem0-ts/package.json` → `"exports": {".": ..., "./oss": {...}}` (i.e. `mem0ai/oss` is a real subpath export); `mem0-ts/src/oss/src/vector_stores/` contains `pgvector.ts`, `chroma.ts`, `qdrant.ts`; https://docs.mem0.ai/cookbooks/companions/local-companion-ollama shows a config with `vector_store.provider: "qdrant"`, `llm.provider: "ollama"`, `embedder.provider: "ollama"` | None. |
| 5 | Zep discontinued Zep Community Edition **in 2026**, refocused all OSS effort on Graphiti; old Zep CE repo stays Apache-2.0, unmaintained | **PARTIALLY REFUTED — date is wrong** | https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/ — JSON-LD `datePublished: "2025-04-02T19:25:59.000Z"` | The decision was announced **2025-04-02**, not 2026. The underlying fact (CE discontinued, Graphiti is the sole active OSS focus, old CE repo remains Apache-2.0 but unmaintained) is still true as of the 2026-09-20 fetch, but the doc's framing ("2026년에... 전략을 바꿨다") presents a ~1.5-year-old decision as new 2026 news. Fix the year to 2025 in the Facts section. |
| 6 | Graphiti: Apache-2.0, 31,013 stars, true 4-timestamp bi-temporal edges (valid_at/invalid_at + created_at/expired_at), Neo4j/FalkorDB/Neptune backends, no native TS SDK (Python service, HTTP/MCP) | **CONFIRMED** | `gh api repos/getzep/graphiti` → `{"stars":31013,"license":"Apache-2.0","language":"Python"}`; source `graphiti_core/edges.py` declares `created_at`, `expired_at`, `valid_at`, `invalid_at` fields directly on the edge model; `examples/quickstart_neo4j.py`, `quickstart_falkordb.py`, `quickstart_neptune.py` confirm all three backends; no JS/TS package in repo root | None — this is the single most directly-verified claim (checked against the actual data model in source, not docs). |
| 7 | Honcho: AGPL-3.0, 7,258 stars, FastAPI core + Python (`honcho-ai`) / TS (`@honcho-ai/sdk`) SDKs; peer model (user/agent/group/project/idea as first-class); reasoning-first not retrieval-first; managed / `honcho start` local-stack / full self-host; integrates with Hermes, OpenClaw, Claude Code, OpenCode | **CONFIRMED** | `gh api repos/plastic-labs/honcho` → `{"stars":7258,"license":"AGPL-3.0"}`; `README.md` → "Reasoning-first memory — Extracts conclusions... not just matching chunks", "Peer-centric model — Tracks users, agents, groups, projects, and ideas", "Managed or self-hosted — api.honcho.dev, honcho start locally, or run the FastAPI server yourself", integrations line lists "Claude Code, OpenCode, OpenClaw, Hermes"; repo contains a `hermes-plugin-honcho/` directory confirming the Hermes integration is first-party, not third-party glue | None. |
| 8 | Letta (24,801★, Apache-2.0), cognee (30,842★, Apache-2.0), LangMem (1,672★, MIT), supermemory (30,573★, MIT, TS-native, documented Hermes provider) — none matches Graphiti's bi-temporal fidelity or Honcho's entity modeling | **CONFIRMED, with one caveat** | `gh api repos/{letta-ai/letta, topoteretes/cognee, langchain-ai/langmem, supermemoryai/supermemory}` — all star/license figures match exactly; `plugins/memory/supermemory/` present in hermes-agent confirms it's a real, first-party provider (not just blog claims); `topoteretes/cognee` README_ko.md confirms the "ECL (Extract, Cognify, Load)" pipeline name used in the doc's positioning of cognee | **Caveat on Letta**: `letta-ai/letta`'s own README states "The current source code lives in `letta-ai/letta-code`" — active development (agent harness, memory logic) has moved to a separate, far smaller repo: `letta-ai/letta-code` (Apache-2.0, only **3,381 stars**, confirmed via `gh api`). The 24,801-star figure the doc cites is for a repo Letta itself says is no longer where the current code lives. This doesn't change the doc's "하지 말 것" (skip Letta) verdict, but the star count in the comparison table is not representative of the actively maintained project. |
| 9 | Memori (GibsonAI/memori): 16,836 stars, GitHub API reports license NOASSERTION — flagged as needing manual LICENSE check | **REFUTED (ambiguity resolved)** | `gh api repos/GibsonAI/memori/contents/LICENSE` (decoded) — file is the standard Apache License 2.0 full text, ending "Copyright [2025] [Memori Team] / Licensed under the Apache License, Version 2.0" | The repo **does** ship a clear Apache-2.0 LICENSE file; GitHub's automatic detector likely flags NOASSERTION because the copyright-holder placeholder (`[Memori Team]`) was never filled in with a real name, which is a cosmetic template artifact, not a licensing ambiguity. The doc's "Open questions" item ("Memori 라이선스... 재확인 필요") is resolved: treat Memori as Apache-2.0 with normal confidence, not NOASSERTION. |

**Net result: 0 of the 8 flagged claims were substantively refuted.** All architectural/technical assertions (file names, char limits, ABC design, single-active-provider rule, provider lists, license SPDX ids, star counts, bi-temporal schema, deployment modes) check out against primary sources — several (Graphiti's edge model, mem0's TS `/oss` subpath, Hermes's provider directory) are now confirmed against actual source code rather than docs or third-party posts, which is stronger evidence than the original research had. Two corrections were found: the Zep/Graphiti split is dated 2025, not 2026, and Memori's license is unambiguously Apache-2.0 (not an open NOASSERTION question) — see corrections list below. Neither changes the Section 4 recommendation; no "Corrected recommendation" is needed.
