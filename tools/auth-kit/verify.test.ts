import { describe, expect, it } from "vitest";
import { type ChannelSpec, type KeychainStatus, formatReport, runVerify } from "./verify.js";

describe("runVerify", () => {
  it("marks api=skip when the keychain item is missing (never calls checkApi)", async () => {
    let called = false;
    const specs: ChannelSpec[] = [
      {
        channel: "slack",
        account: "T0FAKE",
        keychainServices: ["omnis.slack.xoxb.T0FAKE", "omnis.slack.xoxb.T0FAKE.app"],
        keychainAccount: "T0FAKE",
        checkApi: async () => {
          called = true;
          return { ok: true };
        },
      },
    ];
    const fakeKeychain = async (): Promise<KeychainStatus> => "missing";

    const rows = await runVerify(specs, fakeKeychain);

    expect(rows).toEqual([
      {
        channel: "slack",
        account: "T0FAKE",
        keychain: "missing",
        api: "skip",
        detail: "keychain item missing: omnis.slack.xoxb.T0FAKE",
      },
    ]);
    expect(called).toBe(false);
  });

  it("fails slack when only the app-level (.app) item is missing", async () => {
    let called = false;
    const specs: ChannelSpec[] = [
      {
        channel: "slack",
        account: "T0FAKE",
        keychainServices: ["omnis.slack.xoxb.T0FAKE", "omnis.slack.xoxb.T0FAKE.app"],
        keychainAccount: "T0FAKE",
        checkApi: async () => {
          called = true;
          return { ok: true };
        },
      },
    ];
    const fakeKeychain = async (service: string): Promise<KeychainStatus> =>
      service.endsWith(".app") ? "missing" : "ok";

    const rows = await runVerify(specs, fakeKeychain);

    expect(rows).toEqual([
      {
        channel: "slack",
        account: "T0FAKE",
        keychain: "missing",
        api: "skip",
        detail: "keychain item missing: omnis.slack.xoxb.T0FAKE.app",
      },
    ]);
    expect(called).toBe(false);
  });

  it("marks api=ok when the keychain item exists and checkApi succeeds", async () => {
    const specs: ChannelSpec[] = [
      {
        channel: "gmail",
        account: "logan@example.com",
        keychainServices: ["omnis.gmail.logan@example.com"],
        keychainAccount: "logan@example.com",
        checkApi: async () => ({ ok: true, detail: "logan@example.com" }),
      },
    ];
    const fakeKeychain = async (): Promise<KeychainStatus> => "ok";

    const rows = await runVerify(specs, fakeKeychain);

    expect(rows).toEqual([
      {
        channel: "gmail",
        account: "logan@example.com",
        keychain: "ok",
        api: "ok",
        detail: "logan@example.com",
      },
    ]);
  });

  it("marks api=fail and captures the error message when checkApi throws", async () => {
    const specs: ChannelSpec[] = [
      {
        channel: "gcal",
        account: "logan@example.com",
        keychainServices: ["omnis.gmail.logan@example.com"],
        keychainAccount: "logan@example.com",
        checkApi: async () => {
          throw new Error("invalid_grant");
        },
      },
    ];
    const fakeKeychain = async (): Promise<KeychainStatus> => "ok";

    const rows = await runVerify(specs, fakeKeychain);

    expect(rows).toEqual([
      {
        channel: "gcal",
        account: "logan@example.com",
        keychain: "ok",
        api: "fail",
        detail: "invalid_grant",
      },
    ]);
  });
});

describe("formatReport", () => {
  it("renders a header + one aligned row per channel, never the account's secret value", () => {
    const table = formatReport([
      { channel: "slack", account: "T0FAKE", keychain: "ok", api: "ok", detail: "team=Acme" },
      {
        channel: "gmail",
        account: "logan@example.com",
        keychain: "missing",
        api: "skip",
        detail: "keychain item missing",
      },
    ]);

    const lines = table.split("\n");
    expect(lines[0]).toMatch(/^channel\s+keychain\s+api\s+account\s+detail$/);
    expect(lines[1]).toContain("slack");
    expect(lines[1]).toContain("ok");
    expect(lines[2]).toContain("gmail");
    expect(lines[2]).toContain("missing");
    expect(lines[2]).toContain("logan@example.com");
    expect(table).not.toContain("xoxb-");
  });

  it("prints the detail column so api=fail shows the error (CHECKLIST 진단 경로)", () => {
    const table = formatReport([
      { channel: "slack", account: "T0FAKE", keychain: "ok", api: "fail", detail: "invalid_auth" },
    ]);

    expect(table.split("\n")[1]).toMatch(/^slack\s+ok\s+fail\s+T0FAKE\s+invalid_auth$/);
  });

  it("returns just the header line for an empty report", () => {
    expect(formatReport([])).toBe("channel  keychain  api  account  detail");
  });
});
