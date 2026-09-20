import { afterAll, describe, expect, it } from "vitest";
import { initZero } from "../src/zero-client";

describe("US-A22 Zero read-only round trip", () => {
  const zero = initZero({ userID: "logan-test" });

  it("resolves a query against threads without throwing (A3 §7 복제 대상)", async () => {
    const rows = await zero.query.threads.limit(1).run();
    expect(Array.isArray(rows)).toBe(true);
  }, 10_000);

  afterAll(async () => {
    await zero.close();
  });
});
