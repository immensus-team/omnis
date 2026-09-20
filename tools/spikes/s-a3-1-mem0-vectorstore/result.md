# S-A3-1 — mem0-ts 커스텀 VectorStore 어댑터 (A3-D12)

**판정: FAIL** (2026-09-20). `@omnis/memory`가 `public.memories`에 직접 붙는 A3-D12 폴백 경로가 정본이 된다(백로그 B-D1).

실측 방법: `npm pack mem0ai@3.2.0` 후 `dist/oss/index.d.ts` 확인.

1. `type VectorStore`는 export되지만 **타입만**이다. `MemoryConfig.vectorStore`는 `{provider: string, config: VectorStoreConfig}`이고 생성은 `VectorStoreFactory.create(provider, config)` 정적 팩토리를 탄다 — **외부 구현 인스턴스를 꽂는 슬롯이 없다.** A3-D12의 "커스텀 VectorStore 어댑터" 전제가 여기서 깨진다.
2. 번들된 `PGVector`는 `createDatabase`/`createCol`로 **자기 테이블을 만든다.** `memories`의 타입 컬럼(`kind`/`scope`/`source_kind`/4-timestamp/`superseded_by`)과 부분 HNSW(`WHERE invalidated_at IS NULL`)를 표현할 방법이 없다.
3. graph memory는 v2.0.0에서 제거됐다. entity/relation은 어차피 우리 테이블(`entities`/`relations`)이다.
4. 패키지가 `@langchain/core`를 타입 경로로 끌고 오고 vector store 드라이버 20종을 포함한다 — 1인용 단일 Postgres에 붙이자고 질 의존이 아니다.

**남기는 것:** mem0의 fact-extraction 프롬프트 구조(ADD/UPDATE/DELETE 판정)는 **참고만** 한다. 코드·문자열을 복사하지 않는다.

**뒤집히는 조건:** mem0가 인스턴스 주입 API를 열면 재검토. 그 전까지 이 판정이 정본이다.
