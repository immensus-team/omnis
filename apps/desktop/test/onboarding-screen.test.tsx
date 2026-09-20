// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read apps/desktop/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself
// — the same pattern packages/ui/test/button.test.tsx uses.
import "./setup.js";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { storeChannelSecret } from "../src/api/keychain.js";

describe("storeChannelSecret (contract §9 keychain naming)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes keychain_set with the Google identifier for a gmail service", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await storeChannelSecret(
      "omnis.gmail.281932556+jinhologankim@users.noreply.github.com",
      "281932556+jinhologankim@users.noreply.github.com",
      "secret-token",
    );
    expect(invoke).toHaveBeenCalledWith("keychain_set", {
      service: "omnis.gmail.281932556+jinhologankim@users.noreply.github.com",
      account: "281932556+jinhologankim@users.noreply.github.com",
      secret: "secret-token",
    });
  });

  it("invokes keychain_set with the team_id as account for a slack bot-token service (contract §9 Slack exception)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await storeChannelSecret("omnis.slack.xoxb.T123", "T123", "xoxb-secret");
    expect(invoke).toHaveBeenCalledWith("keychain_set", {
      service: "omnis.slack.xoxb.T123",
      account: "T123",
      secret: "xoxb-secret",
    });
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  type ChannelSecretEntry,
  type OAuthClient,
  Onboarding,
} from "../src/screens/Onboarding.js";

/** biome noNonNullAssertion: getAllByText(...)[0] is `T | undefined` under noUncheckedIndexedAccess. */
function clickFirst(text: string) {
  const [el] = screen.getAllByText(text);
  if (!el) throw new Error(`expected an element matching "${text}"`);
  fireEvent.click(el);
}

const mockConnect: OAuthClient["connect"] = vi.fn(
  async (channel): Promise<ChannelSecretEntry[]> =>
    channel === "slack"
      ? [
          { keychainService: "omnis.slack.xoxb.T123", account: "T123", secret: "xoxb-bot-token" },
          {
            keychainService: "omnis.slack.xoxb.T123.app",
            account: "T123",
            secret: "xoxb-app-token",
          },
        ]
      : [
          {
            keychainService: `omnis.${channel}.281932556+jinhologankim@users.noreply.github.com`,
            account: "281932556+jinhologankim@users.noreply.github.com",
            secret: "s",
          },
        ],
);

describe("Onboarding (A5 §7.1, three required Phase A channels)", () => {
  it("continue button is disabled until slack/gmail/gcal are all connected", async () => {
    const oauthClient: OAuthClient = { connect: mockConnect };
    const onDone = vi.fn();
    render(<Onboarding oauthClient={oauthClient} onDone={onDone} />);
    expect(screen.getByText("Continue")).toBeDisabled();

    clickFirst("Connect");
    clickFirst("Connect"); // gmail, after the slack button's label became "Connecting…"
    clickFirst("Connect"); // gcal

    await waitFor(() => expect(screen.getByText("Continue")).not.toBeDisabled());
    fireEvent.click(screen.getByText("Continue"));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("stores both slack keychain entries with account=team_id (contract §9 two-entry Slack rule)", async () => {
    const invokeMock = vi.mocked((await import("@tauri-apps/api/core")).invoke);
    invokeMock.mockClear();
    render(<Onboarding oauthClient={{ connect: mockConnect }} onDone={vi.fn()} />);

    clickFirst("Connect"); // slack
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());

    expect(invokeMock).toHaveBeenCalledWith("keychain_set", {
      service: "omnis.slack.xoxb.T123",
      account: "T123",
      secret: "xoxb-bot-token",
    });
    expect(invokeMock).toHaveBeenCalledWith("keychain_set", {
      service: "omnis.slack.xoxb.T123.app",
      account: "T123",
      secret: "xoxb-app-token",
    });
  });

  it("shows the Mac-mini-setup note for WhatsApp/KakaoTalk/LinkedIn (master D12, the honest definition)", () => {
    render(<Onboarding oauthClient={{ connect: vi.fn() }} onDone={vi.fn()} />);
    expect(screen.getByText(/set these up on the Mac mini/)).toBeInTheDocument();
  });

  // US-D06 §4.1.3: the screen is a full-bleed `void` aurora with the words on a scrim. Both halves
  // matter: the aurora is what surrounds the card, and the card is why ~40 words of copy can live on
  // this screen at all (§5.3 guard 4 — text does not sit directly on a moving surface).
  it("renders the void aurora with the copy on a scrim card (US-D06)", () => {
    const { container } = render(
      <Onboarding oauthClient={{ connect: vi.fn() }} onDone={vi.fn()} />,
    );
    const aura = container.querySelector(".onboarding");
    const card = container.querySelector(".onboarding__card");

    expect(aura).toHaveAttribute("data-aurora", "void");
    // §2.7: the card is content, not chrome — it is not a `.glass-surface` and it is not the
    // aurora's own element, so neither name can pick up the other's background rule.
    expect(card).not.toBeNull();
    expect(card).not.toHaveClass("glass-surface");
    expect(card).not.toHaveClass("aurora");
    // Every word of the screen is inside the card, never a sibling of it.
    expect(card).toContainElement(screen.getByRole("heading", { name: "Welcome to omnis" }));
    expect(card).toContainElement(screen.getByText("Continue"));
  });
});
