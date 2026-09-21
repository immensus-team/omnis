// The guard for apps/web/src/vendor/app-styles.css's header rule. apps/web cannot import
// apps/desktop (a separate workspace package), so the component classes the reused @omnis/ui
// components need are copied into that file — and until this test existed, nothing failed when the
// copy was forgotten. It was: 4,394 lines at 5ddba46 against a 5,726-line source, and every inbox
// row in the PWA collapsed into a ~50px column because the row's layout rules were among the 1,332
// lines that had never been copied. No build step and no generator — a test that reads two files.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDORED = join(HERE, "../src/vendor/app-styles.css");
const SOURCE = join(HERE, "../../desktop/src/app.css");

/** Everything below the vendored file's leading block comment — the header itself is the one part
 *  that is deliberately not a copy of the source (it records where the copy came from). */
function bodyAfterHeader(css: string): string {
  const end = css.indexOf("*/");
  if (end === -1) throw new Error("the vendored stylesheet has no header comment to strip");
  return css.slice(end + "*/".length + 1);
}

describe("apps/web/src/vendor/app-styles.css (the re-copy rule)", () => {
  it("is apps/desktop/src/app.css below its header, verbatim", () => {
    const vendored = bodyAfterHeader(readFileSync(VENDORED, "utf8"));
    const source = readFileSync(SOURCE, "utf8");
    expect(
      vendored,
      "apps/web/src/vendor/app-styles.css is stale — re-copy apps/desktop/src/app.css below the header",
    ).toBe(source);
  });
});
