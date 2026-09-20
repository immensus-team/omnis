import type { ToolSet } from "ai";
import { PHANTOM_TOOLS, type ToolName } from "./names.js";
import { PROPOSE_TOOLS } from "./propose.js";
import { READ_TOOLS } from "./read.js";

const ALL: ToolSet = { ...READ_TOOLS, ...PROPOSE_TOOLS };

/** palette에 적힌 것만 모델에게 준다. 팬텀 이름은 ALL에 애초에 없다. */
export function toolRegistry(palette: readonly ToolName[]): ToolSet {
  const out: ToolSet = {};
  for (const name of palette) {
    if (PHANTOM_TOOLS.includes(name)) continue;
    const t = ALL[name];
    if (t !== undefined) out[name] = t;
  }
  return out;
}
