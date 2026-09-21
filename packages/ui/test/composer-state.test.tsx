// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  COMPOSER_STATE_COPY,
  type ComposerBlock,
  ComposerState,
  composerBlockFor,
} from "../src/components/composer-state";
import { t } from "../src/i18n/index";

/** The four closed states of a capture-channel composer, and the one input each is decided by. */
const CASES: readonly {
  name: string;
  input: Parameters<typeof composerBlockFor>[0];
  block: Exclude<ComposerBlock, null>;
  copy: string;
}[] = [
  {
    name: "kakao is counting down to its stable-read gate",
    input: { channel: "kakaotalk", canWrite: false, partial: false, kakaoDaysRemaining: 9 },
    block: { kind: "kakao_countdown", days: 9 },
    copy: "Sending opens in 9 days",
  },
  {
    name: "kakao's countdown is done and only the opt-in is left",
    input: { channel: "kakaotalk", canWrite: false, partial: false, kakaoDaysRemaining: 0 },
    block: { kind: "kakao_countdown", days: 0 },
    copy: "Sending opens today once you turn it on in Settings",
  },
  {
    name: "kakao has no stable read yet, so there is no countdown to state",
    input: { channel: "kakaotalk", canWrite: false, partial: false, kakaoDaysRemaining: null },
    block: { kind: "kakao_countdown", days: 0 },
    copy: "Sending opens today once you turn it on in Settings",
  },
  {
    name: "a LinkedIn thread we only ever saw a preview of",
    input: { channel: "linkedin", canWrite: true, partial: true, kakaoDaysRemaining: null },
    block: { kind: "linkedin_summary_only" },
    copy: "Summary only — reply needs the capture host",
  },
  {
    name: "whatsapp before the pilot check",
    input: { channel: "whatsapp", canWrite: false, partial: false, kakaoDaysRemaining: null },
    block: { kind: "whatsapp_pilot" },
    copy: "Sending is off until the pilot check",
  },
];

describe("composerBlockFor (US-C17: the composer says which state it is in)", () => {
  it.each(CASES)("$name", ({ input, block }) => {
    expect(composerBlockFor(input)).toEqual(block);
  });

  it.each([
    // Kakao's gate is open, so there is nothing to announce.
    [
      "kakao with send open",
      { channel: "kakaotalk", canWrite: true, partial: false, kakaoDaysRemaining: 0 },
    ],
    // A channel with no capture-side state of its own keeps the plain composer.
    ["slack", { channel: "slack", canWrite: true, partial: false, kakaoDaysRemaining: null }],
    ["gmail", { channel: "gmail", canWrite: false, partial: false, kakaoDaysRemaining: null }],
    // LinkedIn's line is about the thread being a preview, not about the account's write flag:
    // a thread whose real messages are here replies normally.
    [
      "a fully captured LinkedIn thread",
      { channel: "linkedin", canWrite: true, partial: false, kakaoDaysRemaining: null },
    ],
    // The pilot line belongs to whatsapp alone — another channel with write off is not the pilot.
    [
      "telegram with write off",
      { channel: "telegram", canWrite: false, partial: false, kakaoDaysRemaining: null },
    ],
    [
      "whatsapp once the pilot is over",
      { channel: "whatsapp", canWrite: true, partial: false, kakaoDaysRemaining: null },
    ],
  ] as const)("returns null for %s", (_name, input) => {
    expect(composerBlockFor(input)).toBeNull();
  });
});

describe("ComposerState", () => {
  it.each(CASES)("$name renders its copy and marks the kind", ({ block, copy }) => {
    const { container } = render(<ComposerState block={block} />);

    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(container.querySelector(".composer-state")).toHaveAttribute("data-kind", block.kind);
  });

  it("says what the dictionary says, so the two transcriptions cannot drift", () => {
    // The copy above is asserted as a literal (that is the plan's contract); the dictionary is the
    // other place it lives, for the i18n layer and the ko add-on. Nothing else reads either one
    // against the other, so this is where a rewording of one and not the other fails.
    expect(COMPOSER_STATE_COPY.kakaoDays(9)).toBe(
      t("en", "thread.composerState.kakaoDays", { n: 9 }),
    );
    expect(COMPOSER_STATE_COPY.kakaoToday).toBe(t("en", "thread.composerState.kakaoToday"));
    expect(COMPOSER_STATE_COPY.linkedinSummaryOnly).toBe(
      t("en", "thread.composerState.linkedinSummaryOnly"),
    );
    expect(COMPOSER_STATE_COPY.whatsappPilot).toBe(t("en", "thread.composerState.whatsappPilot"));
  });

  it("keeps its className when the pane wants to place it", () => {
    const { container } = render(
      <ComposerState block={{ kind: "whatsapp_pilot" }} className="thread-screen__composer" />,
    );

    expect(container.querySelector(".composer-state")).toHaveClass("thread-screen__composer");
  });
});
