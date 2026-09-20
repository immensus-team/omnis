# S-A3-1 — mem0-ts custom VectorStore adapter (A3-D12)

**Result (Pass/Fail)**: **FAIL** (2026-09-20). The A3-D12 fallback path — `@omnis/memory` attaching directly to `public.memories` — becomes the canonical approach (backlog B-D1).

Measurement method: run `npm pack mem0ai@3.2.0`, then inspect `dist/oss/index.d.ts`.

1. `type VectorStore` is exported, but **as a type only**. `MemoryConfig.vectorStore` is `{provider: string, config: VectorStoreConfig}`, and construction goes through the static factory `VectorStoreFactory.create(provider, config)` — **there is no slot for plugging in an instance of an external implementation.** A3-D12's premise of a "custom VectorStore adapter" breaks here.
2. The bundled `PGVector` **creates its own tables** via `createDatabase`/`createCol`. There is no way to express the type columns of `memories` (`kind`/`scope`/`source_kind`/4-timestamp/`superseded_by`) or the partial HNSW index (`WHERE invalidated_at IS NULL`).
3. graph memory was removed in v2.0.0. entity/relation are our own tables (`entities`/`relations`) anyway.
4. The package pulls in `@langchain/core` through its type path and ships 20 kinds of vector store drivers — not a dependency to take on just to attach to a single Postgres for one person.

**What we keep:** the structure of mem0's fact-extraction prompt (the ADD/UPDATE/DELETE decision) is used **for reference only**. We do not copy code or strings.

**Conditions that would reverse this:** if mem0 opens an instance-injection API, revisit. Until then, this result is canonical.
