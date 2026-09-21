import { invoke } from "@tauri-apps/api/core";

/** Contract §9: the `account` field is a fixed, non-identifying label (`omnis`) for the Google family
 *  and the team_id for Slack. Readers look items up by service name only, so it is never matched
 *  against — the channel decides what to pass. */
export async function storeChannelSecret(
  keychainService: string,
  account: string,
  secret: string,
): Promise<void> {
  await invoke("keychain_set", { service: keychainService, account, secret });
}
