// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so this file declares its own
// environment and setup (the same situation as digest-screen.test.tsx and notes-screen.test.tsx).
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COST_STATE_LABEL,
  SETTINGS_BANNER,
  SETTINGS_TABS,
  SETTINGS_TAB_LABEL,
  accountStatusLabel,
  allowlistAdd,
  allowlistOf,
  allowlistRemove,
  autonomyAllows,
  autonomyRulesOf,
  autonomySet,
  costBarSegments,
  costBarState,
  parseCostCap,
  quietHoursOf,
  settingsState,
} from "../src/screens/Settings.js";

// ─── the pure functions ─────────────────────────────────────────────────────────────────────────

describe("costBarSegments (A5 §3.9: the last 10% is the reserve segment)", () => {
  it("computes the spend percentage and a fixed 90% reserve boundary", () => {
    const seg = costBarSegments({ mtdUsd: 34, capUsd: 60, reserveRatio: 0.1 });
    expect(seg.spendPct).toBeCloseTo(56.666, 2);
    expect(seg.reserveStartPct).toBe(90);
  });

  it("clamps the filled width so a month over the cap cannot paint past the track", () => {
    expect(costBarSegments({ mtdUsd: 90, capUsd: 60, reserveRatio: 0.1 }).spendPct).toBe(100);
  });

  it("draws an empty bar rather than dividing by a zero cap", () => {
    expect(costBarSegments({ mtdUsd: 10, capUsd: 0, reserveRatio: 0.1 }).spendPct).toBe(0);
  });
});

describe("costBarState (80%/100% thresholds — the component owns color, this owns only the state name)", () => {
  it("normal below 80%", () => expect(costBarState(30, 60)).toBe("normal"));
  it("warn between 80% and 100%", () => expect(costBarState(49, 60)).toBe("warn"));
  it("danger at or over 100%", () => expect(costBarState(60, 60)).toBe("danger"));
});

describe("COST_STATE_LABEL (A5 §9: the threshold is never carried by colour alone)", () => {
  it("names all three states in words", () => {
    expect(COST_STATE_LABEL.normal).toBe("Normal");
    expect(COST_STATE_LABEL.warn).toBe("T2→T1 downgrade");
    expect(COST_STATE_LABEL.danger).toBe("Non-VIP drafts paused");
  });
});

describe("parseCostCap (the cap input writes a number, never a NaN)", () => {
  it("reads a positive amount and refuses what is not one", () => {
    expect(parseCostCap("75")).toBe(75);
    expect(parseCostCap(" 12.5 ")).toBe(12.5);
    expect(parseCostCap("")).toBeNull();
    expect(parseCostCap("0")).toBeNull();
    expect(parseCostCap("-4")).toBeNull();
    expect(parseCostCap("sixty")).toBeNull();
  });
});

describe("allowlistOf / allowlistAdd / allowlistRemove (the three ingest allowlist kinds)", () => {
  it("reads a stored list and drops anything that is not a string", () => {
    expect(allowlistOf(["~/Work", "~/Notes"])).toEqual(["~/Work", "~/Notes"]);
    expect(allowlistOf(null)).toEqual([]);
    expect(allowlistOf("~/Work")).toEqual([]);
    expect(allowlistOf(["~/Work", 7, "", null])).toEqual(["~/Work"]);
  });

  it("trims an entry, ignores a blank one and refuses a duplicate", () => {
    expect(allowlistAdd([], "  ~/Work  ")).toEqual(["~/Work"]);
    expect(allowlistAdd(["~/Work"], "   ")).toEqual(["~/Work"]);
    expect(allowlistAdd(["~/Work"], "~/Work")).toEqual(["~/Work"]);
  });

  it("removes one entry and leaves the rest in place", () => {
    expect(allowlistRemove(["~/A", "~/B"], "~/A")).toEqual(["~/B"]);
    expect(allowlistRemove(["~/A"], "~/Z")).toEqual(["~/A"]);
  });
});

describe("quietHoursOf (notify.quiet_hours is json, not a column type)", () => {
  it("reads a stored window", () => {
    expect(quietHoursOf({ start: "22:30", end: "06:15", vipOverride: false })).toEqual({
      start: "22:30",
      end: "06:15",
      vipOverride: false,
    });
  });

  it("falls back to A4 §3.6's window for a row of another shape", () => {
    expect(quietHoursOf(null)).toEqual({ start: "23:00", end: "07:00", vipOverride: true });
    expect(quietHoursOf({ start: 23 })).toEqual({
      start: "23:00",
      end: "07:00",
      vipOverride: true,
    });
  });
});

describe("autonomy.rules (A5 §3.9: every target is off by default)", () => {
  it("reads the stored rules and ignores what is not one", () => {
    expect(autonomyRulesOf([{ kind: "channel", ref: "slack" }])).toEqual([
      { kind: "channel", ref: "slack" },
    ]);
    expect(autonomyRulesOf([])).toEqual([]);
    expect(autonomyRulesOf(null)).toEqual([]);
    expect(autonomyRulesOf([{ kind: "channel" }, "slack", { kind: "person", ref: "" }])).toEqual(
      [],
    );
  });

  it("defaults every channel to off and turns exactly one on", () => {
    expect(autonomyAllows([], "slack")).toBe(false);
    const rules = autonomySet([], "slack", true);
    expect(autonomyAllows(rules, "slack")).toBe(true);
    expect(autonomyAllows(rules, "gmail")).toBe(false);
    expect(autonomyAllows(autonomySet(rules, "slack", false), "slack")).toBe(false);
  });

  it("is idempotent — turning the same channel on twice does not duplicate the rule", () => {
    expect(autonomySet(autonomySet([], "slack", true), "slack", true)).toEqual([
      { kind: "channel", ref: "slack" },
    ]);
  });
});

describe("accountStatusLabel (A5 §3.9: a read-only channel says so instead of claiming to be connected)", () => {
  it("prefers the capability over the connection state", () => {
    expect(
      accountStatusLabel({ state: "active", capabilities: { read: true, write: false } }),
    ).toBe("Read only");
    expect(accountStatusLabel({ state: "active", capabilities: { read: true, write: true } })).toBe(
      "Connected",
    );
  });

  it("names the account's own state when it can send", () => {
    expect(accountStatusLabel({ state: "paused", capabilities: {} })).toBe("Paused");
    expect(accountStatusLabel({ state: "broken", capabilities: null })).toBe("Broken");
  });
});

describe("settingsState (the read's own state, the same shape Digest uses)", () => {
  it("reports an error over a load in flight, and ready only when every read completed", () => {
    expect(settingsState(["unknown", "error"])).toBe("error");
    expect(settingsState(["complete", "unknown"])).toBe("loading");
    expect(settingsState(["complete"])).toBe("ready");
    expect(SETTINGS_BANNER.ready).toBe("");
  });
});

describe("the four sub-nav sections", () => {
  it("is the A5 §3.9 order, each with the dictionary's own label", () => {
    expect(SETTINGS_TABS).toEqual(["accounts", "autonomy", "model-tiers", "general"]);
    expect(SETTINGS_TABS.map((t) => SETTINGS_TAB_LABEL[t])).toEqual([
      "Accounts",
      "Autonomy",
      "Model tiers",
      "General",
    ]);
  });
});

// ─── the screen itself ──────────────────────────────────────────────────────────────────────────

function chain(table: string) {
  const node: Record<string, unknown> = { __table: table };
  for (const m of ["where", "orderBy", "limit", "related"]) node[m] = () => node;
  return node;
}

/** Only `accounts` — the settings map itself is hub HTTP (`GET /settings`), not a Zero query: W4a
 *  landed that route for this screen, and a key-value table is not a row to subscribe to. */
const TABLES: Record<string, unknown> = { accounts: chain("accounts") };
const ROWS: Record<string, readonly unknown[]> = { accounts: [] };

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
vi.mock("../src/api/settings.js", () => ({
  fetchSettings: vi.fn(async () => ({})),
  putSetting: vi.fn(async () => undefined),
  fetchCost: vi.fn(async () => ({
    state: "normal",
    mtdUsd: 34,
    capUsd: 60,
    reserveUsd: 6,
    policy: {},
  })),
  fetchKillSwitch: vi.fn(async () => ({ on: false, since: null, reason: null })),
  setKillSwitch: vi.fn(async () => undefined),
}));

const api = await import("../src/api/settings.js");
const { Settings } = await import("../src/screens/Settings.js");

/** What the migration seeds plus the two keys this screen edits — the shape `GET /settings` returns
 *  (every SettingKey, stored row or SETTING_DEFAULTS). */
function settingsPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "cost.cap_usd": 60,
    "cost.reserve_ratio": 0.1,
    "cost.last_state": null,
    "notify.quiet_hours": { start: "23:00", end: "07:00", vipOverride: true },
    "notify.vip_override": true,
    "archive.t1_confidence_min": 0.85,
    "archive.enabled": true,
    "ingest.local_roots.mini": [],
    "ingest.local_roots.macbook": [],
    "ingest.drive_folders": ["Boards"],
    "ingest.github_repos": [],
    "autonomy.rules": [],
    "kakao.send_enabled_at": null,
    ...overrides,
  };
}

const ACCOUNTS = [
  {
    id: "a1",
    channel: "slack",
    external_id: "e2e-slack",
    display: "e2e slack",
    capabilities: { read: true, write: true },
    state: "active",
    created_at: 0,
  },
  {
    id: "a2",
    channel: "kakaotalk",
    external_id: "e2e-kakaotalk",
    display: "e2e kakaotalk",
    capabilities: { read: true, write: false },
    state: "active",
    created_at: 0,
  },
];

beforeEach(() => {
  ROWS.accounts = ACCOUNTS;
  vi.mocked(api.fetchSettings).mockResolvedValue(settingsPayload());
  vi.mocked(api.fetchCost).mockResolvedValue({
    state: "normal",
    mtdUsd: 34,
    capUsd: 60,
    reserveUsd: 6,
    policy: {},
  });
  vi.mocked(api.fetchKillSwitch).mockResolvedValue({ on: false, since: null, reason: null });
  vi.mocked(api.putSetting).mockClear();
  vi.mocked(api.setKillSwitch).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The screen reads three hub routes before it has anything to draw, so every component test starts
 *  by waiting for the ready state — asserting against a screen still on `loading` proves nothing. */
async function ready(): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelector(".settings-screen")).toHaveAttribute("data-state", "ready");
  });
}

function tab(name: string): void {
  fireEvent.click(screen.getByRole("radio", { name }));
}

describe("Settings screen (A5 §3.9)", () => {
  it("opens on Accounts and offers all four sub-nav sections", async () => {
    render(<Settings />);
    await ready();
    for (const name of ["Accounts", "Autonomy", "Model tiers", "General"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "Accounts" })).toHaveAttribute("aria-checked", "true");
  });

  it("lists every account with its channel and its honest status", async () => {
    render(<Settings />);
    await ready();
    const rows = document.querySelectorAll<HTMLElement>(".settings-screen__account");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("Slack")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("Connected")).toBeInTheDocument();
    // A5 §3.9's mockup: a channel that cannot send reads "read only", not "connected".
    expect(within(rows[1] as HTMLElement).getByText("Read only")).toBeInTheDocument();
  });

  it("shows the month's spend, the cap input and the reserve beside each other", async () => {
    render(<Settings />);
    await ready();
    tab("Model tiers");
    expect(screen.getByText("$34 used")).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly cost cap")).toHaveValue(60);
    expect(screen.getByText(/VIP\/sensitive thread reserve/)).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("paints the reserve segment and pairs the 80% threshold with words, not colour alone", async () => {
    vi.mocked(api.fetchCost).mockResolvedValue({
      state: "degraded",
      mtdUsd: 49,
      capUsd: 60,
      reserveUsd: 6,
      policy: {},
    });
    render(<Settings />);
    await ready();
    tab("Model tiers");

    const bar = document.querySelector<HTMLElement>(".settings-screen__bar");
    expect(bar).toHaveAttribute("data-state", "warn");
    const spend = document.querySelector<HTMLElement>(".settings-screen__bar-spend");
    expect(Number.parseFloat(spend?.style.width ?? "0")).toBeCloseTo(81.67, 1);
    expect(screen.getByText("T2→T1 downgrade")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("writes a new cap to the hub, and only for a number the field can actually hold", async () => {
    render(<Settings />);
    await ready();
    tab("Model tiers");

    const cap = screen.getByLabelText("Monthly cost cap");
    fireEvent.change(cap, { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      expect(vi.mocked(api.putSetting)).toHaveBeenCalledWith("cost.cap_usd", 75);
    });
    await vi.waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Monthly cost cap saved.");
    });
  });

  it("refuses a blank cap instead of writing NaN over the budget", async () => {
    render(<Settings />);
    await ready();
    tab("Model tiers");

    fireEvent.change(screen.getByLabelText("Monthly cost cap"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Enter a monthly cap above $0.");
    });
    expect(vi.mocked(api.putSetting)).not.toHaveBeenCalled();
  });

  it("keeps autonomy off until the warning is confirmed, then writes the rule", async () => {
    render(<Settings />);
    await ready();
    tab("Autonomy");

    const slack = screen.getByRole("switch", { name: "Allow autonomy for Slack" });
    expect(slack).toHaveAttribute("aria-checked", "false");

    fireEvent.click(slack);
    // A5 §3.9: turning one on raises the warning dialog; nothing is written before it is answered.
    const dialog = screen.getByRole("alertdialog", { name: "Allow autonomy for Slack?" });
    expect(
      within(dialog).getByText("Actions to this target send without approval"),
    ).toBeInTheDocument();
    expect(vi.mocked(api.putSetting)).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await vi.waitFor(() => {
      expect(vi.mocked(api.putSetting)).toHaveBeenCalledWith("autonomy.rules", [
        { kind: "channel", ref: "slack" },
      ]);
    });
    await vi.waitFor(() => {
      expect(slack).toHaveAttribute("aria-checked", "true");
    });
  });

  it("cancelling the warning leaves autonomy off", async () => {
    render(<Settings />);
    await ready();
    tab("Autonomy");

    fireEvent.click(screen.getByRole("switch", { name: "Allow autonomy for Slack" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(vi.mocked(api.putSetting)).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Allow autonomy for Slack" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("edits each allowlist kind as chips, adding on Enter and removing on the chip", async () => {
    render(<Settings />);
    await ready();
    tab("Autonomy");

    const field = screen.getByLabelText("Add a Google Drive folder");
    fireEvent.change(field, { target: { value: "Contracts" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await vi.waitFor(() => {
      expect(vi.mocked(api.putSetting)).toHaveBeenCalledWith("ingest.drive_folders", [
        "Boards",
        "Contracts",
      ]);
    });
    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Remove Boards from Google Drive folders" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Boards from Google Drive folders" }),
    );
    await vi.waitFor(() => {
      expect(vi.mocked(api.putSetting)).toHaveBeenLastCalledWith("ingest.drive_folders", [
        "Contracts",
      ]);
    });
  });

  it("saves the quiet-hours window and the auto-archive threshold from General", async () => {
    render(<Settings />);
    await ready();
    tab("General");

    fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "22:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save quiet hours" }));

    await vi.waitFor(() => {
      expect(vi.mocked(api.putSetting)).toHaveBeenCalledWith("notify.quiet_hours", {
        start: "22:30",
        end: "07:00",
        vipOverride: true,
      });
    });

    const threshold = screen.getByLabelText("Auto-archive confidence threshold");
    fireEvent.change(threshold, { target: { value: "0.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save auto-archive threshold" }));

    await vi.waitFor(() => {
      expect(vi.mocked(api.putSetting)).toHaveBeenCalledWith("archive.t1_confidence_min", 0.9);
    });
  });

  it("stops all autonomous actions only after the second confirmation", async () => {
    render(<Settings />);
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "Stop all autonomous actions" }));
    const dialog = screen.getByRole("alertdialog", { name: "Stop all autonomous actions?" });
    expect(vi.mocked(api.setKillSwitch)).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await vi.waitFor(() => {
      expect(vi.mocked(api.setKillSwitch)).toHaveBeenCalledWith(
        true,
        "Stopped from the Settings screen",
      );
    });
    await vi.waitFor(() => {
      expect(screen.getByText(/Autonomous actions are stopped/)).toBeInTheDocument();
    });
  });

  it("resumes with one click, which is the whole point of the 2-step being one-way", async () => {
    vi.mocked(api.fetchKillSwitch).mockResolvedValue({
      on: true,
      since: "2026-09-21T00:00:00Z",
      reason: "Stopped from the Settings screen",
    });
    render(<Settings />);
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "Resume autonomous actions" }));
    await vi.waitFor(() => {
      expect(vi.mocked(api.setKillSwitch)).toHaveBeenCalledWith(false, "Resumed");
    });
  });

  it("says what failed rather than drawing an empty form when the hub is down", async () => {
    vi.mocked(api.fetchSettings).mockRejectedValue(new Error("HTTP 500"));
    render(<Settings />);
    await vi.waitFor(() => {
      expect(document.querySelector(".settings-screen")).toHaveAttribute("data-state", "error");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your settings");
  });
});
