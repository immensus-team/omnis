// @vitest-environment jsdom
import "./setup";

import { afterEach, describe, expect, it } from "vitest";
import {
  RAIL_ORDER_STORAGE_KEY,
  applyOrder,
  moveTile,
  readRailOrder,
  writeRailOrder,
} from "../src/lib/rail-order";
import type { UiChannel } from "../src/types.js";

afterEach(() => {
  localStorage.clear();
});

describe("applyOrder (D7 §c.2)", () => {
  const TILES: UiChannel[] = ["gmail", "slack", "linkedin"];

  it("keeps the stored order", () => {
    expect(applyOrder(TILES, ["slack", "linkedin", "gmail"])).toEqual([
      "slack",
      "linkedin",
      "gmail",
    ]);
  });

  it("drops a stored id that is no longer connected", () => {
    // The account was disconnected: the store still names it, the hub does not report it.
    expect(applyOrder(TILES, ["slack", "telegram", "gmail"])).toEqual([
      "slack",
      "gmail",
      "linkedin",
    ]);
  });

  it("appends a channel the store has never seen", () => {
    // A newly connected account. Appended after the stored ones rather than dropped or leading.
    expect(applyOrder(TILES, ["linkedin", "gmail"])).toEqual(["linkedin", "gmail", "slack"]);
  });

  it("returns the tiles untouched when nothing is stored", () => {
    expect(applyOrder(TILES, [])).toEqual(TILES);
  });

  it("keeps a duplicated stored id once", () => {
    expect(applyOrder(TILES, ["slack", "slack", "gmail"])).toEqual(["slack", "gmail", "linkedin"]);
  });

  it("is total — every stored list produces a permutation of the tiles", () => {
    const tiles: UiChannel[] = ["gmail", "agent"];
    for (const stored of [[], ["agent"], ["system", "whatsapp"], ["agent", "gmail"]]) {
      const out = applyOrder(tiles, stored as UiChannel[]);
      expect([...out].sort()).toEqual([...tiles].sort());
    }
  });
});

describe("moveTile (D7 §c.2 keyboard reorder)", () => {
  const ORDER: UiChannel[] = ["gmail", "slack", "linkedin"];

  it("moves a tile one slot and leaves the rest in order", () => {
    expect(moveTile(ORDER, "slack", 1)).toEqual(["gmail", "linkedin", "slack"]);
    expect(moveTile(ORDER, "linkedin", -1)).toEqual(["gmail", "linkedin", "slack"]);
  });

  it("is a no-op at either end rather than wrapping around", () => {
    expect(moveTile(ORDER, "gmail", -1)).toEqual(ORDER);
    expect(moveTile(ORDER, "linkedin", 1)).toEqual(ORDER);
  });

  it("does not mutate the input", () => {
    const before = [...ORDER];
    moveTile(ORDER, "gmail", 1);
    expect(ORDER).toEqual(before);
  });
});

describe("rail order storage (D7 §c.2)", () => {
  it("round-trips an order through the one key", () => {
    writeRailOrder(["slack", "gmail"]);
    expect(JSON.parse(localStorage.getItem(RAIL_ORDER_STORAGE_KEY) ?? "null")).toEqual([
      "slack",
      "gmail",
    ]);
    expect(readRailOrder()).toEqual(["slack", "gmail"]);
  });

  it("reads no store as no order", () => {
    expect(readRailOrder()).toEqual([]);
  });

  it("survives a store that is not a list of channels", () => {
    // Hand-edited, or written by an older build. Every one of these has to render the rail rather
    // than throw on the way in.
    for (const raw of ["not json", "{}", '{"a":1}', "42", '["gmail","nope"]']) {
      localStorage.setItem(RAIL_ORDER_STORAGE_KEY, raw);
      expect(readRailOrder()).toEqual(raw === '["gmail","nope"]' ? ["gmail"] : []);
    }
  });
});
