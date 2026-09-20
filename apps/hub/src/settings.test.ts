import { describe, expect, it } from "vitest";
import { isValidSettingKey } from "./settings.js";

describe("isValidSettingKey", () => {
  it("accepts every known SettingKey", () => {
    expect(isValidSettingKey("cost.cap_usd")).toBe(true);
    expect(isValidSettingKey("ingest.github_repos")).toBe(true);
    expect(isValidSettingKey("kakao.send_enabled_at")).toBe(true);
  });

  it("rejects an unknown key", () => {
    expect(isValidSettingKey("not.a.real.key")).toBe(false);
  });
});
