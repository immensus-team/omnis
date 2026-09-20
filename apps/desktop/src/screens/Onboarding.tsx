import { Button } from "@omnis/ui";
import { useState } from "react";
import { storeChannelSecret } from "../api/keychain.js";

export type OnboardingChannel = "slack" | "gmail" | "gcal";

/** 계약 §9: 채널 하나가 keychain 항목 1개일 필요는 없다 — Slack은 bot+app 토큰 2개, account는 항목마다 채널이 정한다. */
export interface ChannelSecretEntry {
  keychainService: string;
  account: string;
  secret: string;
}

export interface OAuthClient {
  connect(channel: OnboardingChannel): Promise<ChannelSecretEntry[]>;
}

const REQUIRED_CHANNELS: { id: OnboardingChannel; label: string }[] = [
  { id: "slack", label: "Slack" },
  { id: "gmail", label: "Gmail" },
  { id: "gcal", label: "Google Calendar" },
];

type ConnectState = "idle" | "connecting" | "connected" | "error";

/** A5 §7.1: Phase A 필수 채널은 Slack/Gmail/Calendar 3개뿐. Outlook/Telegram/WhatsApp/
 *  KakaoTalk/LinkedIn은 이 화면의 범위 밖(마스터 D12, "맥미니에서 설정 필요" 안내만). */
export function Onboarding({
  oauthClient,
  onDone,
}: { oauthClient: OAuthClient; onDone: () => void }) {
  const [state, setState] = useState<Record<OnboardingChannel, ConnectState>>({
    slack: "idle",
    gmail: "idle",
    gcal: "idle",
  });

  async function connect(channel: OnboardingChannel) {
    setState((s) => ({ ...s, [channel]: "connecting" }));
    try {
      const entries = await oauthClient.connect(channel);
      // 계약 §9: Slack은 이 배열이 2항목(bot + app 토큰)이고, 나머지 채널은 1항목이다. 순서는 상관없다 — 전부 저장돼야 "연결됨".
      for (const entry of entries) {
        await storeChannelSecret(entry.keychainService, entry.account, entry.secret);
      }
      setState((s) => ({ ...s, [channel]: "connected" }));
    } catch {
      setState((s) => ({ ...s, [channel]: "error" }));
    }
  }

  const allConnected = REQUIRED_CHANNELS.every((c) => state[c.id] === "connected");

  return (
    <div className="onboarding">
      <h1>omnis에 오신 걸 환영해요</h1>
      <ul>
        {REQUIRED_CHANNELS.map((c) => (
          <li key={c.id}>
            <span>{c.label}</span>
            <Button disabled={state[c.id] === "connecting"} onClick={() => void connect(c.id)}>
              {state[c.id] === "connected"
                ? "연결됨"
                : state[c.id] === "connecting"
                  ? "연결 중…"
                  : "연결"}
            </Button>
            {state[c.id] === "error" && <span role="alert">연결 실패, 다시 시도해주세요</span>}
          </li>
        ))}
      </ul>
      <p>WhatsApp / KakaoTalk / LinkedIn: 맥미니에서 설정이 필요해요</p>
      <Button onClick={onDone} disabled={!allConnected}>
        계속
      </Button>
    </div>
  );
}
