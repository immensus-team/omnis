import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { BRIDGE_ERRORS, BridgeError } from "@omnis/protocol";

/** A2-D12: the bridge re-validates the cwd the hub sent. Symlinks are re-checked after realpath. */
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
