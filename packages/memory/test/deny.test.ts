import { describe, expect, it } from "vitest";
import {
  DENY_PATTERNS,
  IngestDeniedError,
  MAX_INGEST_FILE_BYTES,
  gitignoreMatcher,
  isBinary,
  isDenied,
} from "../src/ingest/deny.js";

describe("isDenied — A4 §10.2 hard exclusion", () => {
  const denied = [
    "/Users/logan/proj/.env",
    "/Users/logan/proj/.env.local",
    "/Users/logan/certs/server.pem",
    "/Users/logan/certs/server.key",
    "/Users/logan/certs/bundle.p12",
    "/Users/logan/certs/bundle.pfx",
    "/Users/logan/Library/Keychains/login.keychain",
    "/Users/logan/.ssh/id_rsa",
    "/Users/logan/.ssh/id_ed25519.pub",
    "/Users/logan/.npmrc",
    "/Users/logan/.netrc",
    "/Users/logan/.aws/config",
    "/Users/logan/.ssh/known_hosts",
    "/Users/logan/.gnupg/pubring.kbx",
    "/Users/logan/.config/gh/hosts.yml",
    "/Users/logan/proj/credentials.json",
    "/Users/logan/proj/db.sqlite-wal",
    "/Users/logan/proj/.git/config",
    "/Users/logan/proj/node_modules/pkg/index.js",
    "/Users/logan/proj/.venv/lib/x.py",
    "/Users/logan/proj/__pycache__/x.pyc",
    "/Users/logan/dl/archive.zip",
    "/Users/logan/dl/app.dmg",
    "/Users/logan/dl/clip.mp4",
    "/Users/logan/dl/clip.mov",
  ];

  it.each(denied)("denies %s", (p) => {
    expect(isDenied(p)).toBe(true);
  });

  const allowed = [
    "/Users/logan/proj/README.md",
    "/Users/logan/proj/src/index.ts",
    "/Users/logan/notes/2026-09-20.md",
    "/Users/logan/proj/environment.md", // not a .env prefix
    "/Users/logan/proj/keys.md", // not a *.key
    "/Users/logan/proj/docs/gitignore.md",
  ];

  it.each(allowed)("allows %s", (p) => {
    expect(isDenied(p)).toBe(false);
  });

  it("judges by path only and never opens the file", () => {
    // It must be a pure function — a path that does not exist gives the same answer.
    expect(isDenied("/nowhere/at/all/.env")).toBe(true);
    expect(isDenied("/nowhere/at/all/notes.md")).toBe(false);
  });

  it("exposes the pattern list so the bridge and the hub share one source", () => {
    expect(DENY_PATTERNS.length).toBeGreaterThan(15);
    for (const re of DENY_PATTERNS) expect(re).toBeInstanceOf(RegExp);
  });
});

describe("gitignoreMatcher", () => {
  const gi = ["# comment", "", "dist/", "*.log", "/build", "coverage"].join("\n");
  const match = gitignoreMatcher("/repo", gi);

  it("matches directory patterns anywhere below the root", () => {
    expect(match("/repo/dist/main.js")).toBe(true);
    expect(match("/repo/packages/a/dist/x.js")).toBe(true);
  });

  it("matches glob patterns", () => {
    expect(match("/repo/logs/app.log")).toBe(true);
    expect(match("/repo/app.log")).toBe(true);
  });

  it("anchors a leading slash to the root", () => {
    expect(match("/repo/build/x")).toBe(true);
    expect(match("/repo/sub/build/x")).toBe(false);
  });

  it("ignores comments and blank lines and leaves other files alone", () => {
    expect(match("/repo/src/index.ts")).toBe(false);
    expect(match("/repo/comment")).toBe(false);
  });

  it("never matches outside the root", () => {
    expect(match("/other/dist/main.js")).toBe(false);
  });
});

describe("isBinary / size cap", () => {
  it("calls a buffer with a NUL byte in the first 8KB binary", () => {
    const buf = Buffer.concat([Buffer.from("text text "), Buffer.from([0x00]), Buffer.alloc(10)]);
    expect(isBinary(buf)).toBe(true);
  });

  it("calls ordinary utf-8 text non-binary", () => {
    expect(isBinary(Buffer.from("ordinary utf-8 english text\n"))).toBe(false);
  });

  it("only looks at the first 8KB", () => {
    const buf = Buffer.concat([Buffer.alloc(8192, 0x41), Buffer.from([0x00])]);
    expect(isBinary(buf)).toBe(false);
  });

  it("pins the 2MB cap from A4 §10.2", () => {
    expect(MAX_INGEST_FILE_BYTES).toBe(2_000_000);
  });
});

describe("IngestDeniedError", () => {
  it("carries the path and names itself", () => {
    const e = new IngestDeniedError("/Users/logan/.env");
    expect(e.name).toBe("IngestDeniedError");
    expect(e.message).toContain("/Users/logan/.env");
  });
});
