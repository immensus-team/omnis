// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 apps/desktop/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다(packages/ui/test/button.test.tsx와 동일 패턴).
import "./setup.js";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { storeChannelSecret } from "../src/api/keychain.js";

describe("storeChannelSecret (계약 §9 Keychain 명명 규칙)", () => {
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

  it("invokes keychain_set with the team_id as account for a slack bot-token service (계약 §9 Slack 예외)", async () => {
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

describe("Onboarding (A5 §7.1, Phase A 필수 채널 3개)", () => {
  it("continue button is disabled until slack/gmail/gcal are all connected", async () => {
    const oauthClient: OAuthClient = { connect: mockConnect };
    const onDone = vi.fn();
    render(<Onboarding oauthClient={oauthClient} onDone={onDone} />);
    expect(screen.getByText("계속")).toBeDisabled();

    clickFirst("연결");
    clickFirst("연결"); // gmail (slack 버튼 라벨이 "연결 중…"으로 바뀐 뒤의 다음 "연결")
    clickFirst("연결"); // gcal

    await waitFor(() => expect(screen.getByText("계속")).not.toBeDisabled());
    fireEvent.click(screen.getByText("계속"));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("stores both slack keychain entries with account=team_id (계약 §9 Slack 2항목 규칙)", async () => {
    const invokeMock = vi.mocked((await import("@tauri-apps/api/core")).invoke);
    invokeMock.mockClear();
    render(<Onboarding oauthClient={{ connect: mockConnect }} onDone={vi.fn()} />);

    clickFirst("연결"); // slack
    await waitFor(() => expect(screen.getByText("연결됨")).toBeInTheDocument());

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

  it("shows the mac-mini-setup note for WhatsApp/KakaoTalk/LinkedIn (마스터 D12 정직한 정의)", () => {
    render(<Onboarding oauthClient={{ connect: vi.fn() }} onDone={vi.fn()} />);
    expect(screen.getByText(/맥미니에서 설정이 필요해요/)).toBeInTheDocument();
  });
});
