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
 *
 * Every dataset prints two rows. `current` is the path omnis runs today — T0 only, rule only, or no
 * veto — scored on the same rows with the same counters, deterministic and free of model calls.
 * `jev` is the candidate. Where today's path continues into a text model, that leg is printed as a
 * pending OpenRouter run instead of being invented: a baseline this runner cannot compute is worth
 * naming, not guessing.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  type HostHealth,
  extractHints,
  nonHumanSender,
  routeByRule,
} from "../../../packages/agents/src/index.js";
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

/**
 * Both hosts fresh, as `hostHealth()` would report them on a healthy fleet. This runner must not
 * touch Postgres, so the rule baseline passes this instead of a query — the one input under which
 * `routeByRule` abstains rather than routing on a stale host.
 */
const HEALTHY_FLEET: HostHealth = { mini: { lastHeartbeatMs: 0 }, macbook: { lastHeartbeatMs: 0 } };

/** The label every row of today's model-backed leg carries. See `Scored.llmPending`. */
const PENDING_LLM = "pending OpenRouter run (needs OMNIS_OPENROUTER_API_KEY)";

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
  /** Which arm this row is: `current` (what omnis runs today) or `jev`. */
  label: string;
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

/** One dataset: today's deterministic path, the model leg it falls through to, and the Jev arm. */
interface Scored {
  /** Null only when today's path is itself a model call, which a mock run cannot score. */
  current: Metrics | null;
  /** What the model leg of today's path is, when there is one. Printed as a pending row. */
  llmPending: string | null;
  jev: Metrics;
}

function empty(dataset: string, question: string, label: string): Metrics {
  return {
    dataset,
    question,
    label,
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

function jevRow(dataset: string, question: string, decider: Decider): Metrics {
  return empty(dataset, question, `jev (${decider.run.provider}/${decider.run.model})`);
}

/** The four counters a binary row shares. `answered` is the yes-answer for this row's question. */
function bump(m: Metrics, answered: boolean, expected: boolean, gateBlocked: boolean): void {
  if (answered && expected) m.tp += 1;
  else if (answered) m.fp += 1;
  else if (expected) m.fn += 1;
  else m.tn += 1;
  if (answered && gateBlocked) m.unsafe += 1;
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
): Promise<Scored> {
  const question = `${QUESTION.archive} (boolean)`;
  const cur = empty("auto_archive.jsonl", question, "current (T0 only, no model call)");
  const jev = jevRow("auto_archive.jsonl", question, decider);
  const cases = rows("auto_archive.jsonl", AutoArchiveCase);
  cur.n = cases.length;
  jev.n = cases.length;

  for (const c of cases) {
    const gateBlocked = c.sensitivity !== "normal" || c.vip;
    const headers = c.meta.headers;
    const hasUnsubscribe =
      typeof headers === "object" &&
      headers !== null &&
      typeof (headers as Record<string, unknown>)["List-Unsubscribe"] === "string";

    // T0 first, exactly as the loop does: non-human sender, never replied, no question mark.
    const t0 = !gateBlocked && nonHumanSender(c) && !c.i_replied && !/[?？]/.test(c.body);
    // Today's row: T0 decides and nothing else. What T0 abstains on stays in the inbox.
    bump(cur, t0, c.expect_archive, gateBlocked);

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
      record(jev, res);
      archived = (probabilityOf(res, QUESTION.archive) ?? 0) >= T1_ARCHIVE_CONFIDENCE_MIN;
    }
    // Archived ∪ expected. A gate-blocked row can only ever land in the "keep" column, which is
    // why unsafe is structurally 0 here — the hard gate is not Jev's to answer.
    bump(jev, archived, c.expect_archive, gateBlocked);
  }
  return {
    current: cur,
    // loops/auto-archive.ts: the ambiguous ②/④-b residue wakes the T1 model when the tier abstains.
    llmPending: "the T1 model that answers T0's ambiguous residue (loops/auto-archive.ts)",
    jev,
  };
}

async function scoreTask(
  decider: Decider,
  oracle: Map<DecisionRequest, Record<string, DecisionAnswer>>,
): Promise<Scored> {
  const question = `${QUESTION.delegate} (boolean)`;
  const cur = empty("task.jsonl", question, "current (routeByRule only, no model call)");
  const jev = jevRow("task.jsonl", question, decider);
  const cases = rows("task.jsonl", TaskCase);
  cur.n = cases.length;
  jev.n = cases.length;
  const distribution = `label distribution: ${cases.filter((c) => c.has_action_item && c.expected_tasks.some((t) => t.owner === "agent")).length} delegate / ${cases.length} rows`;
  cur.extras.push(distribution);
  jev.extras.push(distribution);

  for (const c of cases) {
    const expected = c.has_action_item && c.expected_tasks.some((t) => t.owner === "agent");
    // Today's row: the deterministic rules run first and win outright in loops/task.ts, and this
    // golden set carries no file paths, so every row here is one the rules abstain on — a routing
    // is a delegation, an abstention is none.
    bump(cur, routeByRule(extractHints(c.item.body), HEALTHY_FLEET) !== null, expected, false);

    const req = delegationRequest({
      taskTitle: c.item.body.slice(0, 120),
      taskDetail: c.item.body,
      hints: `sender: ${c.item.handle}; no file paths in this row`,
    });
    oracle.set(req, { [QUESTION.delegate]: { type: "boolean", probability: expected ? 1 : 0 } });
    const res = await decider.decide(req);
    record(jev, res);
    const predicted = (probabilityOf(res, QUESTION.delegate) ?? 0) >= DELEGATION_JEV_MIN;
    bump(jev, predicted, expected, false);
  }
  return {
    current: cur,
    // routeDelegation's residue: the eligibility question the tier answers before it was Jev.
    llmPending: "the delegation-eligibility LLM that answers what routeByRule abstains on (loops/task.ts)",
    jev,
  };
}

/** Decision #4's counters: a veto is the positive class, so letting a candidate through is `tn`. */
function vetoRow(m: Metrics, vetoed: boolean, c: z.infer<typeof FollowupCase>): void {
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

async function scoreFollowup(
  decider: Decider,
  oracle: Map<DecisionRequest, Record<string, DecisionAnswer>>,
): Promise<Scored> {
  const question = `${QUESTION.reachOut} (boolean, veto-only)`;
  const cur = empty("followup.jsonl", question, "current (no veto — every candidate is nudged)");
  const jev = jevRow("followup.jsonl", question, decider);
  const cases = rows("followup.jsonl", FollowupCase);
  cur.n = cases.length;
  jev.n = cases.length;

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
    record(jev, res);

    // Today's row: the tier abstains (flag "llm", no veto implemented here), and an abstention is
    // no veto — nothing cancels a candidate the sweep proposed.
    vetoRow(cur, false, c);
    vetoRow(jev, (probabilityOf(res, QUESTION.reachOut) ?? 1) < FOLLOWUP_VETO_BELOW, c);
  }
  return { current: cur, llmPending: null, jev };
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
): Promise<Scored> {
  const question = "note_kind (choice, off-mapping probe)";
  const jev = jevRow("route_note.jsonl", question, decider);
  const cases = rows("route_note.jsonl", RouteNoteCase);
  jev.n = cases.length;
  let correct = 0;
  let traps = 0;
  let trapHits = 0;

  for (const c of cases) {
    const req = routeNoteProbe(c);
    oracle.set(req, {
      note_kind: { type: "choice", choice: c.expected.id, probabilities: { [c.expected.id]: 0.9 } },
    });
    const res = await decider.decide(req);
    record(jev, res);
    const picked = choiceOf(res, "note_kind", c.candidates.map((k) => k.id));
    if (picked === c.expected.id) correct += 1;
    if (c.overconfidence_trap) {
      traps += 1;
      if (picked === c.expected.id) trapHits += 1;
    }
  }
  jev.accuracy = correct / Math.max(1, cases.length);
  jev.extras.push(`overconfidence traps: ${trapHits}/${traps} correct`);
  return {
    // Notes are routed by a T1 text loop, not by a decision this runner can reimplement offline:
    // there is no deterministic arm to score, which is itself the point — see RESULT.md.
    current: null,
    llmPending: "the T1 note_route loop, which is what routes notes today (loops/note-route.ts)",
    jev,
  };
}

// --- Reporting --------------------------------------------------------------------------------

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : (n / d).toFixed(3);
}

function reportRow(m: Metrics): void {
  const asked = m.latencyMs.length;
  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;
  const costPer1k = mean(m.costUsd) * 1000;

  console.log(`  ${m.label}: rows=${m.n} asked=${asked} not_asked=${m.n - asked}`);
  console.log(`    tp=${m.tp} fp=${m.fp} tn=${m.tn} fn=${m.fn} unsafe=${m.unsafe} precision=${pct(m.tp, m.tp + m.fp)} recall=${pct(m.tp, m.tp + m.fn)}`);
  if (m.accuracy !== null) console.log(`    accuracy=${m.accuracy.toFixed(3)}`);
  if (asked === 0) {
    console.log("    latency/cost: n/a — this row makes no model call");
  } else {
    console.log(`    latency mean=${mean(m.latencyMs).toFixed(1)}ms p95=${p95(m.latencyMs)}ms  tokens_in mean=${mean(m.tokensIn).toFixed(0)}  $/1k=${costPer1k.toFixed(4)}`);
  }
  for (const e of m.extras) console.log(`    - ${e}`);
}

/** Today's row first, then the model leg this runner cannot reach, then the candidate. */
function reportDataset(s: Scored): void {
  console.log(`\n${s.jev.dataset}  [${s.jev.question}]`);
  if (s.current !== null) reportRow(s.current);
  if (s.llmPending !== null) console.log(`  current (LLM): ${PENDING_LLM} — ${s.llmPending}`);
  reportRow(s.jev);
}

/**
 * One line, no stack. The AI SDK wraps every non-2xx in a class whose own `type` is the generic
 * `internal_server_error`, and the cause it carries holds the entire request payload — so this reads
 * the Gateway's own error type out of the cause's parsed body and prints nothing else of it.
 */
function diagnose(err: unknown): string {
  const e = err as {
    name?: string;
    message?: string;
    statusCode?: number;
    cause?: { statusCode?: number; data?: unknown; responseBody?: unknown };
  };
  const status = e?.statusCode ?? e?.cause?.statusCode;
  const body = (e?.cause?.data ?? parseJson(e?.cause?.responseBody)) as
    | { error?: { type?: string } }
    | undefined;
  const parts = [
    status === undefined ? null : `HTTP ${status}`,
    body?.error?.type ?? null,
    e?.name ?? null,
    err instanceof Error ? err.message.split("\n")[0]?.slice(0, 200) ?? null : null,
  ];
  return parts.filter((p): p is string => p !== null && p !== "").join(" ") || String(err).slice(0, 200);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
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
      mode = "mock (no credential resolved — see RESULT.md)";
    }
  }
  console.log(`jev gate: mode=${mode} model=${decider.run.provider}/${decider.run.model}`);
  if (decider.run.model.startsWith("mock")) {
    console.log(
      "  mock numbers verify the scorer, not the model: latency is 0 by construction and tokens are estimated at 3 chars/token.",
    );
  }

  try {
    const scored = [
      await scoreAutoArchive(decider, oracle),
      await scoreTask(decider, oracle),
      await scoreFollowup(decider, oracle),
      await scoreRouteNote(decider, oracle),
    ];
    for (const s of scored) reportDataset(s);
  } catch (e) {
    // A provider that answers and then refuses is a different failure from one that never ran, and
    // it is the one a reader of RESULT.md will hit. Diagnose it in a line; never dump the stack,
    // whose error object carries the whole request body.
    console.error(`jev gate: ${mode} run failed, nothing scored — ${diagnose(e)}`);
    console.error("  rerun with --mock for the scorer check, or fix the account and rerun --real.");
    process.exit(1);
  }
}

await main();
