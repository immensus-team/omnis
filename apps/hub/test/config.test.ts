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
