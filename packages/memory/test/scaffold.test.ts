import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MemoryKind, MemorySourceKind } from "@omnis/protocol";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

describe("@omnis/memory scaffold", () => {
  it("declares only the four dependencies the delta allows", () => {
    const pkg = JSON.parse(readFileSync(`${REPO}/packages/memory/package.json`, "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      "@omnis/db",
      "@omnis/protocol",
      "ai",
      "pg",
    ]);
  });

  // B-D1: mem0ai는 어떤 패키지에도 들어가지 않는다. 실측 근거는 스파이크 결과 파일에 있다.
  it("never depends on mem0ai anywhere in the workspace", () => {
    const manifests = [
      "package.json",
      "packages/memory/package.json",
      "packages/agents/package.json",
      "apps/hub/package.json",
    ];
    for (const m of manifests) {
      expect(readFileSync(`${REPO}/${m}`, "utf8")).not.toContain("mem0");
    }
  });

  it("records the S-A3-1 FAIL verdict with its evidence", () => {
    const result = readFileSync(`${REPO}/tools/spikes/s-a3-1-mem0-vectorstore/result.md`, "utf8");
    expect(result).toContain("FAIL");
    expect(result).toContain("VectorStoreFactory");
    expect(result).toContain("mem0ai@3.2.0");
  });

  it("re-exports the memory value sets from @omnis/protocol", () => {
    expect(MemorySourceKind.options).toEqual([
      "inbox",
      "calendar",
      "file",
      "drive",
      "github",
      "self",
    ]);
    expect(MemoryKind.options).toEqual(["fact", "preference", "commitment", "event", "summary"]);
  });
});
