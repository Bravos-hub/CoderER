import {
  AiPolicySchema,
  AiProvider,
  InvestigationAgentKind,
  InvestigationStatus,
  type AiPolicy,
} from '@codeer/contracts';

export const AI_POLICY_VERSION = 'codeer-ai-policy-v1';
export const PROMPT_TEMPLATE_VERSION = 'codeer-investigation-prompts-v1';
export const DIAGNOSIS_SCHEMA_VERSION = 'codeer-diagnosis-v1';
export const TREATMENT_PLAN_SCHEMA_VERSION = 'codeer-treatment-plan-v1';

const terminalStatuses = new Set<InvestigationStatus>([
  InvestigationStatus.APPROVED,
  InvestigationStatus.REJECTED,
  InvestigationStatus.POLICY_BLOCKED,
  InvestigationStatus.INSUFFICIENT_EVIDENCE,
  InvestigationStatus.CANCELLED,
  InvestigationStatus.TIMED_OUT,
  InvestigationStatus.MODEL_FAILED,
  InvestigationStatus.TOOL_FAILED,
  InvestigationStatus.BUDGET_EXCEEDED,
  InvestigationStatus.SECURITY_REJECTED,
]);

const transitions: Readonly<Record<InvestigationStatus, readonly InvestigationStatus[]>> = {
  [InvestigationStatus.REQUESTED]: [
    InvestigationStatus.POLICY_CHECK,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.POLICY_CHECK]: [
    InvestigationStatus.CONTEXT_BUILDING,
    InvestigationStatus.POLICY_BLOCKED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.CONTEXT_BUILDING]: [
    InvestigationStatus.TRIAGE,
    InvestigationStatus.INSUFFICIENT_EVIDENCE,
    InvestigationStatus.TOOL_FAILED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.TRIAGE]: [
    InvestigationStatus.MAPPING,
    InvestigationStatus.MODEL_FAILED,
    InvestigationStatus.BUDGET_EXCEEDED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.MAPPING]: [
    InvestigationStatus.HYPOTHESIS,
    InvestigationStatus.MODEL_FAILED,
    InvestigationStatus.TOOL_FAILED,
    InvestigationStatus.BUDGET_EXCEEDED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.HYPOTHESIS]: [
    InvestigationStatus.VALIDATION,
    InvestigationStatus.INSUFFICIENT_EVIDENCE,
    InvestigationStatus.MODEL_FAILED,
    InvestigationStatus.BUDGET_EXCEEDED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.VALIDATION]: [
    InvestigationStatus.SECURITY_REVIEW,
    InvestigationStatus.INSUFFICIENT_EVIDENCE,
    InvestigationStatus.SECURITY_REJECTED,
    InvestigationStatus.MODEL_FAILED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.SECURITY_REVIEW]: [
    InvestigationStatus.PLAN_COMPOSITION,
    InvestigationStatus.SECURITY_REJECTED,
    InvestigationStatus.MODEL_FAILED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.PLAN_COMPOSITION]: [
    InvestigationStatus.CRITIC_REVIEW,
    InvestigationStatus.MODEL_FAILED,
    InvestigationStatus.BUDGET_EXCEEDED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.CRITIC_REVIEW]: [
    InvestigationStatus.AWAITING_APPROVAL,
    InvestigationStatus.REVISION_REQUESTED,
    InvestigationStatus.SECURITY_REJECTED,
    InvestigationStatus.MODEL_FAILED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.AWAITING_APPROVAL]: [
    InvestigationStatus.APPROVED,
    InvestigationStatus.REJECTED,
    InvestigationStatus.REVISION_REQUESTED,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.REVISION_REQUESTED]: [
    InvestigationStatus.PLAN_COMPOSITION,
    InvestigationStatus.CANCELLED,
  ],
  [InvestigationStatus.APPROVED]: [],
  [InvestigationStatus.REJECTED]: [],
  [InvestigationStatus.POLICY_BLOCKED]: [],
  [InvestigationStatus.INSUFFICIENT_EVIDENCE]: [InvestigationStatus.CONTEXT_BUILDING],
  [InvestigationStatus.CANCELLED]: [],
  [InvestigationStatus.TIMED_OUT]: [InvestigationStatus.POLICY_CHECK],
  [InvestigationStatus.MODEL_FAILED]: [InvestigationStatus.POLICY_CHECK],
  [InvestigationStatus.TOOL_FAILED]: [InvestigationStatus.CONTEXT_BUILDING],
  [InvestigationStatus.BUDGET_EXCEEDED]: [],
  [InvestigationStatus.SECURITY_REJECTED]: [],
};

export const agentToolAllowlist: Readonly<Record<InvestigationAgentKind, readonly string[]>> = {
  [InvestigationAgentKind.TRIAGE]: [
    'incident.get_evidence',
    'incident.get_timeline',
    'reproduction.get_result',
  ],
  [InvestigationAgentKind.REPOSITORY_MAPPER]: [
    'repository.get_manifest',
    'repository.list_tree',
    'repository.search_text',
    'repository.get_config_summary',
  ],
  [InvestigationAgentKind.ROOT_CAUSE_INVESTIGATOR]: [
    'repository.read_file_range',
    'repository.search_text',
    'reproduction.get_result',
    'reproduction.get_log_chunks',
    'health.get_latest_snapshot',
  ],
  [InvestigationAgentKind.CONTRACT_ANALYST]: [
    'repository.read_file_range',
    'repository.search_text',
    'repository.get_dependency_graph',
    'repository.get_config_summary',
  ],
  [InvestigationAgentKind.SECURITY_REVIEWER]: [
    'repository.read_file_range',
    'repository.search_text',
    'incident.get_evidence',
    'reproduction.get_artifact_manifest',
  ],
  [InvestigationAgentKind.PLAN_COMPOSER]: [
    'repository.read_file_range',
    'health.get_latest_snapshot',
  ],
  [InvestigationAgentKind.INDEPENDENT_CRITIC]: [
    'incident.get_evidence',
    'incident.get_timeline',
    'reproduction.get_result',
    'repository.read_file_range',
  ],
};

export function defaultAiPolicy(models: readonly string[]): AiPolicy {
  const [primary] = models;
  if (!primary) throw new Error('At least one approved model is required.');
  return AiPolicySchema.parse({
    provider: AiProvider.OPENAI,
    allowedModels: [...models],
    modelByAgent: Object.fromEntries(
      Object.values(InvestigationAgentKind).map((agent) => [agent, primary]),
    ),
    allowedTools: [...new Set(Object.values(agentToolAllowlist).flat())],
    maximumConcurrentInvestigations: 4,
    maximumModelInvocations: 20,
    maximumToolCalls: 100,
    maximumInputTokens: 200_000,
    maximumOutputTokens: 30_000,
    maximumCostUsd: 25,
    timeoutMs: 45 * 60 * 1000,
    retentionDays: 30,
    requireHumanApproval: true,
    requireIndependentCritic: true,
    requireSecurityReview: true,
    storeProviderResponses: false,
    policyVersion: AI_POLICY_VERSION,
  });
}

export function assertInvestigationTransition(
  current: InvestigationStatus,
  next: InvestigationStatus,
): void {
  if (current === next) return;
  if (!transitions[current].includes(next)) {
    throw new Error(`Investigation transition ${current} -> ${next} is not permitted.`);
  }
}

export function isTerminalInvestigationStatus(status: InvestigationStatus): boolean {
  return terminalStatuses.has(status);
}

export function assertAgentToolAllowed(
  policy: AiPolicy,
  agent: InvestigationAgentKind,
  toolName: string,
): void {
  if (!policy.allowedTools.includes(toolName) || !agentToolAllowlist[agent].includes(toolName)) {
    throw new Error(`Tool ${toolName} is not authorized for ${agent}.`);
  }
}

export function assertModelAllowed(
  policy: AiPolicy,
  agent: InvestigationAgentKind,
  model: string,
): void {
  if (!policy.allowedModels.includes(model) || policy.modelByAgent[agent] !== model) {
    throw new Error(`Model ${model} is not authorized for ${agent}.`);
  }
}
