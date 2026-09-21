// Jev (TypeSafe AI "System One") via Vercel AI Gateway — the decision tier's first provider.
// See docs/decisions/2026-09-21-jev-decision-tier.md for the API, pricing and safety rule.
//
// Adapter isolation (A7 §7, the rule src/t1/provider.ts and src/t2/provider.ts follow): the AI
// SDK import never leaves this file. The wire format is SDK-owned and undocumented as a public
// contract, so omnis calls `experimental_evaluate` rather than hand-rolling the request — the
// recorded shape (POST /v4/ai/evaluation-model) lives in the test fixture, not in our code.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGateway, experimental_evaluate as evaluate } from "ai";
import type {
  Decider,
  DecisionAnswer,
  DecisionRequest,
  DecisionResponse,
} from "../decision/types.js";
import { DeciderUnavailableError } from "../decision/types.js";

/** AI SDK `baseURL` default for the Gateway (ai-sdk.dev provider page). */
export const JEV_BASE_URL = "https://ai-gateway.vercel.sh/v4/ai";
/** Gateway model id. */
export const JEV_MODEL_ID = "typesafe-ai/jev-latest";
/** The value written to agent_runs.model (TypeSafe's own short id). */
export const JEV_RUN_MODEL = "jev-latest";
/** agent_runs.provider. Not in the original A4 §12.1 table — added with this spike. */
export const JEV_RUN_PROVIDER = "vercel-ai-gateway";
/** A6 §9 scheme (`omnis.<vendor>.<kind>`). */
export const JEV_KEYCHAIN_ITEM = "omnis.vercel.ai_gateway";
/** $/1M input tokens (vercel.com/ai-gateway/models/jev, fetched 2026-09-21). Jev bills no output. */
export const JEV_PRICE_IN_PER_MTOK = 0.042;
/** Matches the T1 loop wallClock in A4 §2.5 — a decision is worth no more patience than a classification. */
export const JEV_TIMEOUT_MS = 8_000;

const execFileAsync = promisify(execFile);

/** Reads a secret by service name. Existence-check callers in tools/auth-kit omit `-w`; here we need the value. */
export type KeychainReader = (service: string) => Promise<string | null>;

export const keychainRead: KeychainReader = async (service) => {
  try {
    // `-a` is omitted on purpose: it is optional, and the account is Logan's email, which has no
    // business being duplicated here. A missing item and a non-GUI session both land in the catch.
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      service,
      "-w",
    ]);
    const value = stdout.trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
};

/**
 * Env first (how launchd injects Keychain items for the hub, matching OMNIS_OPENROUTER_API_KEY),
 * Keychain second (a laptop dev session with no launchd). Never logged — callers see only presence.
 */
export async function jevApiKey(read: KeychainReader = keychainRead): Promise<string | null> {
  const env = process.env.OMNIS_AI_GATEWAY_API_KEY;
  if (env !== undefined && env !== "") return env;
  return read(JEV_KEYCHAIN_ITEM);
}

export interface JevOptions {
  apiKey?: string;
  /** Test seam: a stub HTTP layer. Production leaves this undefined and the SDK uses global fetch. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  keychain?: KeychainReader;
}

function toAnswer(a: {
  type: "choice" | "score" | "boolean";
  choice?: string;
  probability?: number;
  score?: number;
  probabilities?: Record<string, number>;
}): DecisionAnswer {
  return {
    type: a.type,
    ...(a.choice !== undefined ? { choice: a.choice } : {}),
    ...(a.probability !== undefined ? { probability: a.probability } : {}),
    ...(a.score !== undefined ? { score: a.score } : {}),
    ...(a.probabilities !== undefined ? { probabilities: a.probabilities } : {}),
  };
}

/** TypeSafe's per-question confidence lives under `providerMetadata.typesafe.confidence`. */
function confidenceOf(meta: Record<string, unknown> | undefined): Record<string, number> {
  const typesafe = meta?.typesafe;
  const confidence =
    typeof typesafe === "object" && typesafe !== null
      ? (typesafe as { confidence?: unknown }).confidence
      : undefined;
  if (typeof confidence !== "object" || confidence === null) return {};
  return Object.fromEntries(
    Object.entries(confidence as Record<string, unknown>).filter(
      (e): e is [string, number] => typeof e[1] === "number",
    ),
  );
}

export class JevDecider implements Decider {
  readonly run = { provider: JEV_RUN_PROVIDER, model: JEV_RUN_MODEL } as const;

  constructor(private readonly opts: JevOptions = {}) {}

  private async key(): Promise<string | null> {
    if (this.opts.apiKey !== undefined) return this.opts.apiKey === "" ? null : this.opts.apiKey;
    return jevApiKey(this.opts.keychain ?? keychainRead);
  }

  async available(): Promise<boolean> {
    return (await this.key()) !== null;
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    const apiKey = await this.key();
    if (apiKey === null) {
      throw new DeciderUnavailableError(
        `no Jev credential: set OMNIS_AI_GATEWAY_API_KEY or the Keychain item ${JEV_KEYCHAIN_ITEM}`,
      );
    }

    const gateway = createGateway({
      baseURL: JEV_BASE_URL,
      apiKey,
      ...(this.opts.fetch !== undefined ? { fetch: this.opts.fetch } : {}),
    });

    const started = Date.now();
    const res = await evaluate({
      model: gateway.evaluationModel(JEV_MODEL_ID),
      state: request.state,
      questions: request.questions,
      abortSignal: AbortSignal.timeout(this.opts.timeoutMs ?? JEV_TIMEOUT_MS),
      // Inbound mail is more sensitive than the average gateway payload, so this is not optional.
      providerOptions: { gateway: { zeroDataRetention: true } },
    });
    const latencyMs = Date.now() - started;

    const answers = Object.fromEntries(
      Object.entries(res.answers).map(([id, a]) => [id, toAnswer(a)]),
    );
    const tokensIn = res.usage.inputTokens ?? 0;
    const tokensOut = res.usage.outputTokens ?? 0;

    return {
      provider: this.run.provider,
      model: this.run.model,
      answers,
      confidence: confidenceOf(res.providerMetadata as Record<string, unknown> | undefined),
      latencyMs,
      tokensIn,
      tokensOut,
      // Jev's model page lists max output tokens as 0 — a decision bills input tokens only.
      costUsd: (tokensIn / 1_000_000) * JEV_PRICE_IN_PER_MTOK,
    };
  }
}
