import { PHANTOM_TOOLS, TOOL_NAMES } from "../tools/names.js";
import { type LoopBudget, type LoopId, type LoopSpec, PhantomToolError } from "./spec.js";

const registry = new Map<LoopId, LoopSpec<unknown>>();

const BUDGET_FIELDS: readonly (keyof LoopBudget)[] = [
  "inputTokens",
  "outputTokens",
  "wallClockMs",
  "maxSteps",
];

export function registerLoop<T>(spec: LoopSpec<T>): void {
  if (registry.has(spec.id)) throw new Error(`loop "${spec.id}" is already registered`);
  for (const name of spec.palette) {
    if (PHANTOM_TOOLS.includes(name)) throw new PhantomToolError(name);
    if (!TOOL_NAMES.includes(name)) throw new PhantomToolError(name);
  }
  if (spec.trigger.kind === "schedule" && spec.trigger.cron === undefined) {
    throw new Error(`loop "${spec.id}": schedule trigger needs cron`);
  }
  if (spec.trigger.kind === "event" && spec.trigger.on === undefined) {
    throw new Error(`loop "${spec.id}": event trigger needs on`);
  }
  for (const f of BUDGET_FIELDS) {
    if (!(spec.budget[f] > 0)) {
      throw new Error(`loop "${spec.id}": budget.${f} must be > 0, got ${spec.budget[f]}`);
    }
  }
  registry.set(spec.id, spec as LoopSpec<unknown>);
}

export function getLoop(id: LoopId): LoopSpec<unknown> {
  const spec = registry.get(id);
  if (spec === undefined) throw new Error(`loop "${id}" is not registered`);
  return spec;
}

export function listLoops(): LoopSpec<unknown>[] {
  return [...registry.values()];
}

/** 테스트 전용. 프로덕션 코드에서 호출하지 않는다. */
export function resetLoopRegistryForTest(): void {
  registry.clear();
}
