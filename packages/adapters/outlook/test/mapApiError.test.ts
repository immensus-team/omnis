import { describe, expect, it } from "vitest";
import { mapApiError } from "../src/index.js";

describe("Outlook mapApiError()", () => {
  it("maps 429 with Retry-After to retryable_rate_limit", () => {
    const err = mapApiError({ statusCode: 429, headers: { "retry-after": "30" } });
    expect(err.kind).toBe("retryable_rate_limit");
    expect(err.retryAfterMs).toBe(30_000);
  });
  it("maps 401 to auth_expired and 403 to auth_revoked", () => {
    expect(mapApiError({ statusCode: 401 }).kind).toBe("auth_expired");
    expect(mapApiError({ statusCode: 403 }).kind).toBe("auth_revoked");
  });
  it("falls back to retryable_network for unmapped statuses", () => {
    expect(mapApiError({ statusCode: 500 }).kind).toBe("retryable_network");
  });
});
