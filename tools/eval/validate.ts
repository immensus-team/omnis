/**
 * Golden-set validator (Phase B evals, slice 1/6).
 *
 * Checks the 5 synthetic JSONL golden sets in eval/ for schema shape, class
 * breakdowns, and the safety invariants that a schema alone cannot express
 * (VIP/sensitive never archived, no cold outreach on LinkedIn/KakaoTalk, ...).
 *
 * Scope: structure only. It does NOT measure model quality — the operational
 * metrics in A4 §3.7/§4.5/§7.5/§8.4 need a real inbox, which is not connected
 * yet (docs/superpowers/plans/2026-09-20-phase-b-backlog.md §7-1).
 *
 * Usage: pnpm eval:validate   (exit 0 = all good, exit 1 = failures listed)
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

// Resolved against this file, not cwd, so the script runs from anywhere.
const EVAL_DIR = new URL("../../eval/", import.meta.url);

const AutoArchiveCase = z.object({
  id: z.string(),
  handle: z.string(),
  body: z.string(),
  meta: z.record(z.unknown()),
  sensitivity: z.enum(["normal", "personal", "finance", "legal", "health"]),
  vip: z.boolean(),
  i_replied: z.boolean(),
  expect_archive: z.boolean(),
});

const DraftCase = z.object({
  id: z.string(),
  channel: z.enum(["gmail", "slack_dm", "slack_channel", "telegram", "kakao", "linkedin"]),
  person: z.object({ name: z.string(), vip: z.boolean(), first_contact: z.boolean() }),
  thread: z
    .array(z.object({ from: z.enum(["me", "them"]), body: z.string(), at: z.string() }))
    .min(1),
  voice_sample: z.string(),
  injected: z.boolean(),
  injection_payload: z.string().nullable(),
  expected_reply: z.string(),
  target_length_words: z.number().int().positive(),
});

const TaskCase = z.object({
  id: z.string(),
  item: z.object({
    handle: z.string(),
    body: z.string(),
    sent_by: z.enum(["me", "them"]),
    meta: z.record(z.unknown()),
  }),
  has_action_item: z.boolean(),
  expected_tasks: z
    .array(
      z.object({
        title: z.string(),
        owner: z.enum(["me", "agent"]),
        due_basis: z.enum(["stated", "inferred", "none"]),
        due_at: z.string().nullable(),
      }),
    )
    .max(3),
});

const RouteNoteCase = z.object({
  id: z.string(),
  note_body: z.string(),
  candidates: z
    .array(z.object({ id: z.string(), kind: z.enum(["thread", "person"]), label: z.string() }))
    .min(3)
    .max(8),
  expected: z.object({ kind: z.enum(["thread", "person"]), id: z.string() }),
  overconfidence_trap: z.boolean(),
});

const FollowupCase = z.object({
  id: z.string(),
  meeting: z.object({ person: z.string(), at: z.string(), notes: z.string() }),
  first_contact: z.boolean(),
  past_channels_90d: z.array(
    z.object({
      channel: z.enum(["gmail", "slack", "telegram", "kakao", "linkedin", "whatsapp", "outlook"]),
      count: z.number().int().nonnegative(),
    }),
  ),
  last_message_from: z.enum(["me", "them", "none"]),
  expected_channel: z.enum([
    "gmail",
    "slack",
    "telegram",
    "kakao",
    "linkedin",
    "whatsapp",
    "outlook",
    "task_only",
  ]),
  no_cold_outreach_violation_test: z.boolean(),
});

type Issue = { line: number | null; message: string };
type Failure = Issue & { file: string };
type Row<T> = { line: number; data: T };
type Gate<T> = (rows: Row<T>[]) => Issue[];

const issue = (message: string, line: number | null = null): Issue => ({ line, message });
const tally = <T>(rows: Row<T>[], pred: (data: T) => boolean): number =>
  rows.filter((row) => pred(row.data)).length;

// --- Per-file invariants (the things the schema cannot express) -------------

/** A4 §9: VIP / sensitive items are never archived. */
const autoArchiveGates: Gate<z.infer<typeof AutoArchiveCase>>[] = [
  (rows) => {
    const out: Issue[] = [];
    const archived = tally(rows, (d) => d.expect_archive);
    const kept = rows.length - archived;
    if (archived !== 90) out.push(issue(`expect_archive:true count ${archived} != 90`));
    if (kept !== 60) out.push(issue(`expect_archive:false count ${kept} != 60`));
    for (const row of rows) {
      const { vip, sensitivity, expect_archive } = row.data;
      if ((vip || sensitivity !== "normal") && expect_archive) {
        out.push(
          issue(
            `safety invariant violated: vip=${vip} sensitivity="${sensitivity}" but expect_archive=true (A4 §9)`,
            row.line,
          ),
        );
      }
    }
    return out;
  },
];

const draftGates: Gate<z.infer<typeof DraftCase>>[] = [
  (rows) => {
    const out: Issue[] = [];
    const injected = tally(rows, (d) => d.injected);
    const clean = rows.length - injected;
    if (injected !== 8) out.push(issue(`injected:true count ${injected} != 8`));
    if (clean !== 32) out.push(issue(`injected:false count ${clean} != 32`));
    for (const row of rows) {
      const { injected: isInjected, injection_payload, thread, expected_reply } = row.data;
      if (isInjected && injection_payload === null) {
        out.push(issue("injected=true but injection_payload is null", row.line));
      }
      if (!isInjected && injection_payload !== null) {
        out.push(issue("injected=false but injection_payload is non-null", row.line));
      }
      if (isInjected && injection_payload !== null && expected_reply.includes(injection_payload)) {
        out.push(issue("injection_payload leaked verbatim into expected_reply", row.line));
      }
      // A draft always replies to the counterparty's latest message.
      const last = thread[thread.length - 1];
      if (last !== undefined && last.from !== "them") {
        out.push(issue(`last thread entry is from "${last.from}", expected "them"`, row.line));
      }
    }
    return out;
  },
];

const taskGates: Gate<z.infer<typeof TaskCase>>[] = [
  (rows) => {
    const out: Issue[] = [];
    const withTask = tally(rows, (d) => d.has_action_item);
    const without = rows.length - withTask;
    if (withTask !== 40) out.push(issue(`has_action_item:true count ${withTask} != 40`));
    if (without !== 60) out.push(issue(`has_action_item:false count ${without} != 60`));
    for (const row of rows) {
      const { has_action_item, expected_tasks } = row.data;
      const n = expected_tasks.length;
      if (!has_action_item && n !== 0) {
        out.push(
          issue(`has_action_item=false but expected_tasks.length=${n} (expected 0)`, row.line),
        );
      }
      if (has_action_item && (n < 1 || n > 3)) {
        out.push(
          issue(`has_action_item=true but expected_tasks.length=${n} (expected 1..3)`, row.line),
        );
      }
      expected_tasks.forEach((task, i) => {
        if (task.due_basis === "stated" && task.due_at === null) {
          out.push(issue(`expected_tasks[${i}].due_basis="stated" but due_at is null`, row.line));
        }
        if (task.due_basis !== "stated" && task.due_at !== null) {
          out.push(
            issue(
              `expected_tasks[${i}].due_basis="${task.due_basis}" but due_at is non-null`,
              row.line,
            ),
          );
        }
      });
    }
    return out;
  },
];

const routeNoteGates: Gate<z.infer<typeof RouteNoteCase>>[] = [
  (rows) => {
    const out: Issue[] = [];
    for (const row of rows) {
      const { expected, candidates } = row.data;
      const found = candidates.some((c) => c.id === expected.id && c.kind === expected.kind);
      if (!found) {
        out.push(
          issue(
            `expected ${expected.kind}:${expected.id} matches no candidate of that kind`,
            row.line,
          ),
        );
      }
    }
    return out;
  },
];

/** A4 §7.4: never propose a first-touch draft on LinkedIn or KakaoTalk. */
const followupGates: Gate<z.infer<typeof FollowupCase>>[] = [
  (rows) => {
    const out: Issue[] = [];
    for (const row of rows) {
      const { expected_channel, last_message_from } = row.data;
      const coldOutreachRisk = expected_channel === "linkedin" || expected_channel === "kakao";
      if (coldOutreachRisk && last_message_from !== "them") {
        out.push(
          issue(
            `expected_channel="${expected_channel}" but last_message_from="${last_message_from}" — no-cold-outreach (A4 §7.4)`,
            row.line,
          ),
        );
      }
    }
    return out;
  },
];

// --- Runner -----------------------------------------------------------------

const failures: Failure[] = [];

function validate<T extends z.ZodTypeAny>(
  file: string,
  schema: T,
  expectedRows: number,
  gates: Gate<z.infer<T>>[],
): void {
  const url = new URL(file, EVAL_DIR);
  if (!existsSync(url)) {
    failures.push({ file, line: null, message: "MISSING" });
    return;
  }

  const rows: Row<z.infer<T>>[] = [];
  readFileSync(url, "utf8")
    .split("\n")
    .forEach((raw, i) => {
      if (raw.trim() === "") return;
      const line = i + 1;

      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch (err) {
        failures.push({ file, line, message: `invalid JSON: ${(err as Error).message}` });
        return;
      }

      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i2) => `${i2.path.join(".") || "<root>"}: ${i2.message}`)
          .join("; ");
        failures.push({ file, line, message: `schema: ${detail}` });
        return;
      }
      rows.push({ line, data: parsed.data });
    });

  if (rows.length !== expectedRows) {
    failures.push({ file, line: null, message: `row count ${rows.length} != ${expectedRows}` });
  }
  for (const gate of gates) {
    for (const found of gate(rows)) failures.push({ file, ...found });
  }

  if (!failures.some((f) => f.file === file)) console.log(`${file}: ${rows.length} rows OK`);
}

validate("auto_archive.jsonl", AutoArchiveCase, 150, autoArchiveGates);
validate("draft.jsonl", DraftCase, 40, draftGates);
validate("task.jsonl", TaskCase, 100, taskGates);
validate("route_note.jsonl", RouteNoteCase, 50, routeNoteGates);
validate("followup.jsonl", FollowupCase, 20, followupGates);

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`);
  failures.forEach((f, i) => {
    const where = f.line === null ? f.file : `${f.file}:${f.line}`;
    console.error(`${i + 1}. ${where} — ${f.message}`);
  });
  process.exit(1);
}
