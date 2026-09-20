import { fileURLToPath } from "node:url";

/** Internal packages resolve to source TS, not build output. Production uses the dist from tsc --build. */
export const omnisAlias: Record<string, string> = {
  "@omnis/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
  "@omnis/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
  "@omnis/memory": fileURLToPath(new URL("./packages/memory/src/index.ts", import.meta.url)),
  // Vite string aliases are prefix substitutions — the subpath entry must come before
  // the bare entry so "@omnis/kernel/zero" doesn't break into ".../src/index.ts/zero".
  "@omnis/kernel/zero": fileURLToPath(
    new URL("./packages/kernel/src/zero-schema.ts", import.meta.url),
  ),
  "@omnis/kernel": fileURLToPath(new URL("./packages/kernel/src/index.ts", import.meta.url)),
};
