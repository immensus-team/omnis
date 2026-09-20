import { afterEach, describe, expect, it, vi } from "vitest";
import { decideApproval } from "../src/api/approvals.js";

describe("decideApproval (계약 §5 POST /approvals/:id/decide)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs { decision, decided_args } and returns the decided state", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "ap-1", state: "decided" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await decideApproval("ap-1", "accept");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/approvals/ap-1/decide",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "accept", decided_args: undefined }),
      }),
    );
    expect(result).toEqual({ id: "ap-1", state: "decided" });
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 409 })),
    );
    await expect(decideApproval("ap-1", "ignore")).rejects.toThrow(/409/);
  });
});
