# Gate ⑧: Ollama nomic-embed throughput

- **Question**: Does embedding a 1,000-sentence inbox sample with `nomic-embed-text-v1.5` finish within 120 seconds at p95 ≤300ms (A6 §11.1 quantification + §11.3 procedure, "absorb ~2,000 incoming items per day with no real-time latency")?
- **Owning appendix**: A6 (§6 Ollama, §11.1·§11.3)
- **Owner**: agent (unattended)
- **Host**: mini — the plan's Task 4 header says `Host: macbook`, but A6 §6 pins it down: "nomic-embed is mini-only; bind it with `OLLAMA_HOST=127.0.0.1` so it is called only through the hub." In fact the macbook running this worktree does not have Ollama installed (`which ollama` → not found, `curl 127.0.0.1:11434` → connection refused). On the mini (`ssh <hub-user>@<hub-host>`), `ollama 0.34.2` + `nomic-embed-text:latest` are already up. So the benchmark was run directly on the mini (loopback) — which also matches the production topology (hub + Ollama co-located on the mini, called over loopback).
- **Run date**: 2026-09-20 (initial measurement: `tools/spikes/_probes/2026-09-20-cli-probes.md` "Gate ⑧ evidence"; re-confirmed in this task by building `bench.ts`/`sample-sentences.txt` exactly as the plan specifies and copying them to the mini)
- **Result (Pass/Fail)**: **PASS**
- **Measurements/Evidence**:
  - Re-confirmation in this task (`bench.ts` copied to `/tmp/gate-08-bench` via `scp`, `npx tsx bench.ts` run, then deleted): `total_s=16.3 p95_ms=17.1 n=1000`.
  - Pass criteria (A6 §11.1): 1,000 sentences ≤120s → **16.3s PASS**; p95 ≤300ms → **17.1ms PASS**.
  - Initial probe measurement (`_probes/2026-09-20-cli-probes.md`, batch script `embed-bench.py`, stdlib only): `total_1000_s=9.1, single_call_ms_p95=11, dim=768`. Both measurements PASS with wide margin — this task's one-sentence-at-a-time sequential `fetch` script (the plan's original) is slower than the batch script (16.3s vs 9.1s) but still only about 1/7 of the threshold.
  - Embedding dimension 768 was confirmed from the mini's `ollama list` response (`embedding_length: 768`), matching A3's `vector(768)` (recorded in the probe file).
- **decided_by**: Fable (agent, this task's re-confirmation); the earlier measurement is from the 2026-09-20 probe session
- **Notes**: T0 local embedding runs only on the mini (A6 §6's "macbook offloading rule" applies only to models over 3B or over 2GB — nomic-embed at 274MB is not covered). The fail-fallback rule (move to off-peak, or offload to the macbook) is not triggered. Keep `bench.ts` committed in the repo, but be aware that running it directly on the macbook fails with `ECONNREFUSED 127.0.0.1:11434` (Ollama is not installed there) — to run it, copy the script to the mini or use an SSH tunnel.
