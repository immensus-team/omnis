// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so this file declares its own
// environment and setup (the same situation as notes-screen.test.tsx and today-screen.test.tsx).
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DIGEST_BANNER,
  DIGEST_WAITING_COPY,
  archivedCount,
  digestDayLabel,
  digestGroups,
  digestHeading,
  digestState,
  monthlyCostLine,
  restoreStatusLine,
} from "../src/screens/Digest.js";

// ─── the pure functions ─────────────────────────────────────────────────────────────────────────

/** What `nightlyDigestLoop.apply` writes into `digests.body` (packages/agents/src/loops/
 *  digest-nightly.ts, A4 §6.4) — read here exactly as that writer shapes it. */
const BODY = JSON.stringify({
  headline: "Nothing urgent slipped through",
  auto_archived: [
    {
      reason: "newsletter",
      count: 12,
      samples: [
        {
          ref: { kind: "item", id: "i1" },
          line: "The Weekly Standup, issue 91",
          why: "newsletter",
        },
        {
          ref: { kind: "item", id: "i2" },
          line: "Product digest for September",
          why: "newsletter",
        },
        {
          ref: { kind: "item", id: "i3" },
          line: "Changelog: September's releases",
          why: "newsletter",
        },
      ],
      undo_token: "tok-news",
    },
    {
      reason: "receipt",
      count: 4,
      samples: [
        { ref: { kind: "item", id: "i9" }, line: "Your receipt from Northwind", why: "receipt" },
      ],
      undo_token: "tok-receipt",
    },
  ],
  handled: { count: 7, by_channel: { slack: 4, gmail: 3 } },
  still_open: [],
  cost: { month_to_date_usd: 34, cap_usd: 60, tier_state: "normal" },
  agents: { runs: 41, failed: 1, delegated: 3 },
});

describe("digestGroups (NightlyDigest.auto_archived, read defensively off digests.body)", () => {
  it("returns the groups array when shaped correctly", () => {
    expect(digestGroups(BODY).map((g) => g.reason)).toEqual(["newsletter", "receipt"]);
    expect(digestGroups(BODY)[0]?.undo_token).toBe("tok-news");
  });

  it("returns an empty array for missing or malformed body (no crash on a bad row)", () => {
    // A4 §6.4's inner shape is not a column type — `digests.body` is text the loop writes. Every one
    // of these has to converge on "no groups to draw" rather than throw inside a render.
    expect(digestGroups("not json")).toEqual([]);
    expect(digestGroups("null")).toEqual([]);
    expect(digestGroups("{}")).toEqual([]);
    expect(digestGroups(JSON.stringify({ auto_archived: "not-an-array" }))).toEqual([]);
  });

  it("drops a group that could not be restored or counted", () => {
    const mixed = JSON.stringify({
      auto_archived: [
        { reason: "newsletter", count: 2, samples: [], undo_token: "t1" },
        { reason: "receipt", count: "4", samples: [], undo_token: "t2" },
        { reason: "other", count: 1, samples: [], undo_token: "" },
        null,
      ],
    });
    expect(digestGroups(mixed).map((g) => g.undo_token)).toEqual(["t1"]);
  });
});

describe("archivedCount (metrics.archived is what the loop counted; the groups are the fallback)", () => {
  it("prefers the number the digest itself wrote", () => {
    expect(archivedCount({ archived: 16 }, digestGroups(BODY))).toBe(16);
  });

  it("falls back to the group counts when metrics is missing or malformed", () => {
    expect(archivedCount(null, digestGroups(BODY))).toBe(16);
    expect(archivedCount({ archived: "16" }, digestGroups(BODY))).toBe(16);
  });
});

describe("digestHeading (A5 §3.8's 'September 19 night digest · 42 archived')", () => {
  it("names the KST day the digest is filed under and how much it archived", () => {
    // 2026-09-20T15:00Z is the start of 2026-09-21 in KST, which is the day the digest names. The
    // separator is a comma rather than A5's middle dot: SKILLS.md's checklist item 5 rules out
    // middle-dot metadata, and a title and a count strung together is exactly that.
    expect(digestHeading(new Date("2026-09-20T15:00:00Z").getTime(), 42)).toBe(
      "September 21 night digest, 42 archived",
    );
  });

  it("says a quiet night out loud instead of '0 archived'", () => {
    expect(digestHeading(new Date("2026-09-20T15:00:00Z").getTime(), 0)).toBe(
      "September 21 night digest, nothing archived",
    );
  });
});

describe("digestDayLabel", () => {
  it("reads the KST calendar day, whatever the browser's zone is", () => {
    // The digest is filed under a KST date (`for_date`), so the label has to be that day: a UTC
    // encoding of 2026-09-21 and a KST-midnight one both name September 21.
    expect(digestDayLabel(new Date("2026-09-21T00:00:00Z").getTime())).toBe("September 21");
    expect(digestDayLabel(new Date("2026-09-20T15:00:00Z").getTime())).toBe("September 21");
  });
});

describe("monthlyCostLine (A5 §3.8: 'monthly cost report: $34 / $60 (57%)')", () => {
  it("formats month-to-date over cap with a rounded percentage", () => {
    expect(monthlyCostLine({ month_to_date_usd: 34, cap_usd: 60 })).toBe(
      "Monthly cost report: $34 / $60 (57%)",
    );
  });

  it("drops the percentage rather than dividing by a zero cap", () => {
    expect(monthlyCostLine({ month_to_date_usd: 0, cap_usd: 0 })).toBe(
      "Monthly cost report: $0 / $0",
    );
  });
});

describe("restoreStatusLine (A5 §3.8: the restore is announced, role=status)", () => {
  it("counts what came back, in the singular and the plural, and says when nothing did", () => {
    expect(restoreStatusLine(12)).toBe("Restored 12 archived items.");
    expect(restoreStatusLine(1)).toBe("Restored 1 archived item.");
    expect(restoreStatusLine(0)).toBe("Nothing left to restore — those items are already back.");
  });
});

describe("digestState (the query's own state, the same shape Today uses)", () => {
  it("reports an error over a load in flight, and ready only when the query completed", () => {
    expect(digestState(["unknown", "error"])).toBe("error");
    expect(digestState(["complete", "unknown"])).toBe("loading");
    expect(digestState(["complete"])).toBe("ready");
    expect(DIGEST_BANNER.ready).toBe("");
  });
});

// ─── the screen itself ──────────────────────────────────────────────────────────────────────────

function chain(table: string) {
  const node: Record<string, unknown> = { __table: table };
  for (const m of ["where", "orderBy", "limit", "related"]) node[m] = () => node;
  return node;
}

const TABLES: Record<string, unknown> = { digests: chain("digests"), items: chain("items") };
const ROWS: Record<string, readonly unknown[]> = { digests: [], items: [] };

vi.mock("../src/zero-client.js", () => ({
  initZero: () => ({ query: TABLES }),
  useZeroClient: () => ({ query: TABLES, online: true, onOnline: () => () => {} }),
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: { __table?: string }) => [ROWS[q.__table ?? ""] ?? [], { type: "complete" }],
  useZero: () => ({ query: TABLES }),
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("../src/api/digest.js", () => ({
  unarchiveItem: vi.fn(async (id: string) => ({ id, status: "received" })),
  undoDigestGroup: vi.fn(async () => ({ restored: 12 })),
}));

const api = await import("../src/api/digest.js");
const { Digest } = await import("../src/screens/Digest.js");

/** The row the nightly loop writes: `body` is the NightlyDigest above, `metrics` is the flat
 *  summary it stores beside it (archived + cost_mtd_usd). */
const DIGEST_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "nightly",
  for_date: new Date("2026-09-20T15:00:00Z").getTime(),
  body: BODY,
  item_ids: ["i1", "i2", "i3", "i9"],
  metrics: { archived: 16, cost_mtd_usd: 34 },
  created_at: new Date("2026-09-20T15:00:00Z").getTime(),
};

beforeEach(() => {
  ROWS.digests = [DIGEST_ROW];
  vi.mocked(api.unarchiveItem).mockClear();
  vi.mocked(api.undoDigestGroup).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function groups(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".digest-screen__group")];
}

/** Buttons are found by their accessible name, never by class: a list of three buttons that all
 *  announce as "Restore" is the defect the per-item aria-label exists to avoid. */
const RESTORE_ONE = /^Restore /;

describe("Digest screen (A5 §3.8)", () => {
  it("names the night, its total, and every category with its count", () => {
    render(<Digest />);
    expect(
      screen.getByRole("heading", { name: "September 21 night digest, 16 archived" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /newsletter/ })).toBeInTheDocument();
    expect(within(groups()[0] as HTMLElement).getByText("12")).toBeInTheDocument();
    expect(within(groups()[1] as HTMLElement).getByText("4")).toBeInTheDocument();
  });

  it("collapses each category until it is opened, with aria-expanded saying which", () => {
    render(<Digest />);
    const toggle = screen.getByRole("button", { name: /newsletter/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelectorAll(".digest-screen__sample")).toHaveLength(0);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelectorAll(".digest-screen__sample")).toHaveLength(3);
    expect(screen.getByText("The Weekly Standup, issue 91")).toBeInTheDocument();
  });

  it("says how many items the digest did not list, rather than showing three of twelve", () => {
    render(<Digest />);
    fireEvent.click(screen.getByRole("button", { name: /newsletter/ }));
    // §9.4: the count is the total, only `samples` is cut to three.
    expect(screen.getByText("and 9 more (the digest lists the newest three)")).toBeInTheDocument();
  });

  it("restores one item, and stops offering the button for it", async () => {
    render(<Digest />);
    fireEvent.click(screen.getByRole("button", { name: /newsletter/ }));
    const first = document.querySelector<HTMLElement>(".digest-screen__sample") as HTMLElement;
    fireEvent.click(within(first).getByRole("button", { name: RESTORE_ONE }));

    await vi.waitFor(() => {
      expect(vi.mocked(api.unarchiveItem)).toHaveBeenCalledWith("i1");
    });
    await vi.waitFor(() => {
      expect(first).toHaveAttribute("data-restored", "true");
    });
    expect(within(first).queryByRole("button", { name: RESTORE_ONE })).toBeNull();
  });

  it("keeps the item restorable when the write failed, and says so", async () => {
    vi.mocked(api.unarchiveItem).mockRejectedValueOnce(new Error("HTTP 404"));
    render(<Digest />);
    fireEvent.click(screen.getByRole("button", { name: /newsletter/ }));
    const first = document.querySelector<HTMLElement>(".digest-screen__sample") as HTMLElement;
    fireEvent.click(within(first).getByRole("button", { name: RESTORE_ONE }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't restore that item");
    });
    expect(first).not.toHaveAttribute("data-restored");
    expect(within(first).getByRole("button", { name: RESTORE_ONE })).toBeInTheDocument();
  });

  it("restores a whole category with the digest's undo token, and announces how many came back", async () => {
    render(<Digest />);
    const group = groups()[0] as HTMLElement;
    fireEvent.click(within(group).getByRole("button", { name: "Restore all" }));

    await vi.waitFor(() => {
      expect(vi.mocked(api.undoDigestGroup)).toHaveBeenCalledWith(DIGEST_ROW.id, "tok-news");
    });
    await vi.waitFor(() => {
      expect(group).toHaveAttribute("data-restored", "true");
    });
    // A5 §3.8: the restore is announced as a status, not as an alert — it is not a failure.
    expect(screen.getByRole("status")).toHaveTextContent("Restored 12 archived items.");
    expect(within(group).queryByRole("button", { name: "Restore all" })).toBeNull();
  });

  it("reads 0 restored as 'already back' rather than as a failure", async () => {
    vi.mocked(api.undoDigestGroup).mockResolvedValueOnce({ restored: 0 });
    render(<Digest />);
    fireEvent.click(
      within(groups()[0] as HTMLElement).getByRole("button", { name: "Restore all" }),
    );
    await vi.waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Nothing left to restore");
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves the group restorable when the category restore failed", async () => {
    vi.mocked(api.undoDigestGroup).mockRejectedValueOnce(new Error("HTTP 500"));
    render(<Digest />);
    const group = groups()[0] as HTMLElement;
    fireEvent.click(within(group).getByRole("button", { name: "Restore all" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't restore that group");
    });
    expect(group).not.toHaveAttribute("data-restored");
  });

  it("shows the monthly cost report the digest recorded", () => {
    render(<Digest />);
    expect(screen.getByText("Monthly cost report: $34 / $60 (57%)")).toBeInTheDocument();
  });

  it("says a night with nothing archived archived nothing", () => {
    ROWS.digests = [
      {
        ...DIGEST_ROW,
        body: JSON.stringify({ headline: "Quiet night", auto_archived: [], cost: null }),
        metrics: { archived: 0 },
      },
    ];
    render(<Digest />);
    expect(screen.getByText("Nothing was auto-archived today.")).toBeInTheDocument();
    // No cost on the row means no cost line: A5 §3.8's report is what the digest recorded, and
    // inventing a cap here would be the screen answering a question it was not given.
    expect(screen.queryByText(/Monthly cost report/)).toBeNull();
  });

  it("opens on the waiting copy when tonight's digest has not run yet", () => {
    ROWS.digests = [];
    render(<Digest />);
    expect(screen.getByText(DIGEST_WAITING_COPY)).toBeInTheDocument();
  });
});
