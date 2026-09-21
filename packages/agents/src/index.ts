export { configureAgents, getAgentsPool, AgentsNotConfiguredError } from "./pool.js";
export { recordRun, finishRun, type RecordRunInput } from "./record-run.js";
export {
  SYSTEM_ACCOUNT_EXTERNAL_ID,
  SYSTEM_THREAD_EXTERNAL_ID,
  writeSystemItem,
  type SystemItemInput,
} from "./system-item.js";
export type { ItemRow } from "./types.js";
export { classify, ClassifyOutput, type ClassifyResult, type ClassifyCtx } from "./classify.js";
export { applyRules, WORK_DOMAINS, DETERMINISTIC_RULES, type RuleHit } from "./classify/rules.js";
export { knnVote, KNN_K, KNN_MARGIN_MIN, KNN_SIM_MIN, type KnnVerdict } from "./classify/knn.js";
export { classifyWithT1, T1ClassifyOutput, SchemaViolationError } from "./t1/classify-t1.js";
export { T1_BASE_URL, T1_MODEL_ID, T1_RUN_MODEL, t1Model } from "./t1/provider.js";
export { sensitivityFor, pickSensitivity, SENSITIVITY_PRIORITY } from "./sensitivity.js";
export { summarizeThread, type SummarizeThreadResult } from "./summarize.js";
export { summarizeWithT1, T1SummaryOutput } from "./t1/summarize-t1.js";
export {
  INJECTION_FLAGS,
  NORMALIZE_MAX_CHARS,
  newNonce,
  normalizeExternal,
  scanInjection,
  wrapData,
} from "./context/normalize.js";
export {
  buildContext,
  setContextBudget,
  CONTEXT_INPUT_BUDGET_TOKENS,
  type ContextRequest,
  type DataBlock,
  type AssembledContext,
} from "./context/assemble.js";
export {
  LoopBudgetError,
  PhantomToolError,
  type LoopBudget,
  type LoopId,
  type LoopKind,
  type LoopSkip,
  type LoopResult,
  type LoopSpec,
  type LoopTrigger,
  type TriggerContext,
} from "./loop/spec.js";
export { getLoop, listLoops, registerLoop, resetLoopRegistryForTest } from "./loop/registry.js";
export { LOOP_JOB_NAME, startLoops, type LoopKernel, type LoopLogger } from "./loop/start.js";
export {
  FAILURE_LIMIT,
  FAILURE_WINDOW_HOURS,
  QUARANTINE_HOURS,
  runLoop,
  runLoopSpec,
} from "./loop/run.js";
export { T2_BASE_URL, T2_MODEL_ID, T2_RUN_MODEL } from "./t2/provider.js";
export {
  DeciderUnavailableError,
  choiceOf,
  probabilityOf,
  type DecisionAnswer,
  type DecisionKind,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionResponse,
  type Decider,
} from "./decision/types.js";
export { itemState, personState, threadTail } from "./decision/state.js";
export {
  HOST_OPTIONS,
  PRIORITY_OPTIONS,
  QUESTION,
  RUNTIME_OPTIONS,
  SCOPE_OPTIONS,
  SENSITIVITY_OPTIONS,
  autoArchiveRequest,
  classifyRequest,
  delegationRequest,
  draftWorthinessRequest,
  followupRequest,
  sensitivityRequest,
} from "./decision/decisions.js";
export {
  DECISION_PROVIDER_KEY,
  DEFAULT_DECISION_PROVIDER,
  activeDecisionProvider,
  decideOrNull,
  parseDecisionProvider,
  type DecisionOptions,
  type DecisionProvider,
} from "./decision/router.js";
export {
  JEV_BASE_URL,
  JEV_KEYCHAIN_ITEM,
  JEV_MODEL_ID,
  JEV_PRICE_IN_PER_MTOK,
  JEV_RUN_MODEL,
  JEV_RUN_PROVIDER,
  JEV_TIMEOUT_MS,
  JevDecider,
  type JevOptions,
  type KeychainReader,
  jevApiKey,
  keychainRead,
} from "./providers/jev.js";
export { PHANTOM_TOOLS, TOOL_NAMES, type ToolName } from "./tools/names.js";
export { READ_TOOLS } from "./tools/read.js";
export {
  PROPOSE_TOOLS,
  ProposeDelegationInput,
  ProposeDraftInput,
  ProposeLabelInput,
  ProposeRouteInput,
  ProposeSelfModelPatchInput,
  ProposeTaskInput,
} from "./tools/propose.js";
export { toolRegistry } from "./tools/registry.js";
export {
  CHANNEL_DRAFT_SHAPE,
  NEEDS_REPLY_MIN,
  needsReplyScore,
  pickRegister,
  type DraftShape,
  type Register,
} from "./draft/register.js";
export { SELF_CHECK_ITEMS, selfCheck, type SelfCheckCtx } from "./draft/selfcheck.js";
export {
  DELEGATION_DAILY_CAP,
  DELEGATION_THREAD_CAP_24H,
  MACBOOK_OFFLINE_MS,
  extractHints,
  hostHealth,
  pickRuntime,
  routeByRule,
  type DelegationHints,
  type DelegationRuntime,
  type HostHealth,
  type Routing,
} from "./delegate/route.js";
export {
  DELEGATION_JEV_MIN,
  TASK_CONFIDENCE_MIN,
  TASK_MAX_PER_ITEM,
  TaskOutput,
  routeDelegation,
  taskLoop,
  type TaskOutputT,
} from "./loops/task.js";
export { renderBrief, type BriefInput } from "./delegate/brief.js";
export {
  AUTONOMY_MAX_MINUTES,
  DelegateOutput,
  autonomyAllows,
  delegateLoop,
  type AutonomyRule,
  type DelegateOutputT,
} from "./loops/delegate.js";
export {
  DRAFT_PLACEHOLDER_MS,
  DRAFT_SLA_MS,
  DRAFT_WORTHINESS_VETO_BELOW,
  DraftOutput,
  draftLoop,
  shouldEscalate,
  writePlaceholderDraft,
  type DraftOutputT,
} from "./loops/draft.js";
export {
  ROUTE_CONFIDENCE_HIGH,
  ROUTE_CONFIDENCE_MIN,
  RouteOutput,
  noteRouteLoop,
  type RouteOutputT,
} from "./loops/note-route.js";
export {
  FOLLOWUP_VETO_BELOW,
  FollowupOutput,
  INACTIVE_SWEEP_LIMIT,
  NO_COLD_OUTREACH_CHANNELS,
  followupLoop,
  inactiveCandidates,
  isFirstContact,
  pickFollowupChannel,
  sweepFollowups,
  type FollowupOutputT,
  type InactiveCandidate,
} from "./loops/followup.js";
export {
  AUTO_ARCHIVE_RULES,
  AutoArchiveOutput,
  T1_ARCHIVE_CONFIDENCE_MIN,
  autoArchiveLoop,
  hardGate,
  nonHumanSender,
  sweepAutoArchive,
  type AutoArchiveOutputT,
  type HardGateResult,
} from "./loops/auto-archive.js";
export {
  SECTION_CAPS,
  rankBriefItems,
  type BriefCandidate,
  type BriefItem,
  type BriefSection,
  type BriefSectionId,
  type MorningBriefing,
} from "./digest/rank.js";
export {
  MORNING_DIGEST_CRON,
  MorningDigestOutput,
  morningCandidates,
  morningDigestLoop,
  type MorningDigestOutputT,
} from "./loops/digest-morning.js";
export {
  NIGHTLY_DIGEST_CRON,
  NightlyDigestOutput,
  digestIdFor,
  nightlyDigestLoop,
  nightlyGroups,
  undoTokenFor,
  type DigestGroup,
  type NightlyDigest,
  type NightlyDigestOutputT,
} from "./loops/digest-nightly.js";
export {
  ANTHROPIC_BATCH_MODEL,
  ANTHROPIC_BATCH_URL,
  MEMORY_CONSOLIDATE_CRON,
  MEMORY_HARVEST_CRON,
  harvestConsolidation,
  submitConsolidation,
  type ConsolidationRequest,
  type ConsolidationResult,
} from "./memory/consolidate.js";
export {
  MAX_PATCHES,
  MAX_PATCH_LINES,
  SELF_MODEL_CRON,
  SUPPRESSION_WEEKS,
  diffHash,
  isSuppressed,
  proposeSelfModelPatches,
  suppressPatch,
  validatePatch,
  type SelfModelPatch,
} from "./self-model/propose.js";
