import { AuroraSurface, Button } from "@omnis/ui";
import { useState } from "react";
import { storeChannelSecret } from "../api/keychain.js";

export type OnboardingChannel = "slack" | "gmail" | "gcal";

/** Contract §9: one channel does not have to be one keychain entry — Slack is two tokens (bot +
 *  app), and the channel decides the account for each entry. */
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

/** A5 §7.1: Phase A has exactly three required channels. Outlook/Telegram/WhatsApp/KakaoTalk/
 *  LinkedIn are outside this screen's scope — the master D12 note below is all it says about them.
 *
 *  US-D06 §4.1.3: the screen is a full-bleed `void` aurora with the words on a scrim. That is how it
 *  answers §5.3 guard 4 instead of violating it — the screen is well over 40 words, so the text does
 *  not get to sit directly on a moving surface. The aurora is what surrounds the card, never what
 *  the card is made of. */
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
      // Contract §9: for Slack this array holds two entries (bot + app token) and for the other
      // channels one. The order does not matter — all of them have to be stored before the channel
      // reads as "Connected".
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
    <AuroraSurface variant="void" className="onboarding">
      <div className="onboarding__card">
        <h1>Welcome to omnis</h1>
        <ul>
          {REQUIRED_CHANNELS.map((c) => (
            <li key={c.id}>
              <span>{c.label}</span>
              <Button disabled={state[c.id] === "connecting"} onClick={() => void connect(c.id)}>
                {state[c.id] === "connected"
                  ? "Connected"
                  : state[c.id] === "connecting"
                    ? "Connecting…"
                    : "Connect"}
              </Button>
              {state[c.id] === "error" && (
                <span role="alert">Connection failed — please try again</span>
              )}
            </li>
          ))}
        </ul>
        <p>WhatsApp / KakaoTalk / LinkedIn: set these up on the Mac mini</p>
        <Button onClick={onDone} disabled={!allConnected}>
          Continue
        </Button>
      </div>
    </AuroraSurface>
  );
}
