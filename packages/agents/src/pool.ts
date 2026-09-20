import type { Pool } from "pg";

export class AgentsNotConfiguredError extends Error {
  constructor() {
    super("configureAgents({ pool }) must be called before any loop runs");
    this.name = "AgentsNotConfiguredError";
  }
}

let poolRef: Pool | null = null;

/** The hub calls this once at boot. @omnis/agents cannot import @omnis/db (contract §1). */
export function configureAgents(deps: { pool: Pool }): void {
  poolRef = deps.pool;
}

export function getAgentsPool(): Pool {
  if (poolRef === null) throw new AgentsNotConfiguredError();
  return poolRef;
}

/** Test-only. Never call this from production code. */
export function resetAgentsPoolForTest(): void {
  poolRef = null;
}
