import { describe, expect, it } from "vitest";
import { handleNorm, initialsFor } from "../src/identity.js";

describe("handleNorm — gmail/outlook (A3 §10)", () => {
  it("lowercases, strips the +tag and removes dots in the gmail local part", () => {
    expect(handleNorm("gmail", "Jinho.Logan.Kim+omnis@Gmail.com")).toBe("jinhologankim@gmail.com");
  });

  it("keeps dots for outlook (only gmail collapses them)", () => {
    expect(handleNorm("outlook", "First.Last+tag@Contoso.com")).toBe("first.last@contoso.com");
  });

  it("trims surrounding whitespace and angle brackets", () => {
    expect(handleNorm("gmail", "  <A.B@gmail.com> ")).toBe("ab@gmail.com");
  });

  it("uses the gmail rule for gcal attendees", () => {
    expect(handleNorm("gcal", "A.B+cal@Gmail.com")).toBe("ab@gmail.com");
  });
});

describe("handleNorm — telegram/whatsapp E.164", () => {
  it("keeps an already-E.164 number", () => {
    expect(handleNorm("telegram", "+82 10-1234-5678")).toBe("+821012345678");
  });

  it("promotes a korean local number to +82", () => {
    expect(handleNorm("whatsapp", "010-1234-5678")).toBe("+821012345678");
  });

  it("adds the plus to a bare country-coded number", () => {
    expect(handleNorm("telegram", "821012345678")).toBe("+821012345678");
  });
});

describe("handleNorm — slack/linkedin", () => {
  it("keeps team:user and never uses the display name", () => {
    expect(handleNorm("slack", "T01ABC:U09XYZ")).toBe("T01ABC:U09XYZ");
  });

  it("rejects a slack handle that is not team:user", () => {
    expect(() => handleNorm("slack", "U09XYZ")).toThrow(/team_id:user_id/);
  });

  it("keeps only the /in/<slug> part of a linkedin url", () => {
    expect(handleNorm("linkedin", "https://www.linkedin.com/in/Logan-Kim-123/?trk=x")).toBe(
      "logan-kim-123",
    );
  });
});

describe("handleNorm — kakaotalk (A3 §10, unstable key)", () => {
  it("is kt: + 32 hex chars, scoped to the room", () => {
    const a = handleNorm("kakaotalk", " jinho.kim ", "room-1");
    expect(a).toMatch(/^kt:[0-9a-f]{32}$/);
    expect(handleNorm("kakaotalk", "jinho.kim", "room-1")).toBe(a); // deterministic
    expect(handleNorm("kakaotalk", "jinho.kim", "room-2")).not.toBe(a); // other room, other key
    expect(handleNorm("kakaotalk", "chulsoo.kim", "room-1")).not.toBe(a);
  });

  it("requires a room — a kakaotalk handle without one is not a key", () => {
    expect(() => handleNorm("kakaotalk", "jinho.kim")).toThrow(/room_external_id/);
  });
});

describe("handleNorm — fallback", () => {
  it("lowercases and trims for channels with no rule", () => {
    expect(handleNorm("system", "  Omnis  ")).toBe("omnis");
  });
});

describe("initialsFor (B-D3)", () => {
  it("takes the given name for korean and the initials for latin", () => {
    // Hangul name: initialsFor detects the Hangul range and takes the given name (characters 1-3).
    expect(initialsFor("김진호")).toBe("진호");
    expect(initialsFor("Logan Kim")).toBe("LK");
    expect(initialsFor("Logan")).toBe("LO");
    expect(initialsFor("  ")).toBe("?");
  });
});
