import { randomUUID } from 'node:crypto';
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  AgentFindingDraftSchema,
  CriticReviewDraftSchema,
  DIAGNOSIS_SCHEMA_VERSION,
  DiagnosisDraftSchema,
  OpenAIResponsesGateway,
  PROMPT_TEMPLATE_VERSION,
  ReadOnlyToolGateway,
  SecurityReviewDraftSchema,
  TREATMENT_PLAN_SCHEMA_VERSION,
  TreatmentPlanDraftSchema,
  agentFindingJsonSchema,
  buildInvestigationContext,
  contextAsUntrustedEvidenceBlock,
  criticReviewJsonSchema,
  diagnosisDraftJsonSchema,
  investigationInstructions,
  securityReviewJsonSchema,
  treatmentPlanDraftJsonSchema,
  validateCitations,
  validateDiagnosisGrounding,
  validateTreatmentPlanGrounding,
  type ContextSource,
  type InvestigationContextPackage,
  type ModelGateway,
  type StructuredModelResult,
} from '@codeer/ai';
import type { WorkerConfig } from '@codeer/config';
import {
  AgentRunStatus,
  CitationSourceType,
  GuardrailOutcome,
  INVESTIGATION_JOB,
  INVESTIGATION_QUEUE,
  InvestigationAgentKind,
  InvestigationJobSchema,
  InvestigationStatus,
  ModelInvocationStatus,
  TreatmentPlanStatus,
  type Diagnosis,
  type InvestigationJob,
  type InvestigationCitation,
  type TreatmentPlan,
} from '@codeer/contracts';
import { InvestigationStore } from '@codeer/database';
import { digestPayload } from '@codeer/incidents';
import { logger } from '@codeer/logger';
import {
  RepositoryReadOnlyInspector,
  deterministicRepositorySourceId,
  type RepositoryFileRange,
} from '@codeer/repository';
import { sha256Hex } from '@codeer/security';

interface InvestigationRuntimeOptions {
  config: WorkerConfig;
  connection: ConnectionOptions;
  workerId: string;
  store?: InvestigationStore;
  modelGateway?: ModelGateway;
}

interface AgentExecution<T> {
  output: T;
  result: StructuredModelResult<T>;
  agentRunId: string;
}

const stageByAgent: Readonly<Record<InvestigationAgentKind, InvestigationStatus>> = {
  [InvestigationAgentKind.TRIAGE]: InvestigationStatus.TRIAGE,
  [InvestigationAgentKind.REPOSITORY_MAPPER]: InvestigationStatus.MAPPING,
  [InvestigationAgentKind.ROOT_CAUSE_INVESTIGATOR]: InvestigationStatus.HYPOTHESIS,
  [InvestigationAgentKind.CONTRACT_ANALYST]: InvestigationStatus.VALIDATION,
  [InvestigationAgentKind.SECURITY_REVIEWER]: InvestigationStatus.SECURITY_REVIEW,
  [InvestigationAgentKind.PLAN_COMPOSER]: InvestigationStatus.PLAN_COMPOSITION,
  [InvestigationAgentKind.INDEPENDENT_CRITIC]: InvestigationStatus.CRITIC_REVIEW,
};

function safeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : 'Unknown investigation failure.';
  if (/budget/i.test(message))
    return { code: 'AI_BUDGET_EXCEEDED', message: message.slice(0, 2_000) };
  if (/citation|grounding|guardrail|security/i.test(message))
    return { code: 'AI_SECURITY_REJECTED', message: message.slice(0, 2_000) };
  if (/tool|worktree|repository path|symlink|travers/i.test(message))
    return { code: 'AI_TOOL_FAILED', message: message.slice(0, 2_000) };
  if (/abort|timeout/i.test(message))
    return { code: 'AI_TIMED_OUT', message: message.slice(0, 2_000) };
  return { code: 'AI_MODEL_FAILED', message: message.slice(0, 2_000) };
}

function statusForError(code: string): InvestigationStatus {
  if (code === 'AI_BUDGET_EXCEEDED') return InvestigationStatus.BUDGET_EXCEEDED;
  if (code === 'AI_SECURITY_REJECTED') return InvestigationStatus.SECURITY_REJECTED;
  if (code === 'AI_TOOL_FAILED') return InvestigationStatus.TOOL_FAILED;
  if (code === 'AI_TIMED_OUT') return InvestigationStatus.TIMED_OUT;
  return InvestigationStatus.MODEL_FAILED;
}

function modelGateway(config: WorkerConfig): ModelGateway {
  if (!config.OPENAI_API_KEY) {
    return {
      generateStructured() {
        return Promise.reject(
          new Error('OpenAI provider credentials are not configured for the investigation worker.'),
        );
      },
      cancel() {
        return Promise.resolve();
      },
    };
  }
  return new OpenAIResponsesGateway({
    apiKey: config.OPENAI_API_KEY,
    baseUrl: config.OPENAI_BASE_URL,
    ...(config.OPENAI_ORGANIZATION ? { organization: config.OPENAI_ORGANIZATION } : {}),
    ...(config.OPENAI_PROJECT ? { project: config.OPENAI_PROJECT } : {}),
  });
}

function citationFromFile(file: RepositoryFileRange, label?: string): InvestigationCitation {
  return {
    sourceType: CitationSourceType.REPOSITORY_FILE,
    sourceId: file.sourceId,
    digest: file.digest,
    path: file.path,
    lineStart: file.lineStart,
    lineEnd: file.lineEnd,
    label: label ?? file.path,
    excerpt: file.content.slice(0, 2_000),
  };
}

function sourcesFromToolOutput(toolName: string, output: unknown): ContextSource[] {
  const sources: ContextSource[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (
      typeof record.sourceId === 'string' &&
      typeof record.path === 'string' &&
      typeof record.digest === 'string' &&
      typeof record.content === 'string'
    ) {
      sources.push({
        sourceType: CitationSourceType.REPOSITORY_FILE,
        sourceId: record.sourceId,
        label: `${toolName}: ${record.path}`,
        digest: record.digest,
        content: record.content,
        path: record.path,
        ...(typeof record.lineStart === 'number' ? { lineStart: record.lineStart } : {}),
        ...(typeof record.lineEnd === 'number' ? { lineEnd: record.lineEnd } : {}),
      });
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(output);
  if (sources.length === 0) {
    const serialized = JSON.stringify(output);
    sources.push({
      sourceType: CitationSourceType.REPOSITORY_FILE,
      sourceId: deterministicRepositorySourceId(`tool-output:${toolName}:${sha256Hex(serialized)}`),
      label: `${toolName} result`,
      digest: sha256Hex(serialized),
      content: output,
    });
  }
  return sources;
}

function approximateInputTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, 'utf8') / 4);
}

function boundedInput(value: string, maximumTokens: number): string {
  const maximumBytes = Math.max(4_096, maximumTokens * 4);
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maximumBytes) return value;
  return `${bytes.subarray(0, maximumBytes - 64).toString('utf8')}\n[MODEL INPUT TRUNCATED BY POLICY]`;
}

export function createInvestigationWorker(options: InvestigationRuntimeOptions): {
  worker: Worker;
  reconcile(): Promise<void>;
  close(): Promise<void>;
} {
  const { config, connection, workerId } = options;
  const store = options.store ?? new InvestigationStore();
  const gateway = options.modelGateway ?? modelGateway(config);
  const inspector = new RepositoryReadOnlyInspector(config.REPOSITORY_WORKSPACE_ROOT);

  const worker = new Worker(
    INVESTIGATION_QUEUE,
    async (job: Job) => {
      if (job.name !== INVESTIGATION_JOB)
        throw new Error(`Unsupported investigation job: ${job.name}`);
      const payload = InvestigationJobSchema.parse(job.data);
      return await processInvestigation(payload, job);
    },
    { connection, concurrency: config.AI_INVESTIGATION_CONCURRENCY },
  );

  async function processInvestigation(payload: InvestigationJob, job: Job): Promise<unknown> {
    const leaseSeconds = Math.ceil(config.AI_INVESTIGATION_LEASE_MS / 1_000);
    const envelope = await store.acquireLease(payload.investigationId, workerId, leaseSeconds);
    if (!envelope) return { skipped: true, reason: 'lease-not-acquired' };
    let heartbeatFailure: Error | null = null;
    const heartbeat = setInterval(
      () => {
        void store
          .heartbeat(envelope.organizationId, envelope.id, workerId, leaseSeconds)
          .then(({ cancellationRequested }) => {
            if (cancellationRequested)
              heartbeatFailure = new Error('Investigation cancellation was requested.');
          })
          .catch((error: unknown) => {
            heartbeatFailure =
              error instanceof Error ? error : new Error('Investigation lease heartbeat failed.');
          });
      },
      Math.max(5_000, Math.floor(config.AI_INVESTIGATION_LEASE_MS / 3)),
    );
    heartbeat.unref();

    const usage = { invocations: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, costUsd: 0 };
    let context: InvestigationContextPackage | null = null;
    const allSources: ContextSource[] = [];
    const agentSummaries: string[] = [];
    try {
      const checkControl = async (): Promise<void> => {
        if (heartbeatFailure) throw heartbeatFailure;
        const state = await store.heartbeat(
          envelope.organizationId,
          envelope.id,
          workerId,
          leaseSeconds,
        );
        if (state.cancellationRequested)
          throw new Error('Investigation cancellation was requested.');
      };

      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        InvestigationStatus.POLICY_CHECK,
        {
          provider: envelope.policy.provider,
          models: envelope.policy.allowedModels,
          requireHumanApproval: envelope.policy.requireHumanApproval,
        },
        'POLICY_CHECK_COMPLETED',
      );
      await job.updateProgress({ stage: InvestigationStatus.POLICY_CHECK, percent: 5 });
      await checkControl();

      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        InvestigationStatus.CONTEXT_BUILDING,
        {},
        'CONTEXT_BUILDING_STARTED',
      );
      const bundle = await store.loadInvestigationSources(envelope.organizationId, envelope.id);
      allSources.push(...bundle.sources);
      const worktree = await inspector.resolveWorktree(bundle.worktreeRelativePath);
      const tools = buildToolGateway(bundle, worktree, inspector);

      const runTool = async (
        agentKind: InvestigationAgentKind,
        agentRunId: string,
        name: string,
        input: Record<string, unknown>,
      ): Promise<unknown> => {
        await checkControl();
        if (usage.toolCalls >= envelope.policy.maximumToolCalls)
          throw new Error('AI tool-call budget exceeded.');
        usage.toolCalls += 1;
        try {
          const result = await tools.execute(
            envelope.policy,
            {
              organizationId: envelope.organizationId,
              incidentId: envelope.incidentId,
              investigationId: envelope.id,
              agentKind,
              correlationId: payload.correlationId,
              leaseOwner: workerId,
            },
            name,
            input,
          );
          await store.recordToolCall({
            organizationId: envelope.organizationId,
            investigationId: envelope.id,
            workerId,
            agentRunId,
            audit: result.audit,
            inputSummary: input,
            outputSummary: result.output,
          });
          allSources.push(...sourcesFromToolOutput(name, result.output));
          return result.output;
        } catch (error) {
          const audit = (error as { audit?: unknown }).audit;
          if (audit) {
            await store.recordToolCall({
              organizationId: envelope.organizationId,
              investigationId: envelope.id,
              workerId,
              agentRunId,
              audit: audit as never,
              inputSummary: input,
            });
          }
          throw error;
        }
      };

      const preliminary = buildInvestigationContext(allSources, {
        maximumItems: envelope.policy.maximumToolCalls + config.AI_MAX_CONTEXT_ITEMS,
        maximumBytes: config.AI_MAX_CONTEXT_BYTES,
        maximumItemBytes: config.AI_MAX_CONTEXT_ITEM_BYTES,
      });
      if (preliminary.items.length < 2)
        throw new Error('Insufficient evidence is available to start investigation.');
      context = preliminary;
      await store.recordContextPackage(
        envelope.organizationId,
        envelope.id,
        workerId,
        context,
        envelope.policy.retentionDays,
      );
      const suspicious = context.items.reduce(
        (sum, item) => sum + item.suspiciousInstructionCount,
        0,
      );
      await store.recordGuardrail({
        organizationId: envelope.organizationId,
        investigationId: envelope.id,
        workerId,
        category: 'UNTRUSTED_EVIDENCE_INSTRUCTIONS',
        outcome: suspicious > 0 ? GuardrailOutcome.REVIEW : GuardrailOutcome.ALLOW,
        reason:
          suspicious > 0
            ? 'Instruction-like content was isolated as evidence and not executed.'
            : 'No instruction-like evidence patterns detected.',
        policyVersion: envelope.policy.policyVersion,
        inputHash: context.contentHash,
        details: {
          suspiciousInstructionCount: suspicious,
          redactionCount: context.items.reduce((sum, item) => sum + item.redactionCount, 0),
        },
      });
      await job.updateProgress({ stage: InvestigationStatus.CONTEXT_BUILDING, percent: 15 });

      const executeAgent = async <T>(
        agent: InvestigationAgentKind,
        schemaName: string,
        validator: Parameters<ModelGateway['generateStructured']>[0]['validator'],
        schema: Record<string, unknown>,
        task: string,
        toolRequests: Array<{ name: string; input: Record<string, unknown> }> = [],
      ): Promise<AgentExecution<T>> => {
        await checkControl();
        const model = envelope.policy.modelByAgent[agent];
        if (!model || !envelope.policy.allowedModels.includes(model))
          throw new Error(`Model policy rejected ${agent}.`);
        if (usage.invocations >= envelope.policy.maximumModelInvocations) {
          throw new Error('AI model invocation budget exceeded.');
        }
        if (envelope.policy.maximumOutputTokens - usage.outputTokens < 256) {
          throw new Error('AI output token budget exceeded.');
        }
        const stage = stageByAgent[agent];
        await store.checkpoint(
          envelope.organizationId,
          envelope.id,
          workerId,
          stage,
          { agent, model },
          `${agent}_STARTED`,
        );
        context = buildInvestigationContext(allSources, {
          maximumItems: config.AI_MAX_CONTEXT_ITEMS,
          maximumBytes: config.AI_MAX_CONTEXT_BYTES,
          maximumItemBytes: config.AI_MAX_CONTEXT_ITEM_BYTES,
        });
        const input = boundedInput(
          [
            `INCIDENT ${envelope.incidentId}`,
            `REPOSITORY ${bundle.repositoryFullName}`,
            `FOCUS AREAS ${JSON.stringify(envelope.input.focusAreas)}`,
            envelope.input.additionalContext
              ? `USER CONTEXT (untrusted): ${envelope.input.additionalContext}`
              : '',
            `TASK ${task}`,
            agentSummaries.length
              ? `PRIOR AGENT SUMMARIES (untrusted advisory):\n${agentSummaries.join('\n---\n')}`
              : '',
            contextAsUntrustedEvidenceBlock(context),
          ]
            .filter(Boolean)
            .join('\n\n'),
          Math.max(1_000, envelope.policy.maximumInputTokens - usage.inputTokens),
        );
        const inputHash = sha256Hex(input);
        const started = await store.startAgentRun({
          organizationId: envelope.organizationId,
          investigationId: envelope.id,
          workerId,
          agentKind: agent,
          model,
          promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
          inputHash,
        });
        for (const request of toolRequests)
          await runTool(agent, started.agentRunId, request.name, request.input);
        context = buildInvestigationContext(allSources, {
          maximumItems: config.AI_MAX_CONTEXT_ITEMS,
          maximumBytes: config.AI_MAX_CONTEXT_BYTES,
          maximumItemBytes: config.AI_MAX_CONTEXT_ITEM_BYTES,
        });
        const finalInput = boundedInput(
          `${input}\n\n${contextAsUntrustedEvidenceBlock(context)}`,
          Math.max(1_000, envelope.policy.maximumInputTokens - usage.inputTokens),
        );
        usage.invocations += 1;
        try {
          const result = await gateway.generateStructured<T>({
            provider: envelope.policy.provider,
            model,
            agent,
            instructions: investigationInstructions(agent),
            input: finalInput,
            schemaName,
            schema,
            validator: validator as never,
            maximumOutputTokens: Math.min(
              8_000,
              Math.max(256, envelope.policy.maximumOutputTokens - usage.outputTokens),
            ),
            timeoutMs: Math.min(envelope.policy.timeoutMs, config.AI_TIMEOUT_MS),
            metadata: {
              investigation_id: envelope.id,
              incident_id: envelope.incidentId,
              agent: agent.toLowerCase(),
              policy_version: envelope.policy.policyVersion,
            },
            safetyIdentifier: sha256Hex(`${envelope.organizationId}:${envelope.requestedBy}`).slice(
              0,
              64,
            ),
            store: envelope.policy.storeProviderResponses,
          });
          usage.inputTokens += result.usage.inputTokens || approximateInputTokens(finalInput);
          usage.outputTokens += result.usage.outputTokens;
          const pricing = config.AI_MODEL_PRICING_JSON[result.model];
          if (config.NODE_ENV === 'production' && !pricing)
            throw new Error(`AI budget pricing is not configured for ${result.model}.`);
          const invocationCost = pricing
            ? ((result.usage.inputTokens - result.usage.cachedInputTokens) *
                pricing.inputUsdPerMillion +
                result.usage.cachedInputTokens * pricing.cachedInputUsdPerMillion +
                result.usage.outputTokens * pricing.outputUsdPerMillion) /
              1_000_000
            : 0;
          usage.costUsd += invocationCost;
          if (
            usage.inputTokens > envelope.policy.maximumInputTokens ||
            usage.outputTokens > envelope.policy.maximumOutputTokens
          )
            throw new Error('AI token budget exceeded.');
          if (usage.costUsd > envelope.policy.maximumCostUsd)
            throw new Error('AI cost budget exceeded.');
          await store.recordModelInvocation({
            organizationId: envelope.organizationId,
            investigationId: envelope.id,
            workerId,
            agentRunId: started.agentRunId,
            model,
            status: ModelInvocationStatus.COMPLETED,
            providerRequestId: result.providerRequestId,
            providerResponseId: result.providerResponseId,
            instructionsHash: sha256Hex(investigationInstructions(agent)),
            inputHash: sha256Hex(finalInput),
            outputHash: result.outputHash,
            schemaName,
            schemaVersion: 'v1',
            usage: result.usage,
            estimatedCostUsd: invocationCost,
            durationMs: result.durationMs,
          });
          const summary = JSON.stringify(result.output).slice(0, 8_000);
          await store.finishAgentRun({
            organizationId: envelope.organizationId,
            investigationId: envelope.id,
            workerId,
            agentRunId: started.agentRunId,
            status: AgentRunStatus.COMPLETED,
            outputHash: result.outputHash,
            summary,
          });
          agentSummaries.push(`${agent}: ${summary}`);
          return { output: result.output, result, agentRunId: started.agentRunId };
        } catch (error) {
          await store.recordModelInvocation({
            organizationId: envelope.organizationId,
            investigationId: envelope.id,
            workerId,
            agentRunId: started.agentRunId,
            model,
            status: ModelInvocationStatus.FAILED,
            instructionsHash: sha256Hex(investigationInstructions(agent)),
            inputHash: sha256Hex(finalInput),
            schemaName,
            schemaVersion: 'v1',
            errorCode: safeError(error).code,
            errorMessage: safeError(error).message,
          });
          await store.finishAgentRun({
            organizationId: envelope.organizationId,
            investigationId: envelope.id,
            workerId,
            agentRunId: started.agentRunId,
            status: AgentRunStatus.FAILED,
            errorCode: safeError(error).code,
            errorMessage: safeError(error).message,
          });
          throw error;
        }
      };

      await executeAgent(
        InvestigationAgentKind.TRIAGE,
        'codeer_triage_finding',
        AgentFindingDraftSchema,
        agentFindingJsonSchema,
        'Classify the reproduced failure, identify the highest-value evidence and list missing evidence.',
        [
          { name: 'incident.get_evidence', input: {} },
          { name: 'incident.get_timeline', input: {} },
          { name: 'reproduction.get_result', input: {} },
        ],
      );
      await job.updateProgress({ stage: InvestigationStatus.TRIAGE, percent: 28 });

      await executeAgent(
        InvestigationAgentKind.REPOSITORY_MAPPER,
        'codeer_repository_map',
        AgentFindingDraftSchema,
        agentFindingJsonSchema,
        'Map the repository components and configuration boundaries relevant to the reproduced failure.',
        [
          { name: 'repository.get_manifest', input: {} },
          { name: 'repository.list_tree', input: { maximumEntries: 2_000 } },
          { name: 'repository.get_config_summary', input: {} },
        ],
      );
      await job.updateProgress({ stage: InvestigationStatus.MAPPING, percent: 40 });

      const searchTerms = [...envelope.input.focusAreas, 'build', 'test', 'error', 'auth'].slice(
        0,
        8,
      );
      const rootTools = searchTerms.map((query) => ({
        name: 'repository.search_text',
        input: { query, maximumMatches: 25 },
      }));
      const diagnosisRun = await executeAgent<ReturnType<typeof DiagnosisDraftSchema.parse>>(
        InvestigationAgentKind.ROOT_CAUSE_INVESTIGATOR,
        'codeer_diagnosis_draft',
        DiagnosisDraftSchema,
        diagnosisDraftJsonSchema,
        'Produce competing hypotheses and a complete evidence-grounded root-cause diagnosis. Do not propose code changes.',
        rootTools,
      );
      await job.updateProgress({ stage: InvestigationStatus.HYPOTHESIS, percent: 56 });

      await executeAgent(
        InvestigationAgentKind.CONTRACT_ANALYST,
        'codeer_contract_analysis',
        AgentFindingDraftSchema,
        agentFindingJsonSchema,
        'Challenge the diagnosis against package, API, configuration and environment contracts.',
        [
          { name: 'repository.get_dependency_graph', input: {} },
          { name: 'repository.get_config_summary', input: {} },
        ],
      );
      await job.updateProgress({ stage: InvestigationStatus.VALIDATION, percent: 66 });

      const securityRun = await executeAgent<ReturnType<typeof SecurityReviewDraftSchema.parse>>(
        InvestigationAgentKind.SECURITY_REVIEWER,
        'codeer_security_review',
        SecurityReviewDraftSchema,
        securityReviewJsonSchema,
        'Review the diagnosis for security impact, credential exposure, trust-boundary errors and unsafe assumptions.',
        [
          { name: 'repository.search_text', input: { query: 'authorization', maximumMatches: 25 } },
          { name: 'repository.search_text', input: { query: 'secret', maximumMatches: 25 } },
          { name: 'reproduction.get_artifact_manifest', input: {} },
        ],
      );
      if (!securityRun.output.approved || securityRun.output.blockers.length > 0) {
        await store.recordGuardrail({
          organizationId: envelope.organizationId,
          investigationId: envelope.id,
          workerId,
          agentRunId: securityRun.agentRunId,
          category: 'SECURITY_REVIEW',
          outcome: GuardrailOutcome.BLOCK,
          reason: securityRun.output.summary,
          policyVersion: envelope.policy.policyVersion,
          inputHash: context?.contentHash ?? sha256Hex('missing-context'),
          details: securityRun.output,
        });
        throw new Error(
          `Security review rejected the diagnosis: ${securityRun.output.blockers.join('; ')}`,
        );
      }
      await store.recordGuardrail({
        organizationId: envelope.organizationId,
        investigationId: envelope.id,
        workerId,
        agentRunId: securityRun.agentRunId,
        category: 'SECURITY_REVIEW',
        outcome: GuardrailOutcome.ALLOW,
        reason: securityRun.output.summary,
        policyVersion: envelope.policy.policyVersion,
        inputHash: context?.contentHash ?? sha256Hex('missing-context'),
        details: securityRun.output,
      });
      await job.updateProgress({ stage: InvestigationStatus.SECURITY_REVIEW, percent: 76 });

      const planRun = await executeAgent<ReturnType<typeof TreatmentPlanDraftSchema.parse>>(
        InvestigationAgentKind.PLAN_COMPOSER,
        'codeer_treatment_plan_draft',
        TreatmentPlanDraftSchema,
        treatmentPlanDraftJsonSchema,
        'Create the smallest reversible treatment plan for the validated diagnosis, with bounded verification and rollback. Do not apply changes.',
        [],
      );
      await job.updateProgress({ stage: InvestigationStatus.PLAN_COMPOSITION, percent: 86 });

      const criticRun = await executeAgent<ReturnType<typeof CriticReviewDraftSchema.parse>>(
        InvestigationAgentKind.INDEPENDENT_CRITIC,
        'codeer_independent_critic',
        CriticReviewDraftSchema,
        criticReviewJsonSchema,
        'Independently challenge the diagnosis and treatment plan. Reject unsupported claims, excessive scope, missing verification or unsafe steps.',
        [{ name: 'reproduction.get_result', input: {} }],
      );
      if (!criticRun.output.accepted) {
        throw new Error(`Independent critic rejected the plan: ${criticRun.output.summary}`);
      }
      await job.updateProgress({ stage: InvestigationStatus.CRITIC_REVIEW, percent: 94 });

      context = buildInvestigationContext(allSources, {
        maximumItems: config.AI_MAX_CONTEXT_ITEMS,
        maximumBytes: config.AI_MAX_CONTEXT_BYTES,
        maximumItemBytes: config.AI_MAX_CONTEXT_ITEM_BYTES,
      });
      const now = new Date().toISOString();
      const diagnosisUnsigned = {
        id: randomUUID(),
        investigationId: envelope.id,
        ...diagnosisRun.output,
        hypotheses: diagnosisRun.output.hypotheses.map((hypothesis) => ({
          id: randomUUID(),
          ...hypothesis,
        })),
        schemaVersion: DIAGNOSIS_SCHEMA_VERSION,
        createdAt: now,
      };
      const diagnosis: Diagnosis = {
        ...diagnosisUnsigned,
        contentHash: digestPayload(diagnosisUnsigned),
      };
      const planUnsigned = {
        id: randomUUID(),
        investigationId: envelope.id,
        diagnosisId: diagnosis.id,
        version: 1,
        status: TreatmentPlanStatus.AWAITING_APPROVAL,
        ...planRun.output,
        schemaVersion: TREATMENT_PLAN_SCHEMA_VERSION,
        createdAt: now,
      };
      const plan: TreatmentPlan = { ...planUnsigned, contentHash: digestPayload(planUnsigned) };
      const diagnosisGrounding = validateDiagnosisGrounding(diagnosis, context);
      const planGrounding = validateTreatmentPlanGrounding(plan, context);
      const criticCitations = validateCitations(criticRun.output.citations, context);
      if (!diagnosisGrounding.valid || !planGrounding.valid || !criticCitations.valid) {
        await store.recordGuardrail({
          organizationId: envelope.organizationId,
          investigationId: envelope.id,
          workerId,
          agentRunId: criticRun.agentRunId,
          category: 'CITATION_VALIDATION',
          outcome: GuardrailOutcome.BLOCK,
          reason: 'Diagnosis or treatment plan contains unsupported citations.',
          policyVersion: envelope.policy.policyVersion,
          inputHash: context.contentHash,
          details: {
            diagnosis: diagnosisGrounding.errors,
            plan: planGrounding.errors,
            critic: criticCitations.errors,
          },
        });
        throw new Error(
          `Citation grounding failed: ${[...diagnosisGrounding.errors, ...planGrounding.errors, ...criticCitations.errors].join('; ')}`,
        );
      }
      await store.recordGuardrail({
        organizationId: envelope.organizationId,
        investigationId: envelope.id,
        workerId,
        agentRunId: criticRun.agentRunId,
        category: 'CITATION_VALIDATION',
        outcome: GuardrailOutcome.ALLOW,
        reason: 'All diagnosis and treatment-plan citations resolve to committed context.',
        policyVersion: envelope.policy.policyVersion,
        inputHash: context.contentHash,
        details: {
          validatedDiagnosisCitations: diagnosisGrounding.validatedCount,
          validatedPlanCitations: planGrounding.validatedCount,
        },
      });
      await store.saveDiagnosisAndPlan({
        organizationId: envelope.organizationId,
        investigationId: envelope.id,
        workerId,
        diagnosis,
        plan,
      });
      await job.updateProgress({ stage: InvestigationStatus.AWAITING_APPROVAL, percent: 100 });
      logger.info(
        { investigationId: envelope.id, diagnosisId: diagnosis.id, planId: plan.id, usage },
        'Enterprise investigation completed and is awaiting human approval',
      );
      return {
        investigationId: envelope.id,
        diagnosisId: diagnosis.id,
        treatmentPlanId: plan.id,
        status: InvestigationStatus.AWAITING_APPROVAL,
        usage,
      };
    } catch (error) {
      const safe = safeError(error);
      const status = /cancellation/i.test(safe.message)
        ? InvestigationStatus.CANCELLED
        : /insufficient evidence/i.test(safe.message)
          ? InvestigationStatus.INSUFFICIENT_EVIDENCE
          : statusForError(safe.code);
      await store
        .failInvestigation({
          organizationId: envelope.organizationId,
          investigationId: envelope.id,
          workerId,
          status,
          errorCode: safe.code,
          errorMessage: safe.message,
        })
        .catch((failure: unknown) => {
          logger.error(
            { investigationId: envelope.id, error: failure },
            'Failed to persist investigation terminal state',
          );
        });
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  function buildToolGateway(
    bundle: Awaited<ReturnType<InvestigationStore['loadInvestigationSources']>>,
    worktree: string,
    repositoryInspector: RepositoryReadOnlyInspector,
  ): ReadOnlyToolGateway {
    const source = (kind: CitationSourceType) =>
      bundle.sources.filter((item) => item.sourceType === kind);
    return new ReadOnlyToolGateway()
      .register('incident.get_evidence', () =>
        Promise.resolve(source(CitationSourceType.INCIDENT_EVIDENCE)),
      )
      .register('incident.get_timeline', () =>
        Promise.resolve(source(CitationSourceType.INCIDENT_EVENT)),
      )
      .register('reproduction.get_result', () =>
        Promise.resolve(source(CitationSourceType.REPRODUCTION)),
      )
      .register('reproduction.get_log_chunks', () =>
        Promise.resolve(source(CitationSourceType.SANDBOX_LOG)),
      )
      .register('reproduction.get_artifact_manifest', () =>
        Promise.resolve(source(CitationSourceType.SANDBOX_ARTIFACT)),
      )
      .register('health.get_latest_snapshot', () =>
        Promise.resolve(source(CitationSourceType.REPOSITORY_HEALTH)),
      )
      .register(
        'repository.get_manifest',
        async () => await repositoryInspector.getManifest(worktree),
      )
      .register(
        'repository.list_tree',
        async (_context, input) =>
          await repositoryInspector.listTree(worktree, Number(input.maximumEntries ?? 2_000)),
      )
      .register(
        'repository.read_file_range',
        async (_context, input) =>
          await repositoryInspector.readFileRange(
            worktree,
            typeof input.path === 'string' ? input.path : '',
            Number(input.lineStart ?? 1),
            Number(input.lineEnd ?? 200),
          ),
      )
      .register(
        'repository.search_text',
        async (_context, input) =>
          await repositoryInspector.searchText(
            worktree,
            typeof input.query === 'string' ? input.query : '',
            Number(input.maximumMatches ?? 100),
          ),
      )
      .register(
        'repository.get_dependency_graph',
        async () => await repositoryInspector.getDependencyGraph(worktree),
      )
      .register(
        'repository.get_config_summary',
        async () => await repositoryInspector.getConfigSummary(worktree),
      );
  }

  return {
    worker,
    async reconcile() {
      const count = await store.reconcileStaleInvestigations(
        workerId,
        config.AI_INVESTIGATION_STALE_AFTER_MS,
      );
      if (count > 0) logger.warn({ count }, 'Reconciled stale investigation leases');
    },
    async close() {
      await worker.close();
    },
  };
}

export { citationFromFile };
