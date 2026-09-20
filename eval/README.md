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
| `route_note.jsonl` | 50 | notes routed to one of 3–8 candidates |
| `followup.jsonl` | 20 | channel-selection cases incl. no-cold-outreach tests |

### Status of these files in this slice

**Slice 1/6 ships the scaffold and validator only.** The five `.jsonl` files exist as
**empty (0-byte) placeholders** so the directory structure and the validator's file list are
real. Later slices fill them with synthetic rows. Running `pnpm eval:validate` today
therefore fails on row count for every file — that is the expected, correct state.

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
