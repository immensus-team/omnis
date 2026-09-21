// The dev proxy table is the whole list of routes the app may call (vite.config.ts's own header).
// A path missing from it fails *quietly*: Vite's SPA fallback answers a GET with index.html and a
// 200, a POST is lost, and nothing appears in the console. Three stories in a row found a route
// missing by hand (US-D10's `/settings`, US-B27's `/search`, loop-r1-05's `/notes`, `/items`,
// `/digests` and `/tasks`), which is what makes this a test rather than a comment: the table is
// checked against the callers, so the next `api/*.ts` write cannot be added without one.
//
// The check is textual on purpose. Reading the config through Vite would need the module to be
// loaded (and the env it reads), and what is being asserted is exactly the source a reader sees.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, "..", "src", "api");
const VITE_CONFIG = join(HERE, "..", "vite.config.ts");

/** `${HUB_HTTP_URL}/<segment>` — the shape every client module uses for a hub path. The capture is
 *  the first path segment, which is also the longest prefix the proxy table matches. */
const HUB_PATH = /\$\{HUB_HTTP_URL\}\/([a-z-]+)/g;

/** `settings.ts` is the one module that builds its URL as `${HUB_HTTP_URL}${path}`, so its prefixes
 *  are invisible to the regex above and have to be named: `/settings` (the screen's read and its
 *  PUTs) and `/cost` (the cost banner). `/kill-switch` is the third of that family and is already
 *  in the table; it is not listed because the two above are the ones this story's siblings broke. */
const PATH_BUILDER_PREFIXES = ["/settings", "/cost"];

function proxiedKeys(): string[] {
  const config = readFileSync(VITE_CONFIG, "utf8");
  return [...config.matchAll(/"(\/[a-z-]+)":/g)].map((m) => m[1] ?? "");
}

function calledSegments(): string[] {
  const segments = new Set<string>();
  for (const file of readdirSync(API_DIR)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(API_DIR, file), "utf8");
    for (const match of source.matchAll(HUB_PATH)) {
      if (match[1] !== undefined) segments.add(`/${match[1]}`);
    }
  }
  return [...segments, ...PATH_BUILDER_PREFIXES].sort();
}

describe("the desktop dev proxy table", () => {
  it("proxies every hub path the api modules call", () => {
    const keys = proxiedKeys();
    const missing = calledSegments().filter((segment) => !keys.includes(segment));
    for (const segment of missing) {
      throw new Error(`${segment} is called from src/api but not proxied in vite.config.ts`);
    }
    expect(missing).toEqual([]);
  });

  // Without this the test passes on a `vite.config.ts` it could not parse — an empty key list means
  // every segment above is "missing", which the case above would report, but a silently empty *call*
  // list would make it vacuous instead. Both sides have to be non-empty for the assertion to mean
  // anything.
  it("found both the callers and the table", () => {
    expect(calledSegments().length).toBeGreaterThanOrEqual(6);
    expect(proxiedKeys().length).toBeGreaterThanOrEqual(6);
  });
});
