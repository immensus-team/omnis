// A4 §8. LLM은 후보를 만들어내지 못한다 — 검색이 준 목록 안에서만 고른다.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

/** A4 §8.3 1행: 1-tap 확인 카드를 띄우는 선. 자동 첨부는 이 위에서도 하지 않는다. */
export const ROUTE_CONFIDENCE_HIGH = 0.8;
/** A4 §8.3 3행: 이 밑이면 제안 자체를 만들지 않는다. */
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
    // A4 §8.3: 0.50 미만이면 라우팅 없이 보관한다. 신뢰도가 아무리 높아도 자동 첨부는 없다.
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
