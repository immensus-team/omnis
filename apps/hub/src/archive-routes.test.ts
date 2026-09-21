import { describe, expect, it, vi } from "vitest";
import { handleDigestUndo, handleUnarchiveItem } from "./archive-routes.js";

describe("handleUnarchiveItem (POST /items/:id/unarchive)", () => {
  it("delegates to undoArchive with the item id and returns the restored status", async () => {
    const undoArchive = vi.fn().mockResolvedValue(1);
    const result = await handleUnarchiveItem({ undoArchive }, "item-1");
    expect(undoArchive).toHaveBeenCalledWith({ itemId: "item-1" }, "me");
    expect(result).toEqual({ id: "item-1", status: "received" });
  });
});

describe("handleDigestUndo (POST /digests/:id/undo)", () => {
  it("delegates to undoArchive with the undo token and returns the restored count", async () => {
    const undoArchive = vi.fn().mockResolvedValue(3);
    const result = await handleDigestUndo({ undoArchive }, "tok-abc");
    expect(undoArchive).toHaveBeenCalledWith({ undoToken: "tok-abc" }, "me");
    expect(result).toEqual({ restored: 3 });
  });

  it("reports 0 for a token nothing was archived under, rather than failing", async () => {
    // A digest older than the 7-day window (or one whose items a human already restored) matches no
    // row. The button's answer is "nothing was restored" — not an error the screen has to interpret.
    const undoArchive = vi.fn().mockResolvedValue(0);
    await expect(handleDigestUndo({ undoArchive }, "stale")).resolves.toEqual({ restored: 0 });
  });
});
