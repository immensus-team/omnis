# 99 — Global Consistency Review

2026-09-20. Scope: master `00-omnis-design.md`, `A1`–`A8`, `BRIEF-2026-09-20.md`, `research/00-SYNTHESIS.md`.
Each appendix's own "review notes" are not repeated here; only what **conflicts between appendices, or between an appendix and the master**, is collected.

---

## 1. Contradictions

### 1.1 Blocker — the schema A4 uses is missing from A3

A4's own review caught 3 items (`sensitivity`, `calendar_events`, Task routing fields), but **there are 5 more.** All of them are cases where A4's SQL references A3's DDL directly and cannot be implemented as written. **The side that needs fixing is always A3.**

| A4 | Reference | Impact |
|---|---|---|
| §2.2 kNN SQL | `items.embedding` | Without it, the T0 kNN ($0 path) dies outright and the $21/month estimate in §10.1 collapses → `vector(768)` + partial HNSW |
| §2.3 | `label_rules` table | A4 carries its own DDL. Fold it into `0003_labels.sql`. `label_rules.id/label_id` is `text`, but A3's `labels.id` is `uuid` |
| §1.7 | `agent_runs` | A4-D16 pinned it as the "single source for evaluation, cost, and audit", yet it is absent from A3 §8's list |
| §7.2–7.4 | `persons.first_contact_at / item_count / primary_thread_id / cadence_days / priority_score`, `relationship_state='warming'` | The CHECK is `unknown/new/active/dormant/closed`, so §7.4's output is a **runtime CHECK violation** |
| §7.3, §8.3, §3.1 | `tasks.kind`, `threads.meta`, `items.meta.pending` | A3 has only `draft_meta`. Add the columns + correct A4's notation |

### 1.2 Values that differ between appendices

Format: `item — conflict → side to fix`.

- **`idle_replication_slot_timeout`** — A3 §7 `'2h'` ↔ A6-D4 `'3d'` → **A3**. The GUC is `postgresql.conf`'s concern, and the argument exists only in A6
- **Keychain naming** — A1 `omnis.slack.xoxp.<team_id>` ↔ A6-D9 `omnis-slack-bot-token` → **A6**. A1 hardcoded it in a code example, and the external_id segment is required
- **Hub local port** — A6 §1/§3 `127.0.0.1:8642` ↔ A2 §4.4 Hermes on the same port → **A6 + master**. If both come up on the mini they collide; move the hub to `8787`
- **Postgres version** — A3 "16+" ↔ A6 `@17` ↔ A7 CI "16" → **A3, A7**, pin 17
- **Migration path, filenames, tracking table** — A3 `db/migrations/0001_extensions.sql` · `_omnis_migrations` ↔ A7 `packages/db/migrations/0001_core.sql` · `schema_migrations` → **A7**. A3 owns the schema, so rewrite US-A02–A04 around A3's 8-file split (the missing `agent_runtimes` in A7 note 1 is covered by A3 `0004`)
- **Digest times** — A4 06:30/23:00 ↔ A3 `jobs` 07:00/22:30 ↔ A5 copy "00:30" → **A3, A5**. A4 owns the schedule
- **Phase 0 numbering** — A1 §4 ③=kmsg ↔ master/A6 ③=FileVault → make **A1** use `A1-①`–`⑧`
- **`author` value set** — A1 `person|system` ↔ A3's 3 columns ↔ A2 agent → align **A1, A2** to A3
- **3 notation items** — A7 still has `delegate.run`/`calendar.write`; A8 `@omnis/app` ↔ A7 `@omnis/desktop`; A5 §3.9 "cost cap read-only" ↔ A4 §10.4 "change it in Settings" → **A7 / A8 / A5**

### 1.3 Appendix ↔ master

- **§2 "7 channels"** ↔ §3, §8, and A1 all say **8**. An error in the master.
- **G1–G6 are defined nowhere.** §16, A1 §2.1, A2-D4, and A6 §11 all cite them, but the master §2 table has no G numbers. On top of that A1 says "G5 (5 seconds)" while A2/A6 say "G5 (2 seconds)" — **different values for the same ID** (A1 mistyped G1 as G5).
- **The §6 table disagrees with A3 in 4 places** (A3 note 3). A3 is the more accurate one, so **update the master**.
- **None of §11's 7 loops produces automatic archiving** — A4 §6.4's `auto_archived` floats with no owner.
- **§14 T2's "Haiku 4.5"** never appears in A4 §10.1's routing table.
- **§16 Phase 0 "1 week"** — with the appendix additions there are 30 items (§5). 1 week is impossible.

---

## 2. What the brief asked for but is empty or thin

1. *"The Mac mini's Codex agent and Hermes... and the MacBook's Codex agent, DeepSeek agent, and Hermes should all be accessible and usable too."* → **the biggest gap.** D1/A2-D9 downgraded Hermes to "optional after Phase C, permanently deferred if unused". On top of that, A2 §2.1 has **no TOML example for the mini and no `[[runtime]]` schema for Hermes** (`binary`/`pinned_version` are meaningless for an HTTP client).
2. *"local, drive, github, etc.... gather every piece of data you can collect and build with it."* → one paragraph in master §10, plus A3's `source_kind` and polling jobs. **A1 is channel-only, and none of A4's 7 loops contains ingestion** — no appendix owns allowed folders, chunking, or failure handling.
3. *"There's an Archive feature... every night I look at the summary and check once more"* → the restore UX (A4 §6.4, A5 §3.8) is excellent, but **there are no rules, tiers, or thresholds for "what gets auto-archived".**
4. *"The agent... sometimes puts Codex or the Hermes agent to work first depending on the situation"* → A4 §4.4/§5.1 settled delegation as **manual-trigger only**. The rationale (`17`) is sound, but it directly contradicts the brief, so it should be raised into §19.
5. *"Inbox and agent sessions Understand and act with each other... understand all the other conversations"* → A2-D13/§6 limits `read_session` to summaries and **blocks reading `inbox:` sessions entirely**. There is also no path for a dev session to read an inbox *thread* — this should be stated as a deliberate trade-off or reduction.
6. *"auto-labeled peope according to topics"* → there is **no rule for drawing labels on screen** (A5 note 2). Master §3's "unified search" also has neither a screen nor a Phase assignment.
7. *"running a cheap model or an open-source model in parallel to get performance"* → A4 §10 evaluates only cascades. There is not a single line on why parallel/ensemble was dropped.

---

## 3. Recommended master edits (old → new)

1. **§2** `7 channels` → `8 channels`.
2. **§2**, before the metric table, add G definitions: `G1 channel receipt ≤5s / G2 single normalization across 8 channels + 4 runtimes / G3 draft 60s SLA / G4 zero external sends without approval / G5 cross-device sync ≤2s / G6 standalone (§4.2 D12)`. Then A1 §2.1 `G5 (5s)` → `G1 (5s)`.
3. **§6 table** `accounts…auth_ref` → `account_secrets (excluding Zero)`; `pending_approvals…payload` → `args + decision`; `digests…items[]` → `item_ids`; `threads…labels[]` → `thread_labels (join)`. Add rows: `items.sensitivity`, `items.embedding`, `threads.meta`, `agent_runs`, `label_rules`, `person_merges`.
4. **§11 table** add 2 rows — `auto archive` (reactive / T0+T1 / read-only / `status='archived'`, 7-day undo) and `ingestion` (batch / T0 / local·Drive·GitHub → `memories`). In §10, state that the owning appendix for ingestion is A4.
5. **§7 approval gate**, at the end: `Auto archiving is not egress, so it is guaranteed by a 7-day undo rather than by approval (A4 §6.4).` (Pairs with deleting `archive.apply` in A4-D3.)
6. **§14** `T2 Claude Sonnet 5 / Haiku 4.5` → `T2 Claude Sonnet 5`.
7. **§15·§4.2** state the hub local port `8787` (Hermes `8642` collision).
8. **§16 Phase 0** `1 week` → `2 weeks. 14 gates (§16's 8 + A1-①② + S-A2-1·2 + S-A3-2 + worktrunk), the remaining 16 on Phase entry.`
9. **§16 Phase B** add `unified search` to scope (currently in no Phase at all).
10. **§19** Q7 Hermes inclusion Phase (**read-only in B, delegation in C**) / Q8 Phase D MacBook always-on power vs. mini in parallel (**mini in parallel**) / Q9 license (**Apache-2.0**) / Q10 automatic delegation trigger (**keep manual**, state the divergence from the brief).

---

## 4. Decisions needed (deduplicated, ordered by build impact)

Format: `decision (source) → recommended default`.

1. Reflect the schema A4 uses into A3 (§1.1) → **add all of it to A3.** Most of Phases A–B hangs off this
2. DB role for the `events_rolloff` job (A3 blocker) → wrap it in a **SECURITY DEFINER function** and let `omnis_hub` only call it
3. Hub local port → **8787**
4. Hermes inclusion Phase → **read-only adapter in B** + add the Hermes `[[runtime]]` (`base_url`, `token_keychain_item`) and the mini TOML example to A2 §2.1
5. Auto-archive loop owner + `archive.apply` → **delete in A4-D3**, add the loop to master §11
6. Whether FileVault is ON (A6-D2) → spike ③ first. On failure, OFF + tailnet-only, with Logan's approval
7. Termination condition after 3 Opus failures (A7 note 2) → **halt + escalate to Logan.** Keep the ban on automatic fable promotion
8. Handling of the `omnis` RuntimeKind (A2 note 1) → a single row in `agent_runtimes`, no `RuntimeAdapter`
9. Concurrency cap basis (A2 note 3) → **4 active turns per host** (a process-based rule is meaningless for Codex)
10. Phase D MacBook always-on power (A6 §12) → **run the mini in parallel** (capture sidecar)
11. iPhone Digest entry point (A5 note 1) → a card at the top of Today + one Web Push kind, keep the 5-slot tab bar
12. Visual representation of topic/person labels (A5 note 2) → 2 chips + `+N` on the right of InboxRow row 2
13. KakaoTalk send button gating (A5 note 4) → disabled under 14 days, with remaining days shown
14. `vip` vs cadence priority (A4 note 5) → **vip overrides (14 days)**
15. Adapter `archive()`/`disconnect()` (A1 note 2) → add them. Amend A1-D1 to "the method list is extensible"
16. License (A8-D9) → **Apache-2.0**

---

## 5. Consolidated spikes (30 after dedup)

**Dedup**: master ⑧ = `S-A3-4` = `S-A4-3` (local embedding throughput). `A6-10` = `S-A4-1` (local small classifier).

**14 Phase 0 gates — no Phase A work before they pass** (`item → pass`).
① Calendar watch via Funnel → handshake + 1 notification · ② Beeper + WhatsApp secondary-number send → 200 + received + 24h with no sanctions · ③ FileVault ON + auto login → unattended GUI session after reboot · ④ kmsg read → 48h continuous, 0 permission re-requests · ⑤ Serve HTTPS @ iPhone → 0 SSL errors · ⑥ Zero + Postgres → reflected ≤2s (G5) · ⑦ Codex app-server pin + 1 turn → 0 errors · ⑧ nomic-embed → 1,000 sentences ≤120s, p95 ≤300ms · A1-① Slack Socket Mode → ≤5s (G1) · A1-② Gmail watch + Pub/Sub → `historyId` received · S-A2-1 `-p --bare` hook injection → approval gate appears · S-A2-2 `--permission-mode` ↔ profile → 3 profiles confirmed · S-A3-2 Zero's `vector`/`tsvector`/`uuid[]`/generated → replication + query succeed · A7-1 `worktrunk` dry run → create/remove round trip.

**16 on Phase entry** (pass criteria kept as written in each appendix).
A1-③ Outlook webhook · A1-④ Telegram QR · A1-⑤ LinkedIn notification email parsing · S-A2-3–6 · S-A3-1·3·5 · **S-A4-1 (= A6-10)** local classifier selection (recall ≥0.9, false positive ≤0.15, p95 ≤800ms) · S-A4-2 · S-A4-4 · **S-A4-5** cache-hit ≥60% · **A6-9** 8-process RSS total ≤10GB · A7-2 Tauri UI test.
**A6-9 and S-A4-5 are prerequisites for the Phase A exit criteria**, so they must run inside Phase A.

---

## 6. Verdict

**ready for Logan's review = No.** The skeleton (3 theses, 4 layers, D1–D16, channel matrix, approval gates) is solid enough to review. But **the 5 A3↔A4 disconnects in §1.1 are not typos you spot while reading — they are the kind that make a coding agent stall halfway through Phase A**, and adding A3's role blocker and the undefined G1–G6 on top means running ralph now would just burn time negotiating the schema. Close only the 10 items in §3 and items 1–5 in §4 and it is ready — half a day's work.

**5 things for Logan to look at first**

1. **Do we pull Hermes forward into Phase B** (§2 row 1). The brief requires it explicitly on both hosts, but right now it is "possibly deferred forever". The answer changes A2 §2.1 and master §3·§16 together.
2. **Do we give up on automatic delegation triggers** (§2 row 4). *"sometimes puts them to work first"* vs A4's manual-only. It is omnis's core differentiator and has no commercial precedent, so only Logan can decide.
3. **The rules for auto archiving** (§2 row 3). The nightly digest spec is excellent, but "what to archive" is empty. Which emails you can skip is a matter of taste, so the default rules have to be set by hand.
4. **Behavior when the cost cap is hit** (§19 Q4 + A4 §10.4). A4 does not demote sensitive/VIP threads to T1 in `degraded`; it **stops draft generation entirely** — meaning VIP drafts vanish once the cap is hit. Whether that is right is the question.
5. **How much of Phase D's honest definition to accept** (§4-10, D12). If the MacBook becomes the only always-on node, the service stops the moment it sleeps. The default of running the mini in parallel differs from the brief's final picture of "the MacBook alone in the end".

---

*This document only diagnoses. Applying §3 and §4 happens in a separate pass after Logan confirms.*
