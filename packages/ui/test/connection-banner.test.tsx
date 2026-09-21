// @vitest-environment jsdom
// loop-r2-05: the shell's connection line. Three of the four claims here are about *not* saying
// something — nothing when connected, nothing while a normal start is still connecting, and no
// "Showing what synced" when nothing ever has.
import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTING_GRACE_MS,
  ConnectionBanner,
  connectionLine,
} from "../src/components/connection-banner";

describe("ConnectionBanner (loop-r2-05)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws nothing at all when connected", () => {
    const { container } = render(<ConnectionBanner kind="ok" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says how stale the data is and offers a retry while it cannot reach omnis", () => {
    const onRetry = vi.fn();
    render(<ConnectionBanner kind="unreachable" lastSyncedAt="3m ago" onRetry={onRetry} />);

    expect(
      screen.getByText("Can't reach omnis. Showing what synced 3m ago. Retrying…"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("drops the freshness sentence when nothing has ever synced", () => {
    render(<ConnectionBanner kind="unreachable" onRetry={() => undefined} />);
    // "Showing what synced" with nothing synced is a claim about data that does not exist.
    expect(screen.getByText("Can't reach omnis. Retrying…")).toBeTruthy();
  });

  it("stops the offline sentence after 'offline' when nothing has ever synced", () => {
    render(<ConnectionBanner kind="offline" />);
    expect(screen.getByText("You're offline.")).toBeTruthy();
  });

  it("says how stale the data is when the browser goes offline mid-session", () => {
    render(<ConnectionBanner kind="offline" lastSyncedAt="2h ago" />);
    expect(screen.getByText("You're offline. Showing what synced 2h ago.")).toBeTruthy();
  });

  it("offers a reload, not a retry, when the session is stale", () => {
    const onReload = vi.fn();
    const onRetry = vi.fn();
    render(<ConnectionBanner kind="session" onRetry={onRetry} onReload={onReload} />);

    expect(screen.getByText("Sync needs a fresh session.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  // A normal start passes through `connecting` for a moment. A line that appears for 400ms on every
  // launch reads as an error that fixed itself, so it waits for the state to prove it is stuck.
  it("holds the connecting line back for the grace period", () => {
    vi.useFakeTimers();
    render(<ConnectionBanner kind="connecting" />);
    expect(screen.queryByText("Connecting to omnis…")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(CONNECTING_GRACE_MS - 1);
    });
    expect(screen.queryByText("Connecting to omnis…")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("Connecting to omnis…")).toBeTruthy();
  });

  it("restarts the grace period when a connection drops and comes back", () => {
    vi.useFakeTimers();
    const { rerender } = render(<ConnectionBanner kind="connecting" />);
    act(() => {
      vi.advanceTimersByTime(CONNECTING_GRACE_MS - 1);
    });
    // Up and then down again before the grace period expired: the second attempt gets its own 3s
    // rather than inheriting the first one's remainder.
    rerender(<ConnectionBanner kind="ok" />);
    rerender(<ConnectionBanner kind="connecting" />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Connecting to omnis…")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(CONNECTING_GRACE_MS);
    });
    expect(screen.getByText("Connecting to omnis…")).toBeTruthy();
  });

  it("announces politely and steals no focus", () => {
    render(<ConnectionBanner kind="session" onReload={() => undefined} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    // The button is a normal Tab stop: nothing in the banner is focused for the user.
    expect(document.activeElement).toBe(document.body);
  });
});

describe("connectionLine (the copy, in one place)", () => {
  it("is null for ok and for a connecting state that has not settled", () => {
    expect(connectionLine("ok", null, true)).toBeNull();
    expect(connectionLine("connecting", null, false)).toBeNull();
  });
});
