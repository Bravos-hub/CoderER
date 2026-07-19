import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { defaultAiPolicy } from '@codeer/ai';
import { loadApiConfig } from '@codeer/config';
import {
  ActorRole,
  ActorType,
  IncidentPermission,
  InvestigationListQuerySchema,
  PlanApprovalDecision,
  StartInvestigationSchema,
  TreatmentPlanDecisionSchema,
  type Investigation,
} from '@codeer/contracts';
import {
  closeDatabase,
  IdempotencyConflictError,
  InvestigationStore,
  OptimisticConcurrencyError,
  TenantResourceNotFoundError,
  type StoreActorContext,
} from '@codeer/database';
import { logger } from '@codeer/logger';
import { AuthorizationError, assertIncidentPermission } from '@codeer/security';

@Injectable()
export class InvestigationsService implements OnModuleDestroy {
  private readonly store = new InvestigationStore();
  private readonly config = loadApiConfig(process.env);

  async create(
    context: StoreActorContext,
    incidentId: string,
    rawInput: unknown,
    idempotencyKey?: string,
  ): Promise<Investigation> {
    this.authorize(context, IncidentPermission.START_INVESTIGATION);
    if (this.config.REQUIRE_IDEMPOTENCY_KEYS && !idempotencyKey) {
      throw new BadRequestException('Idempotency-Key is required for investigation creation.');
    }
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must contain 8-128 safe characters.');
    }
    const parsed = StartInvestigationSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const requestedModels = parsed.data.requestedModels ?? [];
    const disallowed = requestedModels.filter(
      (model) => !this.config.AI_ALLOWED_MODELS.includes(model),
    );
    if (disallowed.length) {
      throw new BadRequestException('One or more requested models are not organization-approved.');
    }
    const policy = defaultAiPolicy(
      requestedModels.length ? requestedModels : this.config.AI_ALLOWED_MODELS,
    );
    const configuredPolicy = {
      ...policy,
      maximumConcurrentInvestigations: this.config.AI_INVESTIGATION_CONCURRENCY,
      maximumModelInvocations: this.config.AI_MAX_MODEL_INVOCATIONS,
      maximumToolCalls: this.config.AI_MAX_TOOL_CALLS,
      maximumInputTokens: this.config.AI_MAX_INPUT_TOKENS,
      maximumOutputTokens: this.config.AI_MAX_OUTPUT_TOKENS,
      maximumCostUsd: this.config.AI_MAX_COST_USD,
      timeoutMs: this.config.AI_TIMEOUT_MS,
      retentionDays: this.config.AI_RETENTION_DAYS,
      storeProviderResponses: this.config.AI_STORE_PROVIDER_RESPONSES,
    };
    try {
      return await this.store.createInvestigation({
        context,
        incidentId,
        input: parsed.data,
        policy: configuredPolicy,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        idempotencyTtlSeconds: this.config.IDEMPOTENCY_TTL_SECONDS,
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async list(context: StoreActorContext, incidentId: string, rawQuery: unknown) {
    this.authorize(context, IncidentPermission.READ_INVESTIGATION);
    const parsed = InvestigationListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.listInvestigations(context.organizationId, incidentId, parsed.data);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async listOrganization(context: StoreActorContext, rawQuery: unknown) {
    this.authorize(context, IncidentPermission.READ_INVESTIGATION);
    const parsed = InvestigationListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.listOrganizationInvestigations(context.organizationId, parsed.data);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async get(context: StoreActorContext, investigationId: string) {
    this.authorize(context, IncidentPermission.READ_INVESTIGATION);
    try {
      const investigation = await this.store.getInvestigation(
        context.organizationId,
        investigationId,
      );
      const [diagnosis, treatmentPlans] = await Promise.all([
        this.store.getDiagnosis(context.organizationId, investigationId),
        this.store.listTreatmentPlans(context.organizationId, investigationId),
      ]);
      return { investigation, diagnosis, treatmentPlans };
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async cancel(context: StoreActorContext, investigationId: string) {
    this.authorize(context, IncidentPermission.CANCEL_INVESTIGATION);
    try {
      return await this.store.requestCancellation(context, investigationId);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async resume(context: StoreActorContext, investigationId: string) {
    this.authorize(context, IncidentPermission.RESUME_INVESTIGATION);
    try {
      return await this.store.resumeInvestigation(context, investigationId);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async events(
    context: StoreActorContext,
    investigationId: string,
    rawAfter?: string,
    rawLimit?: string,
  ) {
    this.authorize(context, IncidentPermission.READ_INVESTIGATION);
    const afterSequence = rawAfter === undefined ? 0 : Number(rawAfter);
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new BadRequestException('afterSequence must be a non-negative integer.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException('limit must be between 1 and 500.');
    }
    return this.store.listEvents(context.organizationId, investigationId, afterSequence, limit);
  }

  async toolCalls(context: StoreActorContext, investigationId: string, rawLimit?: string) {
    this.authorize(context, IncidentPermission.READ_INVESTIGATION);
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException('limit must be between 1 and 500.');
    }
    return this.store.listToolCalls(context.organizationId, investigationId, limit);
  }

  async diagnosis(context: StoreActorContext, investigationId: string) {
    this.authorize(context, IncidentPermission.READ_INVESTIGATION);
    const diagnosis = await this.store.getDiagnosis(context.organizationId, investigationId);
    if (!diagnosis) throw new NotFoundException('Investigation diagnosis is not available.');
    return diagnosis;
  }

  async treatmentPlans(context: StoreActorContext, investigationId: string) {
    this.authorize(context, IncidentPermission.READ_INVESTIGATION);
    return this.store.listTreatmentPlans(context.organizationId, investigationId);
  }

  async decidePlan(
    context: StoreActorContext,
    planId: string,
    decision: PlanApprovalDecision,
    rawInput: unknown,
  ) {
    if (context.actorType !== ActorType.USER || context.actorRoles.includes(ActorRole.SERVICE)) {
      throw new ForbiddenException('Treatment-plan decisions require an authenticated human user.');
    }
    const permission =
      decision === PlanApprovalDecision.APPROVE
        ? IncidentPermission.APPROVE_TREATMENT_PLAN
        : decision === PlanApprovalDecision.REJECT
          ? IncidentPermission.REJECT_TREATMENT_PLAN
          : IncidentPermission.REQUEST_PLAN_REVISION;
    this.authorize(context, permission);
    const parsed = TreatmentPlanDecisionSchema.safeParse({
      ...(typeof rawInput === 'object' && rawInput ? rawInput : {}),
      decision,
    });
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.decideTreatmentPlan({
        context,
        planId,
        decision,
        comment: parsed.data.comment,
        expectedVersion: parsed.data.expectedVersion,
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await closeDatabase();
  }

  private authorize(context: StoreActorContext, permission: IncidentPermission): void {
    try {
      assertIncidentPermission(context.actorRoles, permission);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        logger.warn(
          {
            organizationId: context.organizationId,
            actorId: context.actorId,
            actorRoles: context.actorRoles,
            requestId: context.requestId,
            permission,
            outcome: 'DENIED',
          },
          'Investigation authorization denied',
        );
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  private toHttpException(error: unknown): Error {
    if (error instanceof TenantResourceNotFoundError) return new NotFoundException(error.message);
    if (error instanceof IdempotencyConflictError) return new ConflictException(error.message);
    if (error instanceof OptimisticConcurrencyError) return new ConflictException(error.message);
    if (
      error instanceof Error &&
      /requires a completed|cannot be resumed|concurrency limit|not permitted|not organization-approved/i.test(
        error.message,
      )
    ) {
      return new BadRequestException(error.message);
    }
    return error instanceof Error ? error : new Error('Unknown investigation service failure.');
  }
}
