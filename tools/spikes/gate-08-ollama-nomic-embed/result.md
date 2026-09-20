# Gate ⑧: Ollama nomic-embed 처리량

- **질문**: `nomic-embed-text-v1.5`로 1,000개 인박스 문장 샘플을 임베딩하는 데 120초 이내, p95 300ms 이내가 나오는가(A6 §11.1 수치화 + §11.3 "하루 ~2,000건 유입을 실시간 지연 없이 소화" 절차).
- **소유 부록**: A6 (§6 Ollama, §11.1·§11.3)
- **Owner**: agent(unattended)
- **Host**: mini — 계획서 Task 4 헤더는 `Host: macbook`이라 적었지만 A6 §6이 "nomic-embed는 미니 전용, `OLLAMA_HOST=127.0.0.1`로 바인딩해 hub를 통해서만 호출"이라고 못박고 있고, 실제로 이 워크트리를 실행 중인 맥북에는 Ollama가 설치되어 있지 않다(`which ollama` → not found, `curl 127.0.0.1:11434` → connection refused). 미니(`ssh <hub-user>@<hub-host>`)에는 `ollama 0.34.2` + `nomic-embed-text:latest`가 이미 떠 있다. 그래서 벤치마크는 미니에서 직접(loopback) 돌렸다 — 이게 프로덕션 토폴로지(허브+Ollama가 미니에 동거, loopback 호출)와도 일치한다.
- **실행일**: 2026-09-20 (최초 측정: `tools/spikes/_probes/2026-09-20-cli-probes.md` "Gate ⑧ evidence"; 본 태스크에서 계획서 원문 그대로의 `bench.ts`/`sample-sentences.txt`를 만들어 미니에 복사해 재확인)
- **결과(Pass/Fail)**: **PASS**
- **측정치/근거**:
  - 본 태스크 재확인(`bench.ts`를 `scp`로 `/tmp/gate-08-bench`에 복사, `npx tsx bench.ts` 실행, 이후 삭제): `total_s=16.3 p95_ms=17.1 n=1000`.
  - Pass 기준(A6 §11.1): 1,000문장 ≤120s → **16.3s PASS**; p95 ≤300ms → **17.1ms PASS**.
  - 최초 프로브 측정(`_probes/2026-09-20-cli-probes.md`, 배치 스크립트 `embed-bench.py`, stdlib only): `total_1000_s=9.1, single_call_ms_p95=11, dim=768`. 두 측정 모두 큰 여유로 PASS — 본 태스크의 1문장씩 순차 `fetch` 스크립트(계획서 원문)가 배치 스크립트보다 느리지만(16.3s vs 9.1s) 여전히 기준의 1/7 수준.
  - 임베딩 차원 768은 미니 `ollama list` 응답의 `embedding_length: 768`로 확인(A3 `vector(768)`과 일치, 프로브 파일에 기록됨).
- **decided_by**: Fable(에이전트, 본 태스크 재확인) + 이전 측정은 2026-09-20 프로브 세션
- **비고**: T0 로컬 임베딩은 미니에서만 돈다(A6 §6 "맥북 오프로딩 규칙"은 3B 초과/2GB 초과 모델에만 해당 — nomic-embed 274MB는 해당 없음). Fail-fallback 규칙(오프피크 이동 또는 맥북 오프로드)은 발동하지 않는다. `bench.ts`를 리포에 committed 상태로 유지하되, 맥북에서 직접 돌리면 `ECONNREFUSED 127.0.0.1:11434`로 실패한다는 점(Ollama가 맥북에 없음)을 알고 있을 것 — 실행 시에는 스크립트를 미니로 복사해 돌리거나 SSH 터널을 사용한다.
