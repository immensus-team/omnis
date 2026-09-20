// A4 §8. The LLM cannot invent candidates — it only picks from the list search hands it.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

/** A4 §8.3 row 1: the line at which a 1-tap confirmation card appears. Auto-attach never happens,
 *  even above it. */
export const ROUTE_CONFIDENCE_HIGH = 0.8;
/** A4 §8.3 row 3: below this, no proposal is created at all. */
export const ROUTE_CONFIDENCE_MIN = 0.5;
const MAX_CANDIDATES = 3;

export const RouteOutput = z.object({
  candidates: z
    .array(
      z.object({
        kind: z.enum(["thread", "person"]),
        id: z.string().uuid(),
        confidence: z.number().min(0).max(1),
        why: z.string().max(160),
        suggested_use: z.enum(["followup", "question", "share", "context_only"]).optional(),
      }),
    )
    .max(MAX_CANDIDATES)
    .default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  injection_flags: z.array(z.string()).default([]),
});
export type RouteOutputT = z.infer<typeof RouteOutput>;

export const noteRouteLoop: LoopSpec<RouteOutputT> = {
  id: "note_route",
  kind: "reactive",
  trigger: { kind: "event", on: "note.created", debounceMs: 2000 },
  palette: ["search_memory", "read_person", "read_thread", "propose_route"],
  budget: { inputTokens: 4000, outputTokens: 450, wallClockMs: 20_000, maxSteps: 2 },
  tier: "T1",
  outputSchema: RouteOutput,

  assemble: (ctx: TriggerContext) =>
    buildContext({ memories: { query: String(ctx.payload.body ?? ""), k: 5 } }),

  async apply(result, ctx) {
    const noteId = ctx.note_id;
    if (noteId === undefined) return;
    // A4 §8.3: below 0.50, file it with no routing. However high the confidence, there is no auto-attach.
    const kept = result.output.candidates
      .filter((c) => c.confidence >= ROUTE_CONFIDENCE_MIN)
      .slice(0, MAX_CANDIDATES);
    if (kept.length === 0) {
      await getAgentsPool().query(
        "UPDATE notes SET route_state = 'none' WHERE id = $1 AND route_state = 'proposed'",
        [noteId],
      );
      return;
    }
    await PROPOSE_TOOLS.propose_route?.execute?.(
      { note_id: noteId, candidates: kept },
      { toolCallId: result.run_id, messages: [], context: undefined },
    );
  },
};

registerLoop(noteRouteLoop);
