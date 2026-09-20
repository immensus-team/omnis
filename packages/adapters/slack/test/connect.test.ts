import { AdapterError } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { createSlackAdapter } from "../src/index.js";

describe("Slack adapter connect()", () => {
  it("throws AdapterError(auth_expired) when the Keychain item is missing", async () => {
    const adapter = createSlackAdapter();
    await expect(
      adapter.connect({
        channel: "slack",
        accountExternalId: "T000UNKNOWN",
        keychainService: "omnis.slack.xoxb.T000UNKNOWN",
        keychainAccount: "T000UNKNOWN",
      }),
    ).rejects.toThrow(AdapterError);
  });
});
