import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// cwd에 기대지 않는다: 루트 `pnpm test`(unit 프로젝트)에서도 같은 파일 집합을 훑어야 한다.
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

describe("@omnis/agents tool isolation (A7 §7 공통 금지)", () => {
  it("never declares an irreversible tool", () => {
    const forbidden = [/\btools\s*:/, /sendMessage/, /calendar_write/, /delegate\.run/];
    for (const f of sources(SRC)) {
      const text = readFileSync(f, "utf8");
      for (const p of forbidden) expect(text, `${f} matched ${p}`).not.toMatch(p);
    }
  });

  it("imports provider SDKs only under src/t1/", () => {
    for (const f of sources(SRC)) {
      if (f.includes(`${"t1"}/`)) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(/@ai-sdk\//);
    }
  });
});
