import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSettings, putSetting } from "../src/api/settings.js";

describe("fetchSettings (US-D10: the pane's layout, restored on load)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /settings and unwraps the settings object", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ settings: { "ui.detail_width": 512, "ui.detail_collapsed": true } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSettings()).resolves.toEqual({
      "ui.detail_width": 512,
      "ui.detail_collapsed": true,
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/settings");
  });

  // The shell calls this once on mount, at the same moment it opens the Zero socket — so a hub
  // that is not answering yet is the ordinary boot race, not an error. Drawing the default pane is
  // the right answer to it; a rejection would take the shell down over a preference.
  it("resolves to an empty object when the hub refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(fetchSettings()).resolves.toEqual({});
  });

  it("resolves to an empty object when the hub is not reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(fetchSettings()).resolves.toEqual({});
  });

  it("treats a body with no settings key as no settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(fetchSettings()).resolves.toEqual({});
  });
});

describe("putSetting (US-D10: a drag is remembered)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("PUTs { value } to the key's own URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await putSetting("ui.detail_width", 512);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/settings/ui.detail_width",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ value: 512 }),
      }),
    );
  });

  // Unlike the read, a failed write rejects: the caller has to know, because the surface it just
  // changed is claiming something the hub did not accept.
  it("rejects on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    await expect(putSetting("ui.detail_width", 512)).rejects.toThrow(/404/);
  });
});
