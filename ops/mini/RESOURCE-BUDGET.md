# 미니 리소스 실측 (A6-9 게이트)

**실측 시각**: 2026-09-20T08:48Z · **호스트**: vigors-mac-mini (Apple M4, 16GB, macOS 26.6.2)
**측정법**: `ps -axo rss,args`의 RSS 합. 서비스 기동 직후 **idle 상태**(인박스 0행, 데스크톱 미접속).

A6-9의 pass 기준은 "8-process RSS ≤ 10GB"다. 그 8개는 A6 §7이 이름으로 고정한
Postgres·hub·zero-cache·Ollama·healthcheck·kmsg·Playwright·Beeper이고, **오늘 미니에 실제로 도는 것은 그중 4개**다
(나머지 4개는 Phase B~C에 붙는다). local-agent(미니)는 A6 §7 소계엔 들어가지만 게이트 이름에는 안 들어간다.

## 오늘 도는 프로세스

| 프로세스 | 프로세스 수 | RSS 실측 | A6 §7 예산 | 차이 |
|---|---:|---:|---:|---|
| Postgres 17.11 (전체 백엔드 포함) | 10 | 0.10 GB | 3.0 GB | 예산의 3% — `shared_buffers`가 아직 brew 기본값 128MB다(§아래) |
| omnis-hub (node) | 1 | 0.06 GB | 1.0 GB | 여유 |
| zero-cache (@rocicorp/zero 1.9.0) | **14** | **1.27 GB** | 1.5 GB | **예산의 84%를 idle에서 이미 쓴다** |
| Ollama (serve, 모델 미적재) | 1 | 0.04 GB | 1.0 GB | 모델을 올리면 +0.3GB 예상 |
| local-agent (미니, Codex 브리지) | 1 | 0.05 GB | 0.2 GB | 여유 |
| **합계 (오늘)** | 27 | **1.52 GB** | — | 16GB의 9.5% |

미실행(예산만 잡혀 있음): healthcheck 0.05 GB, kmsg 0.2 GB, Playwright 0.8 GB, Beeper 0.4 GB → 합 1.45 GB.

**A6-9 판정: 아직 미확정(4/8 프로세스만 실측됨).** 오늘 측정된 4개(Postgres·hub·zero-cache·Ollama) 합은 1.47 GB로
같은 4개의 §7 예산 6.5 GB의 23%다. 남은 4개가 예산대로 들어오면 8개 합은 약 2.9 GB — 10GB 상한에 크게 못 미친다.
local-agent를 더한 9개 기준으로도 3.0 GB 수준이라 같은 상한을 넘지 않는다. **최종 판정은 Phase B~C에서
kmsg·Playwright·Beeper가 실제로 뜬 뒤 이 표를 갱신해 내린다.**

## 짚어둘 것

- **zero-cache가 14개 프로세스로 뜬다** (dispatcher 1 + change-streamer 1 + sync worker 12). idle에서 1.27GB는
  1.5GB 캡(A6-D5)의 84%다. sync worker 수는 코어 수를 따라가므로(M4 10코어) 부하가 붙으면 캡을 넘길 가능성이 높다.
  실제로 넘으면 A6-D5의 폴백(단계적 상향)이 아니라 worker 수를 줄이는 쪽(`--num-sync-workers`)을 먼저 본다 —
  omnis는 1유저 2~3디바이스라 12 worker가 필요 없다.
- **미니는 omnis 전용이 아니다.** 같은 머신에 Hermes/omh/buzz, colima, miniflux, recap-server가 이미 돈다.
  §7 예산표는 omnis 몫만 세므로, 남은 헤드룸(~5.8GB)은 실제로는 그보다 작다. 16GB 전체 관점의 압박은
  `vm_stat`으로 따로 본다(측정 시점 free 1.5GB / inactive 5.2GB).
- **Postgres가 예산의 3%만 쓰는 이유**: A6 §4의 메모리 파라미터(`shared_buffers = 2GB` 등)를 **적용하지 않았다.**
  이번 배포에서 바꾼 것은 `wal_level`뿐이다(§RUNBOOK). 이 클러스터는 miniflux와 공유하므로 2GB 선점은
  Logan 판단이 필요하다 — 적용 전까지 Postgres 실측치는 예산과 비교할 의미가 없다.
