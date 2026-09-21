// The six decisions from docs/decisions/2026-09-21-jev-decision-tier.md, as question sets.
//
// Question ids are a contract with the call sites — they live here as constants so a rename
// cannot silently turn into a null answer. `instructions` teaches the decision; the state is
// the data, and untrusted inbound text belongs in `state` and nowhere else.
import type { DecisionRequest } from "./types.js";

export const QUESTION = {
  scope: "scope",
  priority: "priority",
  archive: "archive",
  worthDrafting: "worth_drafting",
  reachOut: "reach_out",
  followupKind: "kind",
  delegate: "delegate",
  host: "host",
  runtime: "runtime",
  sensitivity: "sensitivity",
} as const;

/** Mirrors @omnis/protocol's Scope / Sensitivity and the enums A4 §2.4 and §5.2 fix. */
export const SCOPE_OPTIONS = ["work", "personal", "unknown"] as const;
export const PRIORITY_OPTIONS = ["now", "today", "week", "fyi"] as const;
export const SENSITIVITY_OPTIONS = ["normal", "personal", "finance", "legal", "health"] as const;
export const RUNTIME_OPTIONS = ["omnis", "codex", "claude_code", "claude_ds"] as const;
export const HOST_OPTIONS = ["mini", "macbook"] as const;

/** The sender is not always in hand (ItemRow carries no handle), so it is optional here. */
function stateOf(i: { from?: string; subject: string | null; body: string }): string {
  return [
    ...(i.from !== undefined ? [`From: ${i.from}`] : []),
    `Subject: ${i.subject ?? ""}`,
    "",
    i.body,
  ].join("\n");
}

/** 1. work/personal scope + label (A4 §2.4). Sensitivity is decision #6, not asked twice. */
export function classifyRequest(i: {
  from?: string;
  subject: string | null;
  body: string;
}): DecisionRequest {
  return {
    kind: "classify",
    state: stateOf(i),
    questions: {
      [QUESTION.scope]: {
        type: "choice",
        instructions:
          "Is this message about Logan's work, about his personal life, or is it impossible to tell?",
        criteria: {
          work: "A business, client, colleague, employer or work-project matter.",
          personal: "Family, friends, health, hobbies, personal errands or personal finance.",
          unknown: "There is not enough information to choose work or personal.",
        },
      },
      [QUESTION.priority]: {
        type: "choice",
        instructions:
          "How soon does this message need Logan's attention? Answer fyi when no action is needed at all.",
        criteria: {
          now: "Needs attention within the hour; someone is blocked or waiting right now.",
          today: "Needs attention before the end of today.",
          week: "Needs attention this week.",
          fyi: "No action needed; information only.",
        },
      },
    },
  };
}

/** 2. auto-archive (A4 §9). Asked only after the five hard gates in hardGate() have passed. */
export function autoArchiveRequest(i: {
  from: string;
  subject: string | null;
  body: string;
  hasUnsubscribe: boolean;
  /** T0 rule ④. A thread Logan has replied to is not bulk mail, so the residue needs this too. */
  hasReplied: boolean;
}): DecisionRequest {
  return {
    kind: "auto_archive",
    state: [
      `From: ${i.from}`,
      `List-Unsubscribe present: ${i.hasUnsubscribe ? "yes" : "no"}`,
      `Logan has replied in this thread: ${i.hasReplied ? "yes" : "no"}`,
      `Subject: ${i.subject ?? ""}`,
      "",
      i.body,
    ].join("\n"),
    questions: {
      [QUESTION.archive]: {
        type: "boolean",
        instructions:
          "Should this message be archived without Logan ever reading it? Answer true only when it is certainly automated bulk mail that needs no reply and no decision from him.",
        criteria: {
          true: "Automated bulk mail: a newsletter, notification, receipt, digest or alert. No question is addressed to Logan and no reply is expected.",
          false:
            "A human wrote to Logan, a question is addressed to him, or anything about it is doubtful.",
        },
      },
    },
  };
}

/** 3. draft-worthiness (A4 §3.1). Veto-only: a true answer leaves the existing trigger gate alone. */
export function draftWorthinessRequest(i: {
  subject: string | null;
  body: string;
  threadTail: string;
}): DecisionRequest {
  return {
    kind: "draft_worthiness",
    state: [
      `Subject: ${i.subject ?? ""}`,
      "",
      "Recent thread:",
      i.threadTail,
      "",
      "Latest message:",
      i.body,
    ].join("\n"),
    questions: {
      [QUESTION.worthDrafting]: {
        type: "boolean",
        instructions:
          "Would a written reply from Logan to this message be useful to him? Answer false when the message needs no reply at all, or when a reply would have to be written by Logan himself for a personal or sensitive reason.",
        criteria: {
          true: "A reply is expected and a draft would save Logan time.",
          false:
            "No reply is expected, or the reply is personal or sensitive enough that Logan should write it himself.",
        },
      },
    },
  };
}

/** 4. follow-up nudge (A4 §7). Veto-only for reach_out; the channel gate stays deterministic. */
export function followupRequest(i: {
  person: string;
  notes?: string;
  lastContactAt?: string | null;
  threadTail: string;
}): DecisionRequest {
  return {
    kind: "followup",
    state: [
      `Person: ${i.person}`,
      `Last contact: ${i.lastContactAt ?? "none recorded"}`,
      `Notes: ${i.notes ?? "none"}`,
      "",
      "Recent thread:",
      i.threadTail,
    ].join("\n"),
    questions: {
      [QUESTION.reachOut]: {
        type: "boolean",
        instructions:
          "Is it appropriate for Logan to reach out to this person now, unprompted? Answer false when a nudge would be unwelcome, premature, or when the relationship is closed.",
        criteria: {
          true: "The relationship is alive and a short, useful nudge fits where it left off.",
          false: "Reaching out now would be unwelcome, premature, or unwanted.",
        },
      },
    },
  };
}

/** 5. delegation eligibility (A4 §5.2). Consulted only when routeByRule() returned null. */
export function delegationRequest(i: {
  taskTitle: string;
  taskDetail: string;
  hints: string;
}): DecisionRequest {
  return {
    kind: "delegation",
    state: [`Task: ${i.taskTitle}`, `Detail: ${i.taskDetail}`, `Extracted hints: ${i.hints}`].join(
      "\n",
    ),
    questions: {
      [QUESTION.delegate]: {
        type: "boolean",
        instructions:
          "Should omnis hand this task to a coding agent to run unattended, or should Logan do it himself? Answer true only when the work is concrete, self-contained and machine-executable.",
        criteria: {
          true: "A concrete, self-contained task an agent can start and finish alone.",
          false: "Ambiguous, needs a human decision, or needs Logan's credentials or judgement.",
        },
      },
      [QUESTION.runtime]: {
        type: "choice",
        instructions: "Which runtime should run it, if it is delegated?",
        criteria: {
          omnis: "Omnis's own tools can do it; no code repository is involved.",
          codex: "A code change while an interactive Codex session is already live.",
          claude_code: "A code change across several files, or one whose spec is unclear.",
          claude_ds: "A small, well-specified code change in one or two files.",
        },
      },
      // routeByRule() answers host for every case it can; Jev is asked only for the residue, so the
      // criteria here are the same two host rules of A4 §5.2 in the order that section lists them.
      [QUESTION.host]: {
        type: "choice",
        instructions: "Which machine should run it, if it is delegated?",
        criteria: {
          macbook: "The work needs Logan's own files under /Users/, or his logged-in desktop apps.",
          mini: "The work must keep running when the MacBook is closed, or is a long batch job.",
        },
      },
    },
  };
}

/**
 * 6. sensitivity routing (A4 §2.4). Merged through pickSensitivity, whose order is a maximum, so a
 * Jev answer can raise a level but never lower one the T0 path already found.
 */
export function sensitivityRequest(i: {
  from?: string;
  subject: string | null;
  body: string;
}): DecisionRequest {
  return {
    kind: "sensitivity",
    state: stateOf(i),
    questions: {
      [QUESTION.sensitivity]: {
        type: "choice",
        instructions:
          "How sensitive is this message? When it is ambiguous, choose the more sensitive option: over-flagging only costs money, while a missed detection breaks privacy.",
        criteria: {
          normal: "Ordinary correspondence with nothing private in it.",
          personal: "Private to Logan or his relationships.",
          finance: "Money, banking, invoices, payments, tax or compensation.",
          legal: "Contracts, disputes, legal advice or regulatory matters.",
          health: "Medical, mental-health or health-insurance matters.",
        },
      },
    },
  };
}
