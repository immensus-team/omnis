import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AdapterError, type Channel } from "@omnis/protocol";

const execFileAsync = promisify(execFile);

/** Reads the secret value with `security find-generic-password -s <service> -w`. `-a` is omitted on
 *  purpose: the account is only a human label, so an item stamped with any account still resolves.
 *  The value is never logged (A7 §9 logging rules). */
export async function readKeychainSecret(service: string, channel: Channel): Promise<string> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      service,
      "-w",
    ]);
    return stdout.trim();
  } catch (cause) {
    throw new AdapterError(
      "auth_expired",
      channel,
      `Keychain item ${service} not found or locked`,
      undefined,
      cause,
    );
  }
}
