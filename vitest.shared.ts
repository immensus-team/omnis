import { fileURLToPath } from "node:url";

/** 내부 패키지는 빌드 산출물이 아니라 소스 TS를 그대로 물린다. 프로덕션은 tsc --build의 dist를 쓴다. */
export const omnisAlias: Record<string, string> = {
  "@omnis/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
  "@omnis/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
  // Vite의 문자열 alias는 prefix 치환이다 — 서브패스 항목이 반드시 bare 항목보다 먼저 와야
  // "@omnis/kernel/zero"가 ".../src/index.ts/zero"로 깨지지 않는다.
  "@omnis/kernel/zero": fileURLToPath(
    new URL("./packages/kernel/src/zero-schema.ts", import.meta.url),
  ),
  "@omnis/kernel": fileURLToPath(new URL("./packages/kernel/src/index.ts", import.meta.url)),
};
