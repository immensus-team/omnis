import { SETTING_DEFAULTS, type SettingKey } from "@omnis/kernel";

// Guard for the `:key` path param on PUT /settings/:key — is this string a real SettingKey?
const SETTING_KEYS = new Set<string>(Object.keys(SETTING_DEFAULTS));

export function isValidSettingKey(key: string): key is SettingKey {
  return SETTING_KEYS.has(key);
}
