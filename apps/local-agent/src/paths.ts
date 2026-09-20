import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { BRIDGE_ERRORS, BridgeError } from "@omnis/protocol";

/** A2-D12: 허브가 보낸 cwd는 브리지가 재검증한다. 심볼릭 링크는 realpath 후 재검사. */
export function assertPathAllowed(cwd: string, allowedRoots: string[]): string {
  let real: string;
  try {
    real = realpathSync(resolve(cwd));
  } catch {
    throw new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, `cwd does not exist: ${cwd}`, { cwd });
  }
  const ok = allowedRoots.some((root) => {
    let realRoot: string;
    try {
      realRoot = realpathSync(resolve(root));
    } catch {
      return false;
    }
    return real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
  });
  if (!ok)
    throw new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, `cwd outside allowed_roots: ${cwd}`, {
      cwd,
      allowedRoots,
    });
  return real;
}
