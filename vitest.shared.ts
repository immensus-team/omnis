import { fileURLToPath } from "node:url";

/** 내부 패키지는 빌드 산출물이 아니라 소스 TS를 그대로 물린다. 프로덕션은 tsc --build의 dist를 쓴다. */
export const omnisAlias: Record<string, string> = {
  "@omnis/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
  "@omnis/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
  "@omnis/kernel": fileURLToPath(new URL("./packages/kernel/src/index.ts", import.meta.url)),
};
