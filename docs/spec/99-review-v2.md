# 99 — Global Consistency Review v2 (pass 2)

2026-09-20. Scope: master v0.95, A1–A8 revisions (each including its "revision history"), `99-review.md` (pass 1), `../BRIEF-2026-09-20.md`.
Pass 1's diagnoses are not repeated. Only **what closed / what remains / what is new** is recorded.

---

## 1. Items closed in pass 1

- **§1.1 (5 A3↔A4 disconnects)** — all closed. A3 v0.95 folded in `items.embedding` + partial HNSW, `label_rules` (uuid), `agent_runs`, the 5 `persons` columns + `warming`, and `tasks.kind`·`threads.meta`·`items.meta.pending`, and A4 deleted 2 of its own DDLs.
- **§1.2 (9 appendix-to-appendix items)** — 8 closed: slot timeout (A6 `'3d'` sole owner), port 8787, PG17, migrations (`packages/db/migrations` + `_omnis_migrations`), digest 06:30/23:00, `author` 3 columns, the 3 notation items (`delegate`/`calendar_write`, `@omnis/desktop`, cost cap editable). Keychain is **partial** (§4-4), and Phase 0 numbering is **A1 only** (§4-2).
- **§1.3 (6 appendix↔master items)** — 4 closed: G1–G8 definitions added, §6 table updated, auto-archive and ingestion loops added to §11 (7→9), Phase 0 at 2 weeks/14 gates. Channel count and Haiku 4.5 are **only half done** (§2-1, §2-2).
- **§2 (7 brief gaps)** — all documented: Hermes Phase B/C, A4 §10 L9 ingestion, master §11's 4 auto-archive rules + A4 §9, automatic delegation proposals, the explicit statement of the `read_session` reduction, label chips + ⌘K search, the rationale for rejecting ensembles.
- **§3's 10 master items / §4's 16 decisions** — all applied (including the new §19 Q7–Q12).

---

## 2. Remaining contradictions

1. **Master §16 Phase C "all 7 channels into the inbox"** ↔ §2·§3·A5 §3.1·A8 §1.7 "8 channels" → make **master §16** say 8 channels. (§2 was the only one fixed; §16 was missed.)
2. **Master §5 D9 "T2 Claude Sonnet 5/Haiku 4.5"** ↔ §14·A4-D12·A4 §12.1 "T2 = Sonnet 5 only" → delete Haiku 4.5 from **master §5 D9**.
3. **local-agent config source** — A6 §10.1's plist uses the `--hub <url>` argument, A2 §2.1 uses `~/.omnis/local-agent.toml`. There is no precedence rule anywhere (A6 note 1, unresolved) → add one line to **A2**: "CLI arguments override the TOML", and have A6 only cite it.
4. **A5 §3.6 `threads.person_id`** — a column that does not exist in A3 (A5 note 1). A3 v0.95 added `persons.primary_thread_id`, so this can now be fixed → **A5** rewrites it as a reverse join.
5. **Schedule authority ↔ seed** — A4 §6.1 owns the schedule, but 5 entries in its table (`auto_archive_sweep`, `task_remind`, `network_inactive_sweep`, `self_model_weekly`, `eval_weekly`) are not in A3's `jobs` seed, and conversely the 6 infrastructure jobs that exist only in A3 are not in A4's "full list" → add 5 rows to the **A3** seed + narrow the **A4** table title to "A4-owned".

---

## 3. Remaining gaps vs. the brief

1. **The host for MacBook local file ingestion is undecided.** A4 §10.1 only says it uses FSEvents and never says which machine. The hub is the mini, so reading it as-is pulls in only mini files. The brief says *"gather local files depending on context"* and names MacBook local explicitly → add a host column and the MacBook `local-agent` path to A4 §10.1.
2. **Agent↔agent direct instruction still does not exist.** Every delegation is omnis L3 → approval → target bridge. This differs from the brief's *"should be able to put each other to work"*, and the explanation that it is a deliberate reduction is only one line in §19 Q10.
3. **Phone notifications never reach the draft** — the same item as §4-1 (brief: *"write the draft and notify me separately"*).
4. iPhone "download like an app" is PWA until Phase D (stated in Q1, acceptable).

---

## 4. Inconsistencies the revision pass newly created

1. **One Web Push kind (effectively a blocker).** Master §12 and A5 §4.4 pinned it as "one kind of Web Push (nightly digest ready)", but A4 §3.6 defines immediate push (draft preview of 80 chars + Approve) and batched push (3-hour interval). As written, **draft notifications disappear from the phone** → narrow **master §12 · A5 §4.4** to "one kind of Digest entry push" (the notification policy owner is A4 §3.6).
2. **A1's spike numbers mean different things in the two documents.** A1 relabeled to `A1-①` Calendar · `②` Beeper · `③` kmsg · `④` Slack · `⑤` Gmail, but A6 §11.1 still says "A1-① Slack / A1-② Gmail" and §11.2 says "A1-③ Outlook · ④ Telegram · ⑤ LinkedIn". The **pass criteria for the 5 overlapping gates also differ** (②: A6 "24h with no sanctions" vs A1 none; ④: A6 "48h continuous" vs A1 "one output") → correct **A6 §11.1·11.2** to A1's numbering, and declare A6 §11.3 the authority for pass criteria.
3. **A7 does not know about A3's new tables.** A3 §8 assigned `calendar_events` and `person_merges` to `0002_core_inbox.sql`, but neither appears in A7 US-A02's deliverables, and US-A04 **explicitly excludes** `calendar_events` as "defined nowhere in A3 — UNVERIFIED" (the sentence itself is stale, since the DDL is in A3 §2.1). As it stands, Phase A cannot build A4 §7.1's meeting-end trigger or §7.5's 48-hour metric at all → **A7 US-A02/US-A04**.
4. **Two bridge token Keychain names.** A2 §2.1 `omnis.bridge.token.<host>` ↔ A6 §9 `omnis.macbook.session_bus_token`/`omnis.mini.session_bus_token`. Both say they "followed A1's rule" → make **A6** use A2's literals (they fit A1's scheme better).
5. **A5 §2.5's unified search uses a path that does not exist.** A5 says the client consumes `items.search_tsv` and `persons_name_trgm_idx`, but A3 §7 excluded `search_tsv` from Zero replication and A4 §14 pinned `GET /search` as the only path. The index names differ too, `items.body_trgm_idx` ↔ A3 `items_body_trgm_idx`, and the statement that "the latency target exists nowhere" is stale as of the new S-A4-7 → rewrite **A5 §2.5** to consume A4 §14's `SearchResponse`.

---

## 5. Verdict

**ready for Logan's review = Yes.** Every category pass 1 blocked on (schema disconnects, undefined goal IDs, role blockers) is closed, and the remaining items — 5 in §2 and 5 in §4 — are all **mechanical edits with a clear owning appendix**, so they do not wait on Logan's judgment. However, **§4-3 (A7) and §4-2 (A6 numbering) must be closed before ralph starts** — the former would commit Phase A stories missing 2 tables, and the latter leaves the Phase 0 runner not knowing which pass criteria to use.

**5 things for Logan to look at first**

1. **The 4 auto-archive rules** (master §11). The only item where taste is the right answer. How rule ② (no CTA directed at me, confidence 0.85) actually behaves on Logan's real mail determines how the product feels.
2. **Phone notification policy** (§4-1). Leave "one Web Push kind" as is and the brief's *"notify separately"* survives only on the Mac. Decide whether to apply A4 §3.6's 3 tiers to the phone as well.
3. **The cap on the delegation approval queue** (A4 §4.4: 5 per day, 2 per thread per 24 hours, confidence 0.70). How *"sometimes puts them to work first"* feels is effectively decided by these three numbers.
4. **Ingestion allowlist** (A4 §10.1, all defaults empty). Until Logan fills in local folders, Drive, and GitHub repos, L9 reads nothing. Since "context is the product", the first input list caps memory quality.
5. **Whether to start the 2-week Phase 0 now**, and whether to accept OFF + tailnet-only if FileVault ③ fails (A6-D2), and the MacBook always-on power/clamshell question (the last `decisions_needed` in A6 §12).

---

*Same as pass 1: diagnosis only. Applying §2 and §4 happens in an owning appendix, in a separate pass.*
