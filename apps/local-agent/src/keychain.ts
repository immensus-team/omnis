import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const KEYCHAIN_ACCOUNT = "281932556+jinhologankim@users.noreply.github.com";

/** 값은 절대 로그·이벤트·에러 메시지에 싣지 않는다(A2 §7.2). */
export async function readKeychainSecret(
  item: string,
  account: string = KEYCHAIN_ACCOUNT,
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string }> = (cmd, args) => run(cmd, args),
): Promise<string> {
  const { stdout } = await exec("security", ["find-generic-password", "-s", item, "-a", account, "-w"]);
  const secret = stdout.trim();
  if (secret.length === 0) throw new Error(`keychain item is empty: ${item}`);
  return secret;
}
