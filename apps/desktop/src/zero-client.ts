import { zeroSchema } from "@omnis/kernel/zero";
import { Zero } from "@rocicorp/zero";

export function initZero(opts?: { server?: string; userID?: string }) {
  return new Zero({
    server: opts?.server ?? import.meta.env.OMNIS_ZERO_URL ?? "http://127.0.0.1:4848",
    userID: opts?.userID ?? "logan",
    schema: zeroSchema,
  });
}
