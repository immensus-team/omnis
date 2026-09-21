/**
 * The Jev gate (jev-spike slice 4). Scores Jev against the four golden sets that carry a decision
 * Jev could take over, and prints precision / recall / unsafe / latency / $ per 1k.
 *
 *   pnpm spike:jev          auto — real Jev when a credential resolves, the mock oracle otherwise
 *   pnpm spike:jev --mock   force the mock
 *   pnpm spike:jev --real   force the real provider (fails loudly without a credential)
 *
 * What each golden set is scored on, and why:
 *
 *   auto_archive  decision #2, exactly as loops/auto-archive.ts runs it: hard gate → T0 → Jev on
 *                 the residue, threshold 0.85. This is the one dataset where Jev answers a question
 *                 whose ground truth the file already states (`expect_archive`).
 *   task          decision #5's `delegate` question only. The golden set has no file paths, so
 *                 routeByRule's rules cannot fire and every row is the residue Jev would get.
 *                 `expected_tasks[].owner === "agent"` is the label.
 *   followup      decision #4 is veto-only, so the number that matters is not accuracy but how
 *                 often Jev would cancel a candidate the sweep considered valid. Reported as a
 *                 false-veto list, with the two no-cold-outreach rows called out separately —
 *                 a veto there is correct, not an error.
 *   route_note    NOT one of the six. No call site asks Jev about note routing; this is an
 *                 off-mapping probe that asks whether a `choice` question over the candidate list
 *                 would have picked the expected one. Reported separately and consumed by nothing.
 *
 * Nothing here touches the database, the settings flag, or the hub: the runner calls the decider
 * directly so a spike run cannot change production behaviour or record a run.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { nonHumanSender } from "../../../packages/agents/src/index.js";
import {
  QUESTION,
  autoArchiveRequest,
  delegationRequest,
  followupRequest,
} from "../../../packages/agents/src/decision/decisions.js";
import type {
  Decider,
  DecisionAnswer,
  DecisionRequest,
  DecisionResponse,
} from "../../../packages/agents/src/decision/types.js";
import { choiceOf, probabilityOf } from "../../../packages/agents/src/decision/types.js";
import { JEV_PRICE_IN_PER_MTOK, JevDecider } from "../../../packages/agents/src/providers/jev.js";
import { EVAL_DIR, AutoArchiveCase, FollowupCase, RouteNoteCase, TaskCase } from "../../eval/schemas.js";

const T1_ARCHIVE_CONFIDENCE_MIN = 0.85; // mirrors loops/auto-archive.ts
const DELEGATION_JEV_MIN = 0.7; // mirrors loops/task.ts
const FOLLOWUP_VETO_BELOW = 0.15; // mirrors loops/followup.ts

function rows<T extends z.ZodTypeAny>(file: string, schema: T): z.infer<T>[] {
  const url = new URL(file, EVAL_DIR);
  return readFileSync(url, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => schema.parse(JSON.parse(l)) as z.infer<T>);
}

interface Metrics {
  dataset: string;
  question: string;
  n: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  unsafe: number;
  /** Set only for the multinomial probe, where a binary confusion matrix is not meaningful. */
  accuracy: number | null;
  extras: string[];
  latencyMs: number[];
  tokensIn: number[];
  costUsd: number[];
}

function empty(dataset: string, question: string): Metrics {
  return {
    dataset,
    question,
    n: 0,
    tp: 0,
    fp: 0,
    tn: 0,
    fn: 0,
    unsafe: 0,
    accuracy: null,
    extras: [],
    latencyMs: [],
    tokensIn: [],
    costUsd: [],
  };
}

function record(m: Metrics, response: DecisionResponse): void {
  m.latencyMs.push(response.latencyMs);
  m.tokensIn.push(response.tokensIn);
  m.costUsd.push(response.costUsd);
}

// --- The mock oracle ------------------------------------------------------------------------
//
// Mock mode answers from the golden set's own label, deliberately inverted on a deterministic
// 15% of rows. The point is not to imitate Jev — it is to prove the scorer counts: an all-oracle
// mock would leave fp/fn/unsafe pinned at zero and would verify nothing. Every number it produces
// describes this harness, never the model.

const MOCK_ERROR_RATE = 0.15;

/** FNV-1a over the state, so the same row is wrong on every run and a regression is diffable. */
function noise(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

function counterAnswer(req: DecisionRequest, id: string, truth: DecisionAnswer): DecisionAnswer {
  const q = req.questions[id];
  if (q?.type === "choice" && truth.choice !== undefined) {
    const other = Object.keys(q.criteria).find((k) => k !== truth.choice);
    if (other !== undefined) return { type: "choice", choice: other, probabilities: { [other]: 0.6 } };
  }
  return { type: "boolean", probability: 1 - (truth.probability ?? 0) };
}

/** Rough: Korean text runs near 1.5 chars/token and English near 4, so 3 splits the difference. */
function estimateTokens(req: DecisionRequest): number {
  const instructions = Object.values(req.questions)
    .map((q) => [q.instructions, ...Object.values(q.criteria ?? {})].join(" "))
    .join(" ");
  return Math.ceil((req.state.length + instructions.length) / 3);
}

function mockDecider(oracle: Map<DecisionRequest, Record<string, DecisionAnswer>>): Decider {
  const run = { provider: "local", model: "mock-oracle-v1" } as const;
  return {
    run,
    available: async () => true,
    decide: async (req) => {
      const truth = oracle.get(req);
      if (truth === undefined) throw new Error(`mock has no oracle entry for ${req.kind}`);
      const answers: Record<string, DecisionAnswer> = {};
      for (const [id, answer] of Object.entries(truth)) {
        answers[id] =
          noise(req.state + id) < MOCK_ERROR_RATE ? counterAnswer(req, id, answer) : answer;
      }
      const tokensIn = estimateTokens(req);
      return {
        provider: run.provider,
        model: run.model,
        answers,
        confidence: {},
        latencyMs: 0,
        tokensIn,
        tokensOut: 0,
        costUsd: (tokensIn / 1_000_000) * JEV_PRICE_IN_PER_MTOK,
      };
    },
  };
}

// --- Scorers ---------------------------------------------------------------------------------

async function scoreAutoArchive(
  decider: Decider,
  oracle: Map<DecisionRequest, Record<string, DecisionAnswer>>,
): Promise<Metrics> {
  const m = empty("auto_archive.jsonl", `${QUESTION.archive} (boolean)`);
  const cases = rows("auto_archive.jsonl", AutoArchiveCase);
  m.n = cases.length;

  for (const c of cases) {
    const gateBlocked = c.sensitivity !== "normal" || c.vip;
    const headers = c.meta.headers;
    const hasUnsubscribe =
      typeof headers === "object" &&
      headers !== null &&
      typeof (headers as Record<string, unknown>)["List-Unsubscribe"] === "string";

    // T0 first, exactly as the loop does: non-human sender, never replied, no question mark.
    const t0 = !gateBlocked && nonHumanSender(c) && !c.i_replied && !/[?？]/.test(c.body);
    let archived = t0;
    if (!t0 && !gateBlocked) {
      const req = autoArchiveRequest({
        from: c.handle,
        subject: null,
        body: c.body,
        hasUnsubscribe,
        hasReplied: c.i_replied,
      });
      oracle.set(req, { [QUESTION.archive]: { type: "boolean", probability: c.expect_archive ? 1 : 0 } });
      const res = await decider.decide(req);
      record(m, res);
      archived = (probabilityOf(res, QUESTION.archive) ?? 0) >= T1_ARCHIVE_CONFIDENCE_MIN;
    }
    // Archived ∪ expected. A gate-blocked row can only ever land in the "keep" column, which is
    // why unsafe is structurally 0 here — the hard gate is not Jev's to answer.
    if (archived && c.expect_archive) m.tp += 1;
    if (archived && !c.expect_archive) m.fp += 1;
    if (!archived && c.expect_archive) m.fn += 1;
    if (!archived && !c.expect_archive) m.tn += 1;
    if (archived && gateBlocked) m.unsafe += 1;
  }
  return m;
}

async function scoreTask(
  decider: Decider,
  oracle: Map<DecisionRequest, Record<string, DecisionAnswer>>,
): Promise<Metrics> {
  const m = empty("task.jsonl", `${QUESTION.delegate} (boolean)`);
  const cases = rows("task.jsonl", TaskCase);
  m.n = cases.length;
  m.extras.push(
    `label distribution: ${cases.filter((c) => c.has_action_item && c.expected_tasks.some((t) => t.owner === "agent")).length} delegate / ${cases.length} rows`,
  );

  for (const c of cases) {
    const expected = c.has_action_item && c.expected_tasks.some((t) => t.owner === "agent");
    const req = delegationRequest({
      taskTitle: c.item.body.slice(0, 120),
      taskDetail: c.item.body,
      hints: `sender: ${c.item.handle}; no file paths in this row`,
    });
    oracle.set(req, { [QUESTION.delegate]: { type: "boolean", probability: expected ? 1 : 0 } });
    const res = await decider.decide(req);
    record(m, res);
    const predicted = (probabilityOf(res, QUESTION.delegate) ?? 0) >= DELEGATION_JEV_MIN;
    if (predicted && expected) m.tp += 1;
    if (predicted && !expected) m.fp += 1;
    if (!predicted && expected) m.fn += 1;
    if (!predicted && !expected) m.tn += 1;
  }
  return m;
}

async function scoreFollowup(
  decider: Decider,
  oracle: Map<DecisionRequest, Record<string, DecisionAnswer>>,
): Promise<Metrics> {
  const m = empty("followup.jsonl", `${QUESTION.reachOut} (boolean, veto-only)`);
  const cases = rows("followup.jsonl", FollowupCase);
  m.n = cases.length;

  for (const c of cases) {
    const req = followupRequest({
      person: c.meeting.person,
      notes: c.meeting.notes,
      lastContactAt: c.meeting.at,
      threadTail:
        c.past_channels_90d.length === 0
          ? "No prior conversation on any channel."
          : `Channels in the last 90 days: ${c.past_channels_90d
              .map((p) => `${p.channel} (${p.count})`)
              .join(", ")}.`,
    });
    // Every row in this set is a candidate the sweep already judged worth a look, so the oracle is
    // "reach out" — a veto is what we are measuring, and the cold-outreach rows are the exception.
    oracle.set(req, { [QUESTION.reachOut]: { type: "boolean", probability: 1 } });
    const res = await decider.decide(req);
    record(m, res);

    const vetoed = (probabilityOf(res, QUESTION.reachOut) ?? 1) < FOLLOWUP_VETO_BELOW;
    const coldRisk = c.expected_channel === "linkedin" || c.expected_channel === "kakao";
    if (!vetoed) m.tn += 1; // let it through: correct for a veto-only gate
    else if (coldRisk) {
      m.tp += 1;
      m.extras.push(`${c.id}: vetoed a no-cold-outreach candidate — correct`);
    } else {
      m.fp += 1;
      m.extras.push(`${c.id}: vetoed ${c.expected_channel} (first_contact=${c.first_contact})`);
    }
  }
  return m;
}

/**
 * Off-mapping probe: a `choice` over the candidate list, as if note routing were a decision kind.
 * No call site does this — see the header. It is here because the task asked for route_note.jsonl
 * and a fabricated metric would be worse than a clearly-labelled probe.
 */
function routeNoteProbe(c: z.infer<typeof RouteNoteCase>): DecisionRequest {
  return {
    kind: "classify",
    state: c.note_body,
    questions: {
      note_kind: { type: "choice", instructions: "Which candidate does this note belong to?", criteria: Object.fromEntries(c.candidates.map((k) => [k.id, `${k.kind}: ${k.label}`])) },
    },
  };
}

async function scoreRouteNote(
  decider: Decider,
  oracle: Map<DecisionRequest, Record<string, DecisionAnswer>>,
): Promise<Metrics> {
  const m = empty("route_note.jsonl", "note_kind (choice, off-mapping probe)");
  const cases = rows("route_note.jsonl", RouteNoteCase);
  m.n = cases.length;
  let correct = 0;
  let traps = 0;
  let trapHits = 0;

  for (const c of cases) {
    const req = routeNoteProbe(c);
    oracle.set(req, {
      note_kind: { type: "choice", choice: c.expected.id, probabilities: { [c.expected.id]: 0.9 } },
    });
    const res = await decider.decide(req);
    record(m, res);
    const picked = choiceOf(res, "note_kind", c.candidates.map((k) => k.id));
    if (picked === c.expected.id) correct += 1;
    if (c.overconfidence_trap) {
      traps += 1;
      if (picked === c.expected.id) trapHits += 1;
    }
  }
  m.accuracy = correct / Math.max(1, cases.length);
  m.extras.push(`overconfidence traps: ${trapHits}/${traps} correct`);
  return m;
}

// --- Reporting --------------------------------------------------------------------------------

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : (n / d).toFixed(3);
}

function report(m: Metrics): void {
  const asked = m.latencyMs.length;
  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;
  const costPer1k = mean(m.costUsd) * 1000;

  console.log(`\n${m.dataset}  [${m.question}]`);
  console.log(`  rows=${m.n} asked=${asked} not_asked=${m.n - asked}`);
  console.log(`  tp=${m.tp} fp=${m.fp} tn=${m.tn} fn=${m.fn} unsafe=${m.unsafe} precision=${pct(m.tp, m.tp + m.fp)} recall=${pct(m.tp, m.tp + m.fn)}`);
  if (m.accuracy !== null) console.log(`  accuracy=${m.accuracy.toFixed(3)}`);
  console.log(`  latency mean=${mean(m.latencyMs).toFixed(1)}ms p95=${p95(m.latencyMs)}ms  tokens_in mean=${mean(m.tokensIn).toFixed(0)}  $/1k=${costPer1k.toFixed(4)}`);
  for (const e of m.extras) console.log(`  - ${e}`);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const forced = args.has("--mock") ? "mock" : args.has("--real") ? "real" : "auto";

  const oracle = new Map<DecisionRequest, Record<string, DecisionAnswer>>();
  let decider: Decider;
  let mode: string;

  if (forced === "mock") {
    decider = mockDecider(oracle);
    mode = "mock (forced)";
  } else {
    const real = new JevDecider();
    if (await real.available()) {
      decider = real;
      mode = "real";
    } else if (forced === "real") {
      console.error("--real was passed but no credential resolved (env OMNIS_AI_GATEWAY_API_KEY or Keychain omnis.vercel.ai_gateway).");
      process.exit(1);
      return;
    } else {
      decider = mockDecider(oracle);
      mode = "mock (no credential — see RESULT.md, 'pending real key')";
    }
  }
  console.log(`jev gate: mode=${mode} model=${decider.run.provider}/${decider.run.model}`);
  if (decider.run.model.startsWith("mock")) {
    console.log(
      "  mock numbers verify the scorer, not the model: latency is 0 by construction and tokens are estimated at 3 chars/token.",
    );
  }

  const metrics = [
    await scoreAutoArchive(decider, oracle),
    await scoreTask(decider, oracle),
    await scoreFollowup(decider, oracle),
    await scoreRouteNote(decider, oracle),
  ];
  for (const m of metrics) report(m);
}

await main();
