import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AdapterError, type Channel } from "@omnis/protocol";

const execFileAsync = promisify(execFile);

/** `security find-generic-password -s <service> -a <account> -w` 로 시크릿 값을 읽는다.
 *  값은 절대 로그로 찍지 않는다(A7 §9 로그 규약). Gmail/Outlook Task와 동일 패턴 —
 *  어댑터 패키지 간 import 금지라 복제한다(A7 §9 "의도된 중복"). */
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
