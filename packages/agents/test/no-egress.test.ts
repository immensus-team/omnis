import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PHANTOM_TOOLS } from "../src/tools/names.js";

// Does not lean on cwd: the root `pnpm test` (unit project) must scan the same file set too.
const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : [],
  );
}

describe("@omnis/agents tool isolation (A7 §7 common bans)", () => {
  it("never mentions an irreversible tool name in a tool definition", () => {
    // names.ts owns the name list; this only checks that they never appear as a definition.
    for (const f of sources(SRC)) {
      const text = readFileSync(f, "utf8");
      for (const name of PHANTOM_TOOLS) {
        expect(text, `${f} defines phantom tool ${name}`).not.toMatch(
          new RegExp(`${name}\\s*:\\s*tool\\(`),
        );
      }
      expect(text, `${f} calls delegate.run directly`).not.toMatch(/delegate\.run/);
    }
  });

  it("imports provider SDKs only under src/t1/ and src/t2/", () => {
    for (const f of sources(SRC)) {
      if (f.includes(`${"t1"}/`) || f.includes(`${"t2"}/`)) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(/@ai-sdk\//);
    }
  });
});
