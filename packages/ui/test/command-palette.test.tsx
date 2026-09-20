// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteAction, groupBy } from "../src/components/command-palette";
import {
  ASK_MODEL_STORAGE_KEY,
  type AskModelId,
  DEFAULT_ASK_MODEL,
  askModelLabel,
  writeAskModel,
} from "../src/lib/ask-model";

/** Since US-D01 the panel's default tab is "Suggestions" — the command list sits behind "Commands". */
const openCommandsTab = () => fireEvent.click(screen.getByRole("button", { name: "Commands" }));

/** A literal at the call site, but narrowed to AskModelId so a typo fails at compile time. */
const FLASH_ID: AskModelId = "deepseek-v4.1-flash";

describe("groupBy", () => {
  it("groups items by the given key function", () => {
    const grouped = groupBy(
      [
        { g: "a", v: 1 },
        { g: "b", v: 2 },
        { g: "a", v: 3 },
      ],
      (x) => x.g,
    );
    expect(grouped).toEqual({
      a: [
        { g: "a", v: 1 },
        { g: "a", v: 3 },
      ],
      b: [{ g: "b", v: 2 }],
    });
  });
});

describe("CommandPalette (A5 §2.3)", () => {
  it("renders grouped actions and calls perform() + closes on select", () => {
    const perform = vi.fn();
    const onOpenChange = vi.fn();
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform },
    ];
    render(<CommandPalette open onOpenChange={onOpenChange} actions={actions} />);
    fireEvent.click(screen.getByText("Go to Inbox"));
    expect(perform).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('CommandPalette mode="inline" (the U1 kinso ask/search pill bar)', () => {
  it("shows the kinso placeholder and no dropdown list while closed", () => {
    render(<CommandPalette mode="inline" open={false} onOpenChange={vi.fn()} actions={[]} />);
    expect(screen.getByPlaceholderText("Start typing to ask or search")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("mounts the AI panel dialog only while open (US-D01)", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />,
    );
    expect(screen.queryByRole("dialog", { name: "AI panel" })).not.toBeInTheDocument();

    rerender(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={[]} />);
    expect(screen.getByRole("dialog", { name: "AI panel" })).toBeInTheDocument();
  });

  it("typing into the pill opens the palette (onOpenChange(true))", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Start typing to ask or search"), {
      target: { value: "s" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("focusing the pill also opens the palette", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.focus(screen.getByPlaceholderText("Start typing to ask or search"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("when open, renders the same grouped actions as the dialog mode does", () => {
    const perform = vi.fn();
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform },
    ];
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    openCommandsTab();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Go to Inbox"));
    expect(perform).toHaveBeenCalledOnce();
  });
});

describe('CommandPalette mode="inline" close paths (U1 regression)', () => {
  it("Escape closes the inline dropdown", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Start typing to ask or search"), {
      key: "Escape",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a pointerdown outside the pill closes the inline dropdown", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a pointerdown inside the palette does not close it (a click on a selection has to survive)", () => {
    const onOpenChange = vi.fn();
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform: vi.fn() },
    ];
    render(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={actions} />);
    openCommandsTab();
    fireEvent.pointerDown(screen.getByText("Go to Inbox"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not listen while closed", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('CommandPalette mode="inline" model picker persistence (US-D01)', () => {
  // test/setup.ts's in-memory Storage survives for the whole file — empty it between tests.
  beforeEach(() => localStorage.clear());

  it("pick swaps the toggle label and writes the id to localStorage", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />);

    const toggle = screen.getByRole("button", { name: askModelLabel(DEFAULT_ASK_MODEL) });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: askModelLabel(FLASH_ID) }));

    expect(toggle).toHaveTextContent(askModelLabel(FLASH_ID));
    expect(localStorage.getItem(ASK_MODEL_STORAGE_KEY)).toBe(FLASH_ID);
  });

  it("starts on the stored model", () => {
    writeAskModel(FLASH_ID);
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />);

    expect(screen.getByRole("button", { name: askModelLabel(FLASH_ID) })).toBeInTheDocument();
  });
});

const askInput = () => screen.getByPlaceholderText("Start typing to ask or search");

describe('CommandPalette mode="inline" typing path (US-D01 regression)', () => {
  const actions: PaletteAction[] = [
    { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform: vi.fn() },
  ];

  it("typing reaches the cmdk list without clicking the Commands tab", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    // Before typing this is the Suggestions tab — there is no command list yet.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(askInput(), { target: { value: "Inbox" } });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Go to Inbox")).toBeInTheDocument();
  });

  it('a leading ">" also lands on the Commands tab', () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    fireEvent.change(askInput(), { target: { value: ">" } });
    expect(screen.getByRole("button", { name: "Commands" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clearing the query returns to the Suggestions tab", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    fireEvent.change(askInput(), { target: { value: "Inbox" } });
    fireEvent.change(askInput(), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Draft a reply" })).toBeInTheDocument();
  });
});

describe('CommandPalette mode="inline" @ mention affordance (US-D01)', () => {
  it("is present before any @ is typed and inserts one into the input", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />);
    expect(screen.queryByText("@ mention")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add mention" }));

    expect(askInput()).toHaveValue("@");
    expect(screen.getByText("@ mention")).toBeInTheDocument();
  });
});

describe('CommandPalette mode="inline" close spring (US-D01)', () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the panel mounted for one --dur-panel so the close animation can play", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />,
    );
    rerender(<CommandPalette mode="inline" open={false} onOpenChange={vi.fn()} actions={[]} />);

    expect(screen.getByRole("dialog", { name: "AI panel" })).toHaveClass("ask-panel--closing");

    act(() => vi.advanceTimersByTime(240));
    expect(screen.queryByRole("dialog", { name: "AI panel" })).not.toBeInTheDocument();
  });
});
