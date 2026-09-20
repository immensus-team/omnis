import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("readConfig", () => {
  it("binds the loopback address and port 8787 by default (마스터 §4.2)", () => {
    const c = readConfig({ DATABASE_URL: "postgres://x/y" });
    expect(c.host).toBe("127.0.0.1");
    expect(c.port).toBe(8787);
    expect(c.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("honours OMNIS_HUB_PORT", () => {
    expect(readConfig({ DATABASE_URL: "postgres://x/y", OMNIS_HUB_PORT: "9999" }).port).toBe(9999);
  });

  it("refuses 8642, which Hermes api_server owns", () => {
    expect(() => readConfig({ DATABASE_URL: "postgres://x/y", OMNIS_HUB_PORT: "8642" })).toThrow(
      /8642 belongs to Hermes/,
    );
  });

  it("refuses a non-numeric port and a missing DATABASE_URL", () => {
    expect(() => readConfig({ DATABASE_URL: "postgres://x/y", OMNIS_HUB_PORT: "abc" })).toThrow(
      /OMNIS_HUB_PORT/,
    );
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
  });
});

describe("zero auth config (US-A21b)", () => {
  it("defaults the user id to logan and leaves the secret empty", () => {
    const c = readConfig({ DATABASE_URL: "postgres://x/y" });
    expect(c.userId).toBe("logan");
    expect(c.zeroAuthSecret).toBe("");
  });

  it("reads OMNIS_USER_ID and ZERO_AUTH_SECRET", () => {
    const c = readConfig({
      DATABASE_URL: "postgres://x/y",
      OMNIS_USER_ID: "someone",
      ZERO_AUTH_SECRET: "s3cret",
    });
    expect(c.userId).toBe("someone");
    expect(c.zeroAuthSecret).toBe("s3cret");
  });
});

describe("adapter registry config (US-B45)", () => {
  it("leaves the app-level OAuth clients empty and defaults ntfy to the A6 §8 local port", () => {
    const c = readConfig({ DATABASE_URL: "postgres://x/y" });
    expect(c.googleOAuthClientId).toBe("");
    expect(c.googleOAuthClientSecret).toBe("");
    expect(c.outlookClientId).toBe("");
    expect(c.ntfyUrl).toBe("http://127.0.0.1:2586");
  });

  it("reads the OAuth clients and OMNIS_NTFY_URL from the environment", () => {
    const c = readConfig({
      DATABASE_URL: "postgres://x/y",
      OMNIS_GOOGLE_OAUTH_CLIENT_ID: "gid",
      OMNIS_GOOGLE_OAUTH_CLIENT_SECRET: "gsecret",
      OMNIS_OUTLOOK_CLIENT_ID: "oid",
      OMNIS_NTFY_URL: "http://ntfy.test",
    });
    expect(c.googleOAuthClientId).toBe("gid");
    expect(c.googleOAuthClientSecret).toBe("gsecret");
    expect(c.outlookClientId).toBe("oid");
    expect(c.ntfyUrl).toBe("http://ntfy.test");
  });
});
