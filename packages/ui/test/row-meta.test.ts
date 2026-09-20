import { describe, expect, it } from "vitest";
import {
  CHANNEL_BRAND_ASSET,
  RUNTIME_ICON,
  RUNTIME_LETTER,
  agentSessionKinsoState,
  initialsFromName,
  pastelFromName,
} from "../src/lib/row-meta";
import type { UiChannel } from "../src/types";

describe("initialsFromName (U2 avatar fallback)", () => {
  it("takes the first letter of each word in a two-word name", () => {
    expect(initialsFromName("Sora Kim")).toBe("SK");
  });
  it("takes the first two letters of a one-word name", () => {
    expect(initialsFromName("Codex")).toBe("CO");
  });
  it("falls back to a question mark for an empty string", () => {
    expect(initialsFromName("")).toBe("?");
  });
  it("uses only the first and last word when there are several", () => {
    expect(initialsFromName("David Yun Park")).toBe("DP");
  });
});

describe("pastelFromName (U2 avatar background colour)", () => {
  it("gives the same name the same colour every time", () => {
    expect(pastelFromName("Sora Kim")).toBe(pastelFromName("Sora Kim"));
  });
  it("generally gives different names different colours", () => {
    expect(pastelFromName("Sora Kim")).not.toBe(pastelFromName("David Park"));
  });
  it("returns an oklch pastel (high lightness) string", () => {
    expect(pastelFromName("Sora Kim")).toMatch(/^oklch\(0\.88 0\.06 \d+\)$/);
  });
});

describe("agentSessionKinsoState (A3 agent_sessions.state -> herdr four states)", () => {
  it.each([
    ["starting", "working"],
    ["running", "working"],
    ["idle", "idle"],
    ["waiting_approval", "blocked"],
    ["ended", "done"],
    ["failed", "blocked"],
  ] as const)("%s → %s", (dbState, expected) => {
    expect(agentSessionKinsoState(dbState)).toBe(expected);
  });
  it("falls back to idle for an unknown value", () => {
    expect(agentSessionKinsoState("unknown-future-state")).toBe("idle");
  });
});

describe("CHANNEL_BRAND_ASSET (US-D02b: official brand PNGs replace tinted react-icons)", () => {
  it("gives every UiChannel both a 1x and a 2x asset", () => {
    for (const channel of Object.keys(CHANNEL_BRAND_ASSET) as UiChannel[]) {
      expect(CHANNEL_BRAND_ASSET[channel].at1x).toMatch(/\.png$/);
      expect(CHANNEL_BRAND_ASSET[channel].at2x).toMatch(/\.png$/);
    }
  });

  it("resolves the two assets of a channel to different files", () => {
    for (const channel of Object.keys(CHANNEL_BRAND_ASSET) as UiChannel[]) {
      expect(CHANNEL_BRAND_ASSET[channel].at1x).not.toBe(CHANNEL_BRAND_ASSET[channel].at2x);
    }
  });

  // The record is typed Record<UiChannel, …> so tsc already proves exhaustiveness — this guards the
  // runtime map against a channel being dropped from it while the type still claims otherwise.
  it("covers all ten channels", () => {
    expect(Object.keys(CHANNEL_BRAND_ASSET)).toHaveLength(10);
    expect(Object.keys(CHANNEL_BRAND_ASSET).sort()).toEqual(
      [
        "agent",
        "gcal",
        "gmail",
        "kakaotalk",
        "linkedin",
        "outlook",
        "slack",
        "system",
        "telegram",
        "whatsapp",
      ].sort(),
    );
  });
});

describe("RUNTIME_ICON / RUNTIME_LETTER (U5: an agent session's avatar is its runtime logo)", () => {
  it("uses the Anthropic mark (react-icons/si) for Claude Code", () => {
    expect(RUNTIME_ICON.claude_code).toBeDefined();
  });
  it("uses the brand mark for DeepSeek", () => {
    expect(RUNTIME_ICON.claude_ds).toBeDefined();
  });
  it("falls back to the letter 'H' for Hermes, which has no brand mark", () => {
    expect(RUNTIME_ICON.hermes).toBeUndefined();
    expect(RUNTIME_LETTER.hermes).toBe("H");
  });

  // simple-icons' SiHermes is the Hermès (fashion house) mark, not this runtime's — attaching it
  // would be the "any icon in a brand slot" slop the letter fallback above exists to avoid.
  it("Codex uses the OpenAI mark instead of the old generic lucide Bot", () => {
    expect(RUNTIME_ICON.codex).toBeDefined();
  });
});
