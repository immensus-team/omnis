import { describe, expect, it, vi } from "vitest";
import { createOutlookAdapter, refreshAccessToken } from "../src/index.js";

describe("refreshAccessToken()", () => {
  it("POSTs the /common token endpoint with the refresh_token grant", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 }),
    );
    const result = await refreshAccessToken(
      "client-1",
      "refresh-tok",
      fetchFn as unknown as typeof fetch,
    );
    expect(result).toEqual({ accessToken: "tok-1", expiresIn: 3600 });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(String(init.body)).toContain("grant_type=refresh_token");
  });
  it("throws auth_revoked when the token endpoint rejects", async () => {
    const fetchFn = vi.fn(async () => new Response("bad", { status: 401 }));
    await expect(
      refreshAccessToken("client-1", "bad-tok", fetchFn as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: "auth_revoked" });
  });
});

describe("Outlook adapter connect()/health()", () => {
  it("reads the refresh token from Keychain, refreshes, and reports healthy", async () => {
    vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "refresh-tok") }));
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 }),
    );
    const adapter = createOutlookAdapter({
      oauthClientId: "client-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await adapter.connect({
      channel: "outlook",
      accountExternalId: "logan@outlook.com",
      keychainService: "omnis.outlook.logan@outlook.com",
      keychainAccount: "logan@outlook.com",
    });
    expect((await adapter.health()).status).toBe("healthy");
  });
});
