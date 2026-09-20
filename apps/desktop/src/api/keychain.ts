import { invoke } from "@tauri-apps/api/core";

/** 계약 §9: account 필드는 채널별로 다르다(Google 계열 = Logan 식별자, Slack = team_id) — 호출자가 결정해 넘긴다. */
export async function storeChannelSecret(
  keychainService: string,
  account: string,
  secret: string,
): Promise<void> {
  await invoke("keychain_set", { service: keychainService, account, secret });
}
