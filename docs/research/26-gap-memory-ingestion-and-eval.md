# GAP 7: 메모리 ingestion (local files / Drive / GitHub) + retrieval 품질 측정 (2026-09-20 리서치)

## 1. TL;DR

10-memory-oss.md는 저장 레이어(mem0 OSS + Postgres bi-temporal 테이블)만 정했고 ingestion은 비워뒀다. 이번 리서치의 핵심 발견: **mem0 OSS는 2026-04-14 v2.0.0에서 graph memory를 완전히 제거했고, 지금은 Mem0 Platform(유료)에서만 제공된다** — 10-memory-oss.md의 "그래프가 옵션 기능"이라는 서술은 더 이상 맞지 않는다. 즉 Network 기능의 관계 쿼리는 mem0로 커버 불가능하며, 기존 추천대로 Postgres 커스텀 엔티티 테이블이 필수다. Drive/GitHub 모두 웹훅(push)은 공인 HTTPS+유효 SSL 엔드포인트가 필요해서 Tailscale 전용인 맥미니 토폴로지와 안 맞는다 — 폴링이 기본값이어야 한다. 임베딩은 mem0 TS가 Ollama를 네이티브 지원하므로 nomic-embed-text-v1.5(268M 파라미터급, 768차원, Matryoshka 64까지 축소 가능, MTEB 62.28)를 mini에서 Ollama로 로컬 실행하는 게 커스텀 MLX 통합보다 훨씬 싼 길이다. 단, 실제 mini(M4 16GB)에서의 지연시간은 이번 리서치로 측정 못 했다 — 직접 벤치 필요.

## 2. Facts

- **mem0 OSS graph memory 제거**: mem0 SDK v2.0.0/v3.0.0(2026-04-14 changelog 기준)에서 "Graph memory is removed from the open-source SDK. It is not being replaced by an OSS equivalent: graph memory is a Mem0 Platform feature, built in and always on, with no external graph database required." `enable_graph`/`graph_store` 설정과 Neo4j/Memgraph/Kuzu/Apache AGE/Neptune 드라이버(~4000줄)가 전부 삭제됨. OSS에 남은 것은 "entity matching"(hybrid search 부스팅용, relationship traversal 아님)뿐. **VERIFIED**, https://docs.mem0.ai/open-source/graph_memory/overview + https://docs.mem0.ai/changelog (fetched 2026-09-20). 코드로도 확인: `mem0-ts/src/oss/src/graphs` 디렉토리가 현재 404(존재하지 않음), `gh api repos/mem0ai/mem0/contents/mem0-ts/src/oss/src` (fetched 2026-09-20).
- **mem0 TS OSS의 임베딩 프로바이더 목록**: `aws_bedrock, azure, fastembed, google, huggingface, langchain, lmstudio, ollama, openai, together, vertexai` — Ollama와 LM Studio가 1급 지원되므로 로컬 임베딩 서버를 mem0가 직접 호출 가능. **VERIFIED**, `gh api repos/mem0ai/mem0/contents/mem0-ts/src/oss/src/embeddings` (fetched 2026-09-20).
- **pgvector 인덱스 차원 한계**: vector 타입 저장은 최대 16,000차원 가능하지만, **HNSW/IVFFlat 근사 인덱스는 표준 vector에서 최대 2,000차원**까지만 지원(half-precision은 4,000, binary는 64,000). 768차원(nomic-embed) 또는 1536차원(OpenAI small) 모두 이 한계 안에 안전하게 들어간다. **VERIFIED**, https://github.com/pgvector/pgvector/blob/master/README.md (fetched 2026-09-20).
- **nomic-embed-text-v1.5**: 파라미터 ~0.1B(≈137M), 임베딩 차원 768(네이티브), Matryoshka로 512/256/128/64까지 축소 가능(각각 MTEB 61.96/61.04/59.34/저하), 최대 시퀀스 길이 8192 토큰, 풀 차원 MTEB 62.28. Ollama 라이브러리 기준 다운로드 274MB, Ollama 0.1.26+ 필요. **VERIFIED**, https://huggingface.co/nomic-ai/nomic-embed-text-v1.5 + https://ollama.com/library/nomic-embed-text (fetched 2026-09-20).
- **Apple MLX 임베딩 생태계는 존재하지만 파편화**: `Blaizzy/mlx-embeddings`(★444, 활발, BERT/ModernBERT/Qwen3/XLM-RoBERTa 등 지원, 4bit/mxfp4/nvfp8 양자화)가 가장 크지만, RAM 요구량이나 M-시리즈 지연시간 벤치마크는 README에 명시돼 있지 않다. mem0에는 MLX 전용 임베딩 프로바이더가 없음(Ollama 경유가 실질적 로컬 경로). **VERIFIED**(생태계 존재), **UNVERIFIED**(실측 지연시간/RAM) — https://github.com/Blaizzy/mlx-embeddings (fetched 2026-09-20).
- **Voyage AI 임베딩 가격**: voyage-3 $0.06/M 토큰(구형, 200M 무료), voyage-3-lite $0.02/M(구형, 200M 무료), voyage-code-3(코드 특화, 구형) $0.18/M 무료 티어 없음, 현행 voyage-code-4 $0.12/M(200M 무료). **VERIFIED**, https://docs.voyageai.com/docs/pricing (fetched 2026-09-20).
- **OpenAI 임베딩 가격**: text-embedding-3-small $0.02/M 토큰, text-embedding-3-large $0.13/M 토큰(둘 다 입력만, 출력 토큰 없음). **VERIFIED**, https://developers.openai.com/api/docs/pricing (fetched 2026-09-20).
- **Google Drive changes API로 증분 동기화**: `changes.getStartPageToken()`으로 베이스라인 토큰을 얻고, `changes.list()`를 페이지 토큰 기준으로 폴링(오래된 변경이 먼저, `newStartPageToken`을 다음 폴링에 재사용), `includeRemoved`로 삭제 항목 포함 가능. `changes.watch()`는 실시간 push지만 변경 내용은 안 담고 "변경 있음" 신호만 준다(그래도 `changes.list()` 재호출 필요). **VERIFIED**, https://developers.google.com/drive/api/guides/manage-changes (fetched 2026-09-20).
- **Drive push 웹훅 요구사항**: 콜백 URL은 **반드시 HTTPS + 유효한 SSL 인증서**(자체서명/신뢰되지 않은 CA/만료 불가)가 있는 공인 서버여야 한다. 도메인 사전 검증은 문서상 명시 없음. `changes` 리소스 구독의 최대 만료는 604,800초(1주), 미지정 시 기본 3,600초(1시간). **VERIFIED**, https://developers.google.com/workspace/drive/api/guides/push (fetched 2026-09-20). → **맥미니가 Tailscale 전용(공인 IP/도메인 없음)이라는 토폴로지와 정면 충돌** — `watch()`를 쓰려면 별도 공인 릴레이가 필요하고, 없으면 폴링만 가능.
- **Drive API 쿼터**: 프로젝트당 분당 100만 쿼터 유닛, 유저당(프로젝트 내) 분당 325,000 유닛, 24시간 40억 유닛(과금 전 임계치). `files.get` 5유닛, list 100유닛, download 200유닛. 1인 사용자 규모에서는 사실상 상한에 도달할 일이 없다. **VERIFIED**, https://developers.google.com/drive/api/guides/limits (fetched 2026-09-20).
- **GitHub REST API 레이트 리밋**: 인증된 요청 기준 시간당 5,000건(Enterprise Cloud GitHub App은 15,000건). 보조 제한: 동시 요청 100개 이하, 분당 900포인트(GET/HEAD=1점, POST/PATCH/PUT/DELETE=5점), 분당 콘텐츠 생성 요청 80건/시간당 500건. **VERIFIED**, https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api (fetched 2026-09-20).
- **GitHub 공식 권고**: 폴링 대신 웹훅 구독을 권장("stay within the API rate limit"), 가능하면 REST 다중 호출 대신 GraphQL 사용, conditional request(ETag)로 트래픽 절감, rate-limit 헤더 모니터링 + exponential backoff. 웹훅에는 서명 검증(webhook secret) 필수. **VERIFIED**, https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/best-practices-for-creating-a-github-app (fetched 2026-09-20). → GitHub 웹훅도 **공인 HTTPS 엔드포인트가 필요**해서 Drive와 동일한 Tailscale 문제를 갖는다.
- **RAGAS**: RAG 평가 프레임워크, "vibe check"를 구조화된 metric 기반 평가로 대체하는 것이 목표. 커스텀 데이터셋(질문+기대 답/출처) 등록과 실험 관리를 지원한다고 문서가 명시하나, 이번 fetch로는 context precision/recall/faithfulness 등 개별 지표의 정의까지는 확인 못 함(메트릭 상세 페이지 별도). **VERIFIED**(프레임워크 존재/목적), **UNVERIFIED**(개별 지표 정의 상세) — https://docs.ragas.io/en/stable/ (fetched 2026-09-20).
- **카카오톡 백필 규모 레퍼런스**(05-channel-kakaotalk.md, 기존 리서치 재인용): 1인 실사례 기준 로컬 SQLCipher DB에 약 3.1년치 이력, 8,058명 연락처, 458개 채팅방이 캐시돼 있었다는 블로그 보고. omnis의 로컬 파일/과거 인박스 백필 볼륨 추정치로 참고 가능(채널 수집 자체의 ToS 리스크는 05번 문서 소관). **VERIFIED**(해당 블로그 글 내용), 실서비스 규모 대표성은 **UNVERIFIED**.

## 3. Options / comparison

### 3-1. 커넥터 방식 (연결 방식 × 증분 동기화)

| 소스 | 연결 방식 | 증분 동기화 | 삭제 처리 | Tailscale-only 적합성 | Effort |
|---|---|---|---|---|---|
| Local files (맥미니+맥북) | OS 파일시스템 watch(FSEvents/chokidar류) | 이벤트 기반(native) | native(unlink 이벤트) | 완벽(로컬) | S |
| Google Drive | REST API, OAuth | `changes.list()` 폴링(수 분~수십 분 간격) | `includeRemoved`로 tombstone 수신 | 좋음(watch 없이 폴링만 쓰면 문제 없음) | M |
| Google Drive(대안) | `changes.watch()` push | 실시간 | 동일 | **나쁨**(공인 HTTPS+SSL 필요, 별도 릴레이 필요) | L(릴레이까지 포함 시) |
| GitHub | REST/GraphQL API, PAT or GitHub App | 커밋/PR/이슈는 API 폴링(ETag) 또는 `git pull` diff | API 응답의 상태 필드로 판단 | 좋음(폴링) | M |
| GitHub(대안) | 웹훅 push | 실시간 | 이벤트 페이로드에 명시 | **나쁨**(동일한 공인 엔드포인트 문제) | L |

### 3-2. 임베딩 모델/호스트

| 옵션 | 위치 | 비용 | 차원 | 비고 |
|---|---|---|---|---|
| nomic-embed-text-v1.5 (Ollama) | mini 또는 MacBook, 로컬 | $0(전기값만) | 768(→64까지 Matryoshka 축소 가능) | mem0 TS `ollama.ts`로 바로 연결, pgvector HNSW 한계(2,000) 안전권 |
| MLX 커스텀(Blaizzy/mlx-embeddings 등) | mini/MacBook, 로컬 | $0 | 모델별 | mem0에 전용 어댑터 없음 → 직접 임베딩 후 pgvector에 upsert하는 별도 파이프라인 필요, 통합 비용 더 큼 |
| voyage-3-lite | 클라우드 | $0.02/M 토큰(200M 무료) | 512/1024 등 | mini 항상 켜져 있어도 API 호출이라 네트워크 의존 |
| voyage-code-4 | 클라우드 | $0.12/M 토큰(200M 무료) | 코드 특화 | GitHub 코드 청크 전용으로만 부분 채택 고려 가능 |
| text-embedding-3-small | 클라우드 | $0.02/M 토큰 | 1536 | 범용, 저렴, Vercel AI Gateway로 라우팅 용이 |

## 4. Recommendation for omnis

**(1) 커넥터: 전부 폴링이 기본, 웹훅은 나중.** Drive `changes.watch()`와 GitHub 웹훅은 둘 다 공인 HTTPS+유효 SSL 엔드포인트를 요구하는데, mini는 Tailscale 전용이라 이 요건을 못 채운다. 지금 단계에선 `changes.list()`/GitHub API를 크론(예: 5~15분 간격)으로 폴링하는 게 정답이다 — 구현이 단순하고 Drive 쿼터(유저당 분당 325,000유닛)나 GitHub 레이트리밋(시간당 5,000건) 모두 1인 사용량에서 절대 안 걸린다. 공인 릴레이(Cloudflare Tunnel/Worker)로 웹훅을 mini까지 포워딩하는 건 실시간성이 정말 필요해질 때(예: GitHub PR 리뷰 요청을 인박스에 초 단위로 띄워야 할 때)로 미룬다. Effort: 폴링 S, 웹훅+릴레이 L. Risk: 낮음(공식 API, OAuth 스코프 최소화, ToS 문제 없음) — GitHub/Drive는 05/06/07번 문서가 다루는 KakaoTalk/LinkedIn류의 계정정지 리스크가 없는 유일한 채널군이다.

**(2) 임베딩: mem0 + Ollama + nomic-embed-text-v1.5를 mini에 로컬로.** mem0 TS가 `ollama.ts` 임베딩 프로바이더를 이미 갖고 있으므로 커스텀 MLX 통합(별도 파이프라인 필요, effort 더 큼)보다 훨씬 싸게 "완전 로컬 + $0"를 달성한다. 768차원은 pgvector HNSW 2,000차원 한계 안에 넉넉히 들어가고, Matryoshka로 필요시 256/128차원까지 줄여 인덱스를 더 가볍게 만들 수 있다(mini가 16GB라 인덱스 크기가 실제로 문제 될 수 있음 — 데이터가 커지면 이 레버를 쓴다). **단, M4 16GB에서의 실측 처리량/지연시간은 이번 리서치로 확인 못 했다 — 반드시 실기 벤치(예: 1,000개 문장 배치 임베딩 시간)를 먼저 돌려보고, Ollama가 감당 못 하면 voyage-3-lite($0.02/M, 200M 토큰 무료)로 폴백하는 이원화 설계를 권한다.** Effort: S(mem0+Ollama 배선), 벤치 자체는 S. Risk: 낮음(로컬, ToS 무관), 다만 mem0가 최근 6개월 새 그래프 메모리를 통째로 들어낼 만큼 빠르게 브레이킹 체인지를 내는 프로젝트라 버전 고정 + 분기별 재검증이 필요(유지보수 리스크 중간).

**(3) Network 관계 쿼리는 mem0가 아니라 Postgres 커스텀 테이블로 — 이건 확정.** mem0 OSS의 graph memory 제거(2026-04-14)로, "mem0 + pgvector가 Network 기능의 관계 쿼리를 커버하냐"는 질문에 대한 답은 명확히 **아니오**다. mem0 OSS는 벡터 검색 + entity matching(검색 랭킹 보조)만 하고, 관계 traversal은 Mem0 Platform(유료 SaaS)에서만 된다. 10-memory-oss.md가 이미 제안한 "Graphiti의 4-timestamp bi-temporal 컬럼을 차용한 Postgres 엔티티 테이블"이 유일한 실행 가능 경로로 확정된다 — 이제 "선택"이 아니라 "필수"로 문서를 갱신해야 한다. Effort: M(스키마+관계 쿼리 설계), Risk: 낮음(직접 구현이라 벤더 종속 없음).

**(4) 청킹: 소스 타입별로 다르게, 하나의 공통 스키마로.**
- **코드(GitHub)**: 함수/클래스 경계로 자르는 게 맞다(파일 전체를 통짜로 넣으면 임베딩이 흐려짐, 라인 수 고정 자르기는 함수를 반토막냄). tree-sitter로 AST 경계를 잡는 방식이 표준(Continue.dev, Sourcegraph Cody 등 코드 어시스턴트가 공통으로 쓰는 패턴) — omnis는 이미 GitNexus MCP(AST 기반 코드 그래프 툴)가 연결돼 있으므로 처음부터 새로 만들지 말고 GitNexus의 파싱 결과를 재사용하는 걸 1순위로 검토.
- **인박스 스레드(Slack/Kakao/Gmail 등)**: 메시지 단위 + 스레드 요약 청크의 이중 구조. 개별 메시지는 짧아서 그대로 임베딩하되, 스레드가 끝나거나 일정 턴 수를 넘으면 LLM 요약 청크를 하나 더 만들어 "무슨 일이 있었는지"를 압축 검색 가능하게 한다(Hermes의 frozen-snapshot 패턴과 유사한 압축 전략).
- **문서(로컬 파일/Drive)**: 문단 단위 재귀적 분할(500~800 토큰, 100 토큰 오버랩)이 표준 출발점 — 특수 로직 필요 없음.
Effort: S~M(코드는 GitNexus 재사용 시 S, 나머지는 라이브러리 수준).

**(5) 신원 통합(identity resolution)은 지금은 자동화하지 않는다.** 05/17번 문서가 공통으로 "cross-file, 소유자 없음"이라 지적한 문제인데, 1인 사용자 규모(연락처 수천 명 수준, 8,058명 카카오 레퍼런스 기준)에서는 ML 기반 엔티티 리졸루션이 과잉설계다. 이메일 주소/전화번호/카카오ID/LinkedIn URL 같은 결정론적 키로 먼저 매칭하고, 매칭 안 되는 건 Network UI에서 Logan이 수동으로 "이 사람 = 이 사람" 병합하는 버튼만 만들어두면 충분하다. 자동 매칭은 나중에 데이터가 쌓이고 나서(수백~수천 건의 미해결 매칭이 실제로 쌓일 때) 재검토. Effort: S.

**(6) Retrieval eval: G3 기준을 실제로 테스트 가능하게 만드는 최소 세트.** 30~50문항짜리 골든셋을 만들되, 각 문항에 "기대 출처(소스 타입+문서/메시지 ID)"와 "as-of 시각"을 같이 박아둔다(G3가 "같은 시점 기준 같은 사실"을 요구하므로). RAGAS 풀스택(LLM-judge 기반 context precision/recall/faithfulness)을 처음부터 들이지 말고, 1단계는 "expected source가 top-k 검색 결과에 들어왔는가"(recall@k)만 스크립트 20줄로 직접 잰다 — 이게 ladder 3번(stdlib/직접 구현)에 해당하는 가장 싼 검증이고, G3의 "테스트가 아예 없다"는 문제를 즉시 해결한다. RAGAS는 나중에 판정 기준을 더 정교화하고 싶을 때(예: 답변 자체의 faithfulness까지 재고 싶을 때) 추가한다. Effort: S(recall@k 스크립트), M(RAGAS 통합 시).

## 5. What to borrow

- **mem0 임베딩 프로바이더 배선**: `mem0-ts/src/oss/src/embeddings/ollama.ts`를 그대로 설정 예시로 참고 — 별도 임베딩 서비스를 앞단에 만들 필요 없이 mem0 초기화 config에 `embedder.provider: "ollama"`만 넣으면 된다(10-memory-oss.md의 로컬 companion 예시와 동일 패턴).
- **GitHub 동기화 정책**: GitHub의 공식 "webhook 우선, 안 되면 conditional request(ETag)+backoff" 권고를 그대로 채택 — omnis는 웹훅이 지금 당장은 불가능하므로 ETag 기반 폴링부터 구현.
- **Graphiti의 bi-temporal 스키마**(10-memory-oss.md에서 이미 borrow 결정): 이번 리서치로 "필수"로 격상됐다는 점만 갱신. `valid_from/valid_until/recorded_at/invalidated_at` 4컬럼을 Network 엔티티 테이블에 그대로 적용.
- **GitNexus MCP의 AST 파싱**: 이미 이 세션에 연결된 `mcp__gitnexus__*` 툴(코드 그래프/impact 분석)이 코드 청킹에 필요한 함수/클래스 경계 정보를 이미 만들고 있을 가능성이 높다 — 코드 청킹 파이프라인을 새로 짜기 전에 GitNexus 출력을 재사용할 수 있는지부터 확인.
- **pgvector 차원 설계**: nomic-embed 768차원을 그대로 쓰되, mini 저장 용량이 부족해지면 Matryoshka 256/128 축소를 스키마 변경 없이 적용 가능(같은 vector 컬럼, 앞 N차원만 슬라이스) — 재인덱싱 스크립트만 있으면 됨.

## 6. Open questions

- M4 16GB mini에서 nomic-embed-text-v1.5(Ollama)의 실측 배치 임베딩 처리량/지연시간 — 벤치 스크립트를 돌려야 확정. 이 리서치는 스펙만 확인했지 실측을 못 했다.
- RAGAS의 개별 지표(context precision/recall/faithfulness) 정의와, 30~50문항 골든셋에 얼마나 오버스펙인지 — 후속 리서치 또는 직접 문서 열람 필요.
- Drive 웹훅용 공인 릴레이(Cloudflare Tunnel 등)를 지금 구축할지, 폴링으로 얼마나 버틸지의 임계선(폴링 간격 vs "실시간성 필요" 체감) — Logan 판단 필요.
- GitHub App vs PAT: 여러 레포(회사+개인)를 다루려면 GitHub App 설치 방식이 권한 스코프상 더 깔끔한데, 이번 리서치는 PAT 기준 레이트리밋만 확인했고 App 발급 플로우 자체는 다루지 않았다.
- 로컬 파일 커넥터의 구체 스택(FSEvents 직접 vs chokidar 같은 라이브러리)은 이번 리서치 범위 밖 — 별도로 다뤄야 함.
- mem0 OSS의 "entity matching"이 실제로 얼마나 강력한지(순수 벡터 검색 대비 랭킹 개선폭)는 코드/문서 확인만 했고 실측 안 함 — Network 기능이 mem0 검색에 얼마나 의존할지 결정하기 전에 확인 필요.

## 7. Sources

- https://docs.mem0.ai/open-source/graph_memory/overview (2026-09-20)
- https://docs.mem0.ai/changelog (2026-09-20)
- https://github.com/mem0ai/mem0 — `gh api repos/mem0ai/mem0/contents/mem0-ts/src/oss/src`, `.../embeddings`, `.../vector_stores` (2026-09-20)
- https://github.com/pgvector/pgvector/blob/master/README.md (2026-09-20)
- https://huggingface.co/nomic-ai/nomic-embed-text-v1.5 (2026-09-20)
- https://ollama.com/library/nomic-embed-text (2026-09-20)
- https://github.com/Blaizzy/mlx-embeddings (2026-09-20)
- https://docs.voyageai.com/docs/pricing (2026-09-20)
- https://developers.openai.com/api/docs/pricing (2026-09-20)
- https://developers.google.com/drive/api/guides/manage-changes (2026-09-20)
- https://developers.google.com/workspace/drive/api/guides/push (2026-09-20)
- https://developers.google.com/drive/api/guides/limits (2026-09-20)
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api (2026-09-20)
- https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/best-practices-for-creating-a-github-app (2026-09-20)
- https://docs.ragas.io/en/stable/ (2026-09-20)
- 내부 참조: /Users/logankim/AI-Workspaces/Claude/omnis/research/10-memory-oss.md, 05-channel-kakaotalk.md, 17-todo-briefing-network-notes.md
