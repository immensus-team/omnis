import type { ToolSet } from "ai";
import { PHANTOM_TOOLS, type ToolName } from "./names.js";
import { PROPOSE_TOOLS } from "./propose.js";
import { READ_TOOLS } from "./read.js";

const ALL: ToolSet = { ...READ_TOOLS, ...PROPOSE_TOOLS };

/** Only what the palette lists is given to the model. Phantom names are never in ALL to begin with. */
export function toolRegistry(palette: readonly ToolName[]): ToolSet {
  const out: ToolSet = {};
  for (const name of palette) {
    if (PHANTOM_TOOLS.includes(name)) continue;
    const t = ALL[name];
    if (t !== undefined) out[name] = t;
  }
  return out;
}
