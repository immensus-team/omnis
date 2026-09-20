import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AdapterError, type Channel } from "@omnis/protocol";

const execFileAsync = promisify(execFile);

/** Reads the secret value with `security find-generic-password -s <service> -a <account> -w`.
 *  The value is never logged (A7 §9 logging rules). Same pattern as Slack Task 4 —
 *  duplicated because adapter packages must not import each other (Task 7). */
export async function readKeychainSecret(
  service: string,
  account: string,
  channel: Channel,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      account,
      "-w",
    ]);
    return stdout.trim();
  } catch (cause) {
    throw new AdapterError(
      "auth_expired",
      channel,
      `Keychain item ${service}/${account} not found or locked`,
      undefined,
      cause,
    );
  }
}
