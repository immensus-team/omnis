// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so this file declares its own
// environment and setup (the same situation as settings-screen.test.tsx).
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DELEGATION_HOSTS,
  DELEGATION_RUNTIMES,
  type DelegationRule,
  DelegationRules,
  delegationRulesOf,
} from "../src/screens/settings/DelegationRules.js";

/** A4 §4.4's warning question and the two validation sentences, spelled once here so a reworded
 *  dialog fails these tests instead of quietly passing them. */
const WARNING =
  "Delegations to this runtime in this repository will run without approval. Continue?";
const RELATIVE_PATH = "Use an absolute path";

/** A stored rule of the shape `parseDelegationRules` (packages/kernel/src/delegation-rules.ts)
 *  keeps — the only shape the hub's delegate executor will act on. */
const RULE: DelegationRule = {
  runtime: "claude_code",
  host: "macbook",
  repo: "/Users/logankim/AI-Workspaces/omnis",
};

function setup(rules: unknown = [], hermesEnabled = false) {
  const onSave = vi.fn(async () => undefined);
  render(<DelegationRules rules={rules} hermesEnabled={hermesEnabled} onSave={onSave} />);
  return onSave;
}

/** The dialog, filled the way a person fills it: Add, then the two selects and the path. */
function fill(fields: { runtime?: string; host?: string; repo?: string } = {}): void {
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  fireEvent.change(screen.getByLabelText("Runtime"), {
    target: { value: fields.runtime ?? "codex" },
  });
  fireEvent.change(screen.getByLabelText("Host"), { target: { value: fields.host ?? "mini" } });
  fireEvent.change(screen.getByLabelText("Repository path"), {
    target: { value: fields.repo ?? RULE.repo },
  });
}

const confirm = (): void => fireEvent.click(screen.getByRole("button", { name: "Allow" }));

describe("delegationRulesOf (delegation.allow_rules is jsonb, so it is whatever a writer left)", () => {
  it("reads the rules the kernel's schema accepts", () => {
    expect(delegationRulesOf([RULE])).toEqual([RULE]);
    expect(delegationRulesOf([])).toEqual([]);
  });

  it("reads no rule out of a value that is not a list of rules", () => {
    expect(delegationRulesOf(null)).toEqual([]);
    expect(delegationRulesOf("claude_code")).toEqual([]);
    expect(delegationRulesOf([{ runtime: "codex", host: "mini" }])).toEqual([]);
    expect(delegationRulesOf([{ runtime: "codex", host: "mini", repo: "" }])).toEqual([]);
    expect(delegationRulesOf([RULE, "codex", null])).toEqual([RULE]);
  });

  // The screen writes back the whole jsonb value, so a row it dropped would be deleted from the
  // database by the next Remove — the same trap `autonomySet` (Settings.tsx) documents. A runtime
  // this build has not been taught is carried through instead, and Remove is how a person retires
  // it: the kernel's `parseDelegationRules` already refuses to apply it, so leaving it listed is
  // the honest half (it cannot open a door it does not match) and deleting it is the destructive one.
  it("carries a rule of an unknown runtime through instead of deleting it", () => {
    const unknown = { runtime: "gpt5", host: "mini", repo: "/tmp/x" };
    expect(delegationRulesOf([unknown, RULE])).toEqual([unknown, RULE]);
  });
});

describe("DelegationRules (A5 §3.9 / A4 §4.4)", () => {
  it("starts with no runtime running without approval", () => {
    setup([]);
    expect(screen.getByText("No runtime runs without your approval.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it("names each stored rule by runtime, host and path", () => {
    setup([RULE]);
    expect(screen.getByText(/Claude Code/)).toBeInTheDocument();
    expect(screen.getByText(/MacBook/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(RULE.repo))).toBeInTheDocument();
  });

  // Every runtime the kernel's rule enum has is offered — `hermes` included, which is the one
  // `RUNTIME_OPTIONS` (the agent layer's routable list) does not carry. Whether the Hermes option
  // can be picked is the next two tests' business, not this one's.
  it("offers every runtime the kernel's rule enum has, and both hosts", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    const runtimes = within(screen.getByLabelText("Runtime"));
    for (const runtime of DELEGATION_RUNTIMES) {
      expect(
        runtimes.getByRole("option", { name: runtimeLabelForTest(runtime) }),
      ).toBeInTheDocument();
    }
    const hosts = within(screen.getByLabelText("Host"));
    for (const host of DELEGATION_HOSTS) {
      expect(hosts.getByRole("option", { name: hostLabelForTest(host) })).toBeEnabled();
    }
  });

  it("opens the warning dialog on Add and saves nothing before Allow", () => {
    const onSave = setup([]);
    fill({});
    expect(screen.getByRole("alertdialog", { name: WARNING })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the rule once Allow is pressed", () => {
    const onSave = setup([]);
    fill({ runtime: "codex", host: "mini" });
    confirm();
    expect(onSave).toHaveBeenCalledWith([{ runtime: "codex", host: "mini", repo: RULE.repo }]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  // The warning is about one runtime in one repository, so the dialog starts fresh every time: a
  // second rule must not inherit the first one's selects.
  it("starts the dialog from the default runtime and host", () => {
    const onSave = setup([RULE]);
    fill({ runtime: "codex", host: "mini" });
    confirm();
    fill({});
    confirm();
    expect(onSave).toHaveBeenLastCalledWith([
      RULE,
      { runtime: "codex", host: "mini", repo: RULE.repo },
    ]);
  });

  it("appends to the stored rules rather than replacing them", () => {
    const onSave = setup([RULE]);
    fill({});
    confirm();
    expect(onSave).toHaveBeenCalledWith([
      RULE,
      { runtime: "codex", host: "mini", repo: RULE.repo },
    ]);
  });

  it("removes a rule with no dialog", () => {
    const onSave = setup([RULE]);
    fireEvent.click(screen.getByRole("button", { name: /^Remove/ }));
    expect(onSave).toHaveBeenCalledWith([]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("disables the Hermes option, and says why, while the Hermes approval check is off", () => {
    setup([], false);
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    const hermes = within(screen.getByLabelText("Runtime")).getByRole("option", {
      name: "Hermes",
    });
    expect(hermes).toBeDisabled();
    expect(screen.getByText("Needs the Hermes approval check first")).toBeInTheDocument();
  });

  it("enables the Hermes option and drops the reason once the check is on", () => {
    setup([], true);
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    const hermes = within(screen.getByLabelText("Runtime")).getByRole("option", {
      name: "Hermes",
    });
    expect(hermes).toBeEnabled();
    expect(screen.queryByText("Needs the Hermes approval check first")).not.toBeInTheDocument();
  });

  it("refuses a repository path that is not absolute", () => {
    const onSave = setup([]);
    fill({ repo: "omnis" });
    confirm();
    expect(screen.getByText(RELATIVE_PATH)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: WARNING })).toBeInTheDocument();
  });

  it("refuses an empty repository path the same way", () => {
    const onSave = setup([]);
    fill({ repo: "   " });
    confirm();
    expect(screen.getByText(RELATIVE_PATH)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("accepts the path once it is absolute, and trims it", () => {
    const onSave = setup([]);
    fill({ repo: "omnis" });
    confirm();
    fireEvent.change(screen.getByLabelText("Repository path"), {
      target: { value: `  ${RULE.repo}  ` },
    });
    confirm();
    expect(onSave).toHaveBeenCalledWith([{ runtime: "codex", host: "mini", repo: RULE.repo }]);
  });
});

/** The option label the screen shows for a runtime. Kept as a local map rather than reaching into
 *  the component's own label lookup, so the test fails if an option is mislabelled rather than
 *  passing on whatever the component happens to print. */
function runtimeLabelForTest(runtime: string): string {
  return {
    claude_code: "Claude Code",
    codex: "Codex",
    claude_ds: "claude-ds",
    hermes: "Hermes",
    omnis: "omnis",
  }[runtime] as string;
}

/** The host's display name — the two machines are named the same way the ingest allowlist above
 *  names them ("Mac mini folders" / "MacBook folders"). */
function hostLabelForTest(host: string): string {
  return { mini: "Mac mini", macbook: "MacBook" }[host] as string;
}
