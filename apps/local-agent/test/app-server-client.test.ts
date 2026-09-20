import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AppServerClient } from "../src/bridges/app-server-client.js";

describe("AppServerClient", () => {
  it("correlates a response to its request id", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const c = new AppServerClient({ stdin, stdout });
    const p = c.request("thread.start", { cwd: "/tmp" });
    const sent = JSON.parse((await new Promise<Buffer>((r) => stdin.once("data", r))).toString());
    expect(sent.method).toBe("thread.start");
    stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { threadId: "th_1" } })}\n`,
    );
    await expect(p).resolves.toEqual({ threadId: "th_1" });
  });

  it("routes notifications to a handler and survives a malformed line", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const c = new AppServerClient({ stdin, stdout });
    const seen: unknown[] = [];
    c.on("item/started", (p) => seen.push(p));
    stdout.write("not json at all\n");
    stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "item/started", params: { item: { type: "agentMessage", id: "i1" } } })}\n`,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toHaveLength(1);
  });

  it("rejects a pending request when the server answers with an error", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const c = new AppServerClient({ stdin, stdout });
    const p = c.request("turn.start", {});
    const sent = JSON.parse((await new Promise<Buffer>((r) => stdin.once("data", r))).toString());
    stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: sent.id, error: { code: -32000, message: "nope" } })}\n`,
    );
    await expect(p).rejects.toMatchObject({ code: -32000 });
  });
});
