import type { Pool } from "pg";

export class AgentsNotConfiguredError extends Error {
  constructor() {
    super("configureAgents({ pool }) must be called before any loop runs");
    this.name = "AgentsNotConfiguredError";
  }
}

let poolRef: Pool | null = null;

/** 허브가 부팅 때 한 번 호출한다. @omnis/agents는 @omnis/db를 import할 수 없다(계약 §1). */
export function configureAgents(deps: { pool: Pool }): void {
  poolRef = deps.pool;
}

export function getAgentsPool(): Pool {
  if (poolRef === null) throw new AgentsNotConfiguredError();
  return poolRef;
}

/** 테스트 전용. 프로덕션 코드에서 호출하지 않는다. */
export function resetAgentsPoolForTest(): void {
  poolRef = null;
}
