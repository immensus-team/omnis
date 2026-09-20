# Mini Resource Measurements (A6-9 Gate)

**Measured at**: 2026-09-20T08:48Z · **Host**: vigors-mac-mini (Apple M4, 16GB, macOS 26.6.2)
**Method**: Sum of RSS from `ps -axo rss,args`. Immediately after service startup, in **idle state** (inbox 0 rows, desktop not connected).

A6-9's pass criterion is "8-process RSS ≤ 10GB". Those 8 are the Postgres, hub, zero-cache, Ollama, healthcheck, kmsg, Playwright, and Beeper processes fixed by name in A6 §7, and **only 4 of them actually run on the mini today**
(the remaining 4 attach in Phases B~C). local-agent (mini) counts toward the A6 §7 subtotal but not toward the gate name.

## Processes running today

| Process | Process count | Measured RSS | A6 §7 budget | Difference |
|---|---:|---:|---:|---|
| Postgres 17.11 (all backends included) | 10 | 0.10 GB | 3.0 GB | 3% of budget — `shared_buffers` is still the brew default of 128MB (see below) |
| omnis-hub (node) | 1 | 0.06 GB | 1.0 GB | Headroom |
| zero-cache (@rocicorp/zero 1.9.0) | **14** | **1.27 GB** | 1.5 GB | **Already uses 84% of the budget at idle** |
| Ollama (serve, no model loaded) | 1 | 0.04 GB | 1.0 GB | +0.3GB expected once a model is loaded |
| local-agent (mini, Codex bridge) | 1 | 0.05 GB | 0.2 GB | Headroom |
| **Total (today)** | 27 | **1.52 GB** | — | 9.5% of 16GB |

Not running (budget reserved only): healthcheck 0.05 GB, kmsg 0.2 GB, Playwright 0.8 GB, Beeper 0.4 GB → 1.45 GB combined.

**A6-9 verdict: still undetermined (only 4/8 processes measured).** The 4 measured today (Postgres, hub, zero-cache, Ollama) total 1.47 GB, which is 23% of those same 4 processes' §7 budget of 6.5 GB. If the remaining 4 come in on budget, the 8-process total is about 2.9 GB — far short of the 10GB ceiling.
Even on a 9-process basis including local-agent it sits around 3.0 GB and still does not exceed the same ceiling. **The final verdict is reached in Phases B~C, after kmsg, Playwright, and Beeper have actually come up, by updating this table.**

## Points to note

- **zero-cache comes up as 14 processes** (dispatcher 1 + change-streamer 1 + sync worker 12). 1.27GB at idle is
  84% of the 1.5GB cap (A6-D5). The sync worker count follows the core count (M4, 10 cores), so under load it is likely to exceed the cap.
  If it actually does, the first thing to look at is reducing the worker count (`--num-sync-workers`), not A6-D5's fallback (staged increase) —
  omnis is 1 user with 2~3 devices, so 12 workers are not needed.
- **The mini is not dedicated to omnis.** Hermes/omh/buzz, colima, miniflux, and recap-server already run on the same machine.
  The §7 budget table counts only omnis's share, so the remaining headroom (~5.8GB) is in reality smaller than that. For pressure from the
  16GB total perspective, check `vm_stat` separately (at measurement time: free 1.5GB / inactive 5.2GB).
- **Why Postgres uses only 3% of its budget**: A6 §4's memory parameters (`shared_buffers = 2GB`, etc.) were **not applied.**
  The only thing this deployment changed was `wal_level` (§RUNBOOK). This cluster is shared with miniflux, so preempting 2GB
  requires Logan's judgment — until it is applied, Postgres's measured numbers are meaningless to compare against the budget.
