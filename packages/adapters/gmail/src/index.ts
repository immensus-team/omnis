import {
  type Adapter,
  AdapterError,
  type AdapterEvent,
  type AuthRef,
  type Capabilities,
  type Health,
  type NormalizedItem,
} from "@omnis/protocol";
import { google } from "googleapis";
import { readKeychainSecret } from "./keychain.js";

export const CHANNEL = "gmail" as const;

// googleapis@161's own dependency (`^10.2.0`) resolves to a different
// google-auth-library copy than its transitive dep via googleapis-common
// (pinned exactly at 10.5.0) — the package re-exports `OAuth2Client`
// from the former, but `google.auth.OAuth2` constructs from the latter, so
// the two nominal types don't structurally unify under strict mode.
// Deriving the type from the constructor we actually call keeps both usages
// pointed at the same class identity (deviation from plan step 6, which
// assumed a plain `google-auth-library` devDependency import would line up).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const CAPABILITIES: Capabilities = {
  read: true,
  write: true,
  realtime: true,
  history: true,
  media: true,
  markRead: true,
  typing: false,
  archive: true,
  delete: false,
};

export interface GmailAdapterDeps {
  oauthClientId: string;
  oauthClientSecret: string;
  oauthClient?: OAuth2Client;
  now?: () => Date;
}

export function createGmailAdapter(deps: GmailAdapterDeps): Adapter {
  const now = deps.now ?? (() => new Date());
  let oauth: OAuth2Client | undefined;
  let status: Health["status"] = "down";
  let lastEventAt: string | null = null;
  let lastError: Health["lastError"];

  return {
    id: "gmail",
    channel: CHANNEL,
    capabilities: () => CAPABILITIES,

    async connect(auth: AuthRef): Promise<void> {
      const refreshToken = await readKeychainSecret(
        auth.keychainService,
        auth.keychainAccount,
        CHANNEL,
      );
      oauth =
        deps.oauthClient ?? new google.auth.OAuth2(deps.oauthClientId, deps.oauthClientSecret);
      oauth.setCredentials({ refresh_token: refreshToken });
      try {
        await oauth.getAccessToken();
      } catch (cause) {
        status = "down";
        throw new AdapterError(
          "auth_revoked",
          CHANNEL,
          "Gmail refresh token rejected",
          undefined,
          cause,
        );
      }
      status = "healthy";
      lastEventAt = now().toISOString();
    },

    async disconnect(): Promise<void> {
      status = "down";
    },

    backfill(): AsyncIterable<NormalizedItem> {
      throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 8");
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      throw new AdapterError(
        "fatal_unsupported",
        CHANNEL,
        "subscribe not implemented until Task 8",
      );
    },

    async send(): Promise<never> {
      throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 9");
    },

    async health(): Promise<Health> {
      return {
        channel: CHANNEL,
        accountExternalId: "",
        status,
        lastEventAt,
        ...(lastError ? { lastError } : {}),
      };
    },
  };
}
