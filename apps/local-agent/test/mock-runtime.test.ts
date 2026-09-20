import { describe, expect, it } from "vitest";
import { FIXTURES, mockSpawn } from "./mock-runtime.js";

describe("mock runtime process", () => {
  it("replays a claude stream-json fixture over real stdio", async () => {
    const child = mockSpawn(FIXTURES.claudeToolCall)("claude", ["-p"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines: string[] = [];
    child.stdout?.on("data", (d: Buffer) =>
      lines.push(
        ...d
          .toString("utf8")
          .split("\n")
          .filter((l) => l.length > 0),
      ),
    );
    await new Promise((r) => child.on("close", r));
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(JSON.parse(lines[0] as string).type).toBe("system");
    expect(JSON.parse(lines[lines.length - 1] as string).type).toBe("result");
  });

  it("replays a codex app-server fixture as JSON-RPC notifications", async () => {
    const child = mockSpawn(FIXTURES.codexToolCall)("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines: string[] = [];
    child.stdout?.on("data", (d: Buffer) =>
      lines.push(
        ...d
          .toString("utf8")
          .split("\n")
          .filter((l) => l.length > 0),
      ),
    );
    await new Promise((r) => child.on("close", r));
    expect(JSON.parse(lines[0] as string).method).toBe("thread.started");
  });
});
