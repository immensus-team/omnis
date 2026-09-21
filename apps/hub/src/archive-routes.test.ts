import { describe, expect, it, vi } from "vitest";
import { handleDigestUndo, handleDiscardDraft, handleUnarchiveItem } from "./archive-routes.js";

describe("handleUnarchiveItem (POST /items/:id/unarchive)", () => {
  it("delegates to undoArchive with the item id and returns the restored status", async () => {
    const undoArchive = vi.fn().mockResolvedValue(1);
    const result = await handleUnarchiveItem({ undoArchive }, "item-1");
    expect(undoArchive).toHaveBeenCalledWith({ itemId: "item-1" }, "me");
    expect(result).toEqual({ id: "item-1", status: "received" });
  });
});

/** loop-r2-02: POST /items/:id/discard. The route in http.ts turns a `null` here into the 404 and
 *  the row into the 200, so both branches are asserted on the value this handler hands it — the same
 *  shape as the unarchive test above, and the reason the "non-draft" case is a 404 rather than a
 *  silent success. */
describe("handleDiscardDraft (POST /items/:id/discard)", () => {
  it("archives the draft and answers with the item's new status", async () => {
    const discardDraft = vi.fn().mockResolvedValue(true);
    await expect(handleDiscardDraft({ discardDraft }, "item-1")).resolves.toEqual({
      id: "item-1",
      status: "archived",
    });
    expect(discardDraft).toHaveBeenCalledWith("item-1");
  });

  it("answers nothing for a non-draft, which the route reads as 404", async () => {
    // The item exists but has already reached the channel (or was never a draft). Discarding it is
    // not a no-op the screen should read as success, so the handler reports "no row moved".
    const discardDraft = vi.fn().mockResolvedValue(false);
    await expect(handleDiscardDraft({ discardDraft }, "item-2")).resolves.toBeNull();
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
