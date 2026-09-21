/**
 * The row schemas for the eval/ golden sets, extracted from validate.ts.
 *
 * The validator owns the definition of what a golden-set row is; the Jev gate runner borrows it
 * rather than keeping a second copy that could drift. Nothing here has side effects, so importing
 * it does not run the validator.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/** Resolved against this file, not cwd, so scripts run from anywhere. */
export const EVAL_DIR = new URL("../../eval/", import.meta.url);

export const AutoArchiveCase = z.object({
  id: z.string(),
  handle: z.string(),
  body: z.string(),
  meta: z.record(z.unknown()),
  sensitivity: z.enum(["normal", "personal", "finance", "legal", "health"]),
  vip: z.boolean(),
  i_replied: z.boolean(),
  expect_archive: z.boolean(),
});

export const DraftCase = z.object({
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

export const TaskCase = z.object({
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

export const RouteNoteCase = z.object({
  id: z.string(),
  note_body: z.string(),
  candidates: z
    .array(z.object({ id: z.string(), kind: z.enum(["thread", "person"]), label: z.string() }))
    .min(3)
    .max(8),
  expected: z.object({ kind: z.enum(["thread", "person"]), id: z.string() }),
  overconfidence_trap: z.boolean(),
});

export const FollowupCase = z.object({
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
