import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeError, META_KEYS, PROTOCOL_VERSION } from "@omnis/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { handleIngestRead, handleIngestScan } from "../src/ingest.js";
import { createDispatcher } from "../src/rpc-dispatch.js";

let allowed: string;
let outside: string;

// ponytail: full Logger has `log` too; only `warn` is exercised here but the
// deps type is the shared Logger, so the stub must satisfy it structurally.
const logger = {
  log: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

beforeEach(async () => {
  // normalized with realpath — because assertPathAllowed re-checks realpath (A2-D12), on macOS a
  // path like $TMPDIR (/var/folders/...) that is itself a symlink ends up with a different comparison basis.
  allowed = await realpath(await mkdtemp(join(tmpdir(), "omnis-allowed-")));
  outside = await realpath(await mkdtemp(join(tmpdir(), "omnis-outside-")));
});

describe("handleIngestScan (A2 §3.2)", () => {
  it("lists files under a root that is inside allowed_roots", async () => {
    await mkdir(join(allowed, "sub"), { recursive: true });
    await writeFile(join(allowed, "a.md"), "body A");
    await writeFile(join(allowed, "sub", "b.md"), "body B");

    const res = await handleIngestScan({ roots: [allowed] }, { allowedRoots: [allowed], logger });
    expect(res.files.map((f) => f.path).sort()).toEqual(
      [join(allowed, "a.md"), join(allowed, "sub", "b.md")].sort(),
    );
    expect(res.truncated).toBe(false);
    for (const f of res.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(f.size).toBeGreaterThan(0);
    }
  });

  // bound 1: allowlist ∩ allowed_roots intersection. Whatever the hub sends, the bridge re-cuts it.
  it("rejects a root outside allowed_roots with PATH_NOT_ALLOWED", async () => {
    await expect(
      handleIngestScan({ roots: [outside] }, { allowedRoots: [allowed], logger }),
    ).rejects.toMatchObject({ name: "BridgeError", code: -32005 });
  });

  it("drops the disallowed root and keeps the allowed one when both are sent", async () => {
    await writeFile(join(allowed, "a.md"), "body");
    const res = await handleIngestScan(
      { roots: [allowed, outside] },
      { allowedRoots: [allowed], logger, skipDisallowedRoots: true },
    );
    expect(res.files.map((f) => f.path)).toEqual([join(allowed, "a.md")]);
  });

  it("filters by since", async () => {
    await writeFile(join(allowed, "a.md"), "body");
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await handleIngestScan(
      { roots: [allowed], since: future },
      { allowedRoots: [allowed], logger },
    );
    expect(res.files).toEqual([]);
  });

  // bound 2: secret files are always rejected.
  it("never lists a denied path even when it is inside an allowed root", async () => {
    await writeFile(join(allowed, ".env"), "SECRET=1");
    await writeFile(join(allowed, "ok.md"), "ok");
    const res = await handleIngestScan({ roots: [allowed] }, { allowedRoots: [allowed], logger });
    expect(res.files.map((f) => f.path)).toEqual([join(allowed, "ok.md")]);
  });

  it("sets truncated when it hits the file cap", async () => {
    for (let i = 0; i < 5; i += 1) await writeFile(join(allowed, `f${i}.md`), `body ${i}`);
    const res = await handleIngestScan(
      { roots: [allowed] },
      { allowedRoots: [allowed], logger, maxFiles: 3 },
    );
    expect(res.files).toHaveLength(3);
    expect(res.truncated).toBe(true);
  });
});

describe("handleIngestRead (A2 §3.2)", () => {
  it("returns base64 content with the byte count and mtime", async () => {
    await writeFile(join(allowed, "a.md"), "body A");
    const res = await handleIngestRead(
      { path: join(allowed, "a.md"), max_bytes: 1_048_576 },
      { allowedRoots: [allowed], logger },
    );
    expect(Buffer.from(res.content_b64, "base64").toString("utf8")).toBe("body A");
    expect(res.bytes).toBe(Buffer.byteLength("body A"));
    expect(res.truncated).toBe(false);
    expect(res.path).toBe(join(allowed, "a.md"));
  });

  // bound 3: 1MB truncation.
  it("truncates at max_bytes and says so", async () => {
    await writeFile(join(allowed, "big.md"), "A".repeat(5000));
    const res = await handleIngestRead(
      { path: join(allowed, "big.md"), max_bytes: 1000 },
      { allowedRoots: [allowed], logger },
    );
    expect(res.bytes).toBe(1000);
    expect(res.truncated).toBe(true);
    expect(Buffer.from(res.content_b64, "base64")).toHaveLength(1000);
  });

  it("refuses a path outside allowed_roots", async () => {
    await writeFile(join(outside, "a.md"), "body");
    await expect(
      handleIngestRead(
        { path: join(outside, "a.md"), max_bytes: 1000 },
        { allowedRoots: [allowed], logger },
      ),
    ).rejects.toBeInstanceOf(BridgeError);
  });

  it("refuses a denied path with PATH_NOT_ALLOWED, not a generic error", async () => {
    await writeFile(join(allowed, ".env"), "SECRET=1");
    await expect(
      handleIngestRead(
        { path: join(allowed, ".env"), max_bytes: 1000 },
        { allowedRoots: [allowed], logger },
      ),
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("refuses a binary file instead of shipping bytes the hub cannot use", async () => {
    await writeFile(join(allowed, "blob.dat"), Buffer.from([0x41, 0x00, 0x42]));
    await expect(
      handleIngestRead(
        { path: join(allowed, "blob.dat"), max_bytes: 1000 },
        { allowedRoots: [allowed], logger },
      ),
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("refuses a missing file with PATH_NOT_ALLOWED rather than leaking the errno", async () => {
    await expect(
      handleIngestRead(
        { path: join(allowed, "nope.md"), max_bytes: 1000 },
        { allowedRoots: [allowed], logger },
      ),
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("createDispatcher — ingest methods are no longer blocked by the Phase B gate", () => {
  it("routes ingest.scan to the handler", async () => {
    await writeFile(join(allowed, "a.md"), "body");
    const dispatch = createDispatcher({
      registry: { get: () => undefined } as never,
      adapters: new Map(),
      allowedRoots: new Map([["codex", [allowed]]]),
      runtimeIds: new Map(),
      logger,
      host: "macbook",
    });
    const res = (await dispatch("ingest.scan", {
      roots: [allowed],
      _meta: { [META_KEYS.protocolVersion]: PROTOCOL_VERSION },
    })) as { files: Array<{ path: string }> };
    expect(res.files.map((f) => f.path)).toEqual([join(allowed, "a.md")]);
  });
});
