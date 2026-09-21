import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
/** A6 §9: the account every omnis item is stamped with on write. Reads do not filter on it (below). */
export const KEYCHAIN_ACCOUNT = "omnis";

/** The value is never carried in logs, events or error messages (A2 §7.2).
 *  Lookup is by **service name only** — `-a` is deliberately omitted, so an item stored under any
 *  account (including the personal label older installs used) still resolves. */
export async function readKeychainSecret(
  item: string,
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string }> = (cmd, args) =>
    run(cmd, args),
): Promise<string> {
  const { stdout } = await exec("security", ["find-generic-password", "-s", item, "-w"]);
  const secret = stdout.trim();
  if (secret.length === 0) throw new Error(`keychain item is empty: ${item}`);
  return secret;
}
