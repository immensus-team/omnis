# eval/ — Phase B golden sets

## Provenance

**100% synthetic data.** Every row in these files is hand-authored for testing. No real
user data is present and none was used to derive it — **Logan's real inbox is not connected
yet**. See `docs/superpowers/plans/2026-09-20-phase-b-backlog.md` §7-1 for the decision to
accept synthetic sets for format/harness/hard-gate purposes until the real accounts land.

Generated: 2026-09-21.

## Files

| File | Rows | Class breakdown |
| --- | --- | --- |
| `auto_archive.jsonl` | 150 | 90 `expect_archive:true` / 60 `expect_archive:false` (keep) |
| `draft.jsonl` | 40 | 32 clean / 8 injection-exfil-test (`injected:true`) |
| `task.jsonl` | 100 | 40 `has_action_item:true` / 60 `has_action_item:false` |
| `route_note.jsonl` | 50 | 41 routed to a `thread` / 9 to a `person`; 45 rows offer 4 candidates, 5 offer 3 (schema allows 3–8) |
| `followup.jsonl` | 20 | 5 `first_contact:true`; 2 exercise the linkedin/kakao no-cold-outreach gate |

### Status

**Complete as of slice 6/6.** All five files hold real synthetic rows at their full target
counts, and `pnpm eval:validate` passes across all of them. The counts above are the source
of truth and are additionally enforced by the validator itself: each file is checked against
an expected row count and a hard-coded per-class tally, so a data edit that shifts a
breakdown fails the run rather than silently invalidating this table.

## What `pnpm eval:validate` checks

Run: `pnpm eval:validate` → `tsx tools/eval/validate.ts`

Checks, against a zod schema per file:

1. **File presence** — a missing file is reported as `<file>: MISSING` without aborting the
   other files, so partial progress stays checkable during development.
2. **Schema shape** — every row `JSON.parse`s and validates against its schema; malformed
   JSON and missing/mistyped fields are reported with the file and 1-based line number.
3. **Row counts** — total rows, and the per-class breakdowns in the table above.
4. **Hard gates** — invariants a schema cannot express, checked explicitly:

   | File | Gate |
   | --- | --- |
   | `auto_archive` | VIP or sensitive (`sensitivity !== "normal"`) items are **never** archived — A4 §9 safety invariant |
   | `draft` | `injected:true` ⇔ `injection_payload` non-null; the last `thread` entry is always `from:"them"` |
   | `task` | `has_action_item:false` ⇒ 0 tasks; `true` ⇒ 1–3 tasks; `due_basis:"stated"` ⇔ `due_at` non-null |
   | `route_note` | `expected` names a candidate with the matching `kind` |
   | `followup` | `expected_channel` of `linkedin`/`kakao` ⇒ `last_message_from:"them"` — A4 §7.4 no-cold-outreach |

All failures are collected across all five files before printing a numbered list and exiting
non-zero. Success prints `<file>: N rows OK` per file and exits 0.

### Explicitly out of scope

**This validator checks structure, not model quality.** It measures nothing about how well
any model drafts, routes, or archives. The operational metrics in A4 §3.7 / §4.5 / §7.5 /
§8.4 — draft adoption rate, send-without-edit rate, briefing coverage, and the rest — are
**out of scope until a real inbox is connected**, per backlog §7-1.

Per that same §7-1, the metrics deferred to post-connection are draft adoption (≥50%),
unmodified-send rate (≥20%), and briefing coverage (≥80%). **Not** deferred: the
`auto_archive` VIP/sensitive zero-archive invariant, which is a safety property and must
hold even on synthetic data — hence it is a hard gate here.
