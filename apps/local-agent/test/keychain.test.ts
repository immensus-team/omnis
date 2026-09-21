import { describe, expect, it } from "vitest";
import { KEYCHAIN_ACCOUNT, readKeychainSecret } from "../src/keychain.js";

describe("readKeychainSecret (A6 §9)", () => {
  // The privacy fix this pins: `-a` is what used to carry a personal address, and passing it also
  // meant any item stored under a different account became unreadable.
  it("looks the item up by service name only — the exact argv carries no -a", async () => {
    const calls: string[][] = [];
    const exec = async (_cmd: string, args: string[]) => {
      calls.push(args);
      return { stdout: "token\n" };
    };

    await expect(readKeychainSecret("omnis.bridge.token.mini", exec)).resolves.toBe("token");
    expect(calls).toEqual([["find-generic-password", "-s", "omnis.bridge.token.mini", "-w"]]);
  });

  it("rejects an empty item instead of returning a blank secret", async () => {
    const exec = async () => ({ stdout: "  \n" });
    await expect(readKeychainSecret("omnis.bridge.token.mini", exec)).rejects.toThrow(/empty/);
  });

  it("stamps new items with the neutral account label", () => {
    expect(KEYCHAIN_ACCOUNT).toBe("omnis");
  });
});
