import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { loadApiConfig } from '@codeer/config';
import {
  CreateEvidenceSchema,
  CreateIncidentSchema,
  EvidenceSensitivity,
  IncidentListQuerySchema,
  IncidentPermission,
  RequestTriageSchema,
  TransitionIncidentSchema,
  type CreateIncidentInput,
  type Incident,
  type IncidentDetail,
  type IncidentList,
} from '@codeer/contracts';
import {
  closeDatabase,
  IdempotencyConflictError,
  IncidentStore,
  OptimisticConcurrencyError,
  TenantResourceNotFoundError,
  type StoreActorContext,
} from '@codeer/database';
import { logger } from '@codeer/logger';
import { AuthorizationError, assertIncidentPermission } from '@codeer/security';

@Injectable()
export class IncidentsService implements OnModuleDestroy {
  private readonly store = new IncidentStore();
  private readonly config = loadApiConfig(process.env);

  async create(
    context: StoreActorContext,
    rawInput: unknown,
    idempotencyKey?: string,
  ): Promise<Incident> {
    this.authorize(context, IncidentPermission.CREATE);
    if (this.config.REQUIRE_IDEMPOTENCY_KEYS && !idempotencyKey) {
      throw new BadRequestException('Idempotency-Key is required for incident creation.');
    }
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key must contain 8-128 safe alphanumeric, dot, underscore, colon or dash characters.',
      );
    }
    const input = this.parseCreate(rawInput);
    if (input.severity) this.authorize(context, IncidentPermission.OVERRIDE_SEVERITY);
    try {
      return await this.store.createIncident({
        context,
        input,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        idempotencyTtlSeconds: this.config.IDEMPOTENCY_TTL_SECONDS,
        organizationDefaults: {
          id: this.config.DEFAULT_ORGANIZATION_ID,
          slug: this.config.DEFAULT_ORGANIZATION_SLUG,
          name: this.config.DEFAULT_ORGANIZATION_NAME,
        },
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async list(context: StoreActorContext, rawQuery: unknown): Promise<IncidentList> {
    this.authorize(context, IncidentPermission.READ);
    const parsed = IncidentListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.listIncidents(context.organizationId, parsed.data);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async get(context: StoreActorContext, incidentId: string): Promise<IncidentDetail> {
    this.authorize(context, IncidentPermission.READ);
    try {
      return await this.store.getIncidentDetail(context.organizationId, incidentId);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async addEvidence(
    context: StoreActorContext,
    incidentId: string,
    rawInput: unknown,
  ): Promise<unknown> {
    this.authorize(context, IncidentPermission.ADD_EVIDENCE);
    const parsed = CreateEvidenceSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (parsed.data.sensitivity === EvidenceSensitivity.RESTRICTED) {
      this.authorize(context, IncidentPermission.MANAGE_RESTRICTED_EVIDENCE);
    }
    try {
      return await this.store.addEvidence(context, incidentId, parsed.data);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async requestTriage(
    context: StoreActorContext,
    incidentId: string,
    rawInput: unknown,
  ): Promise<Incident> {
    this.authorize(context, IncidentPermission.REQUEST_TRIAGE);
    const parsed = RequestTriageSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.requestTriage(
        context,
        incidentId,
        parsed.data.signals,
        parsed.data.force,
      );
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async transition(
    context: StoreActorContext,
    incidentId: string,
    rawInput: unknown,
  ): Promise<Incident> {
    this.authorize(context, IncidentPermission.TRANSITION);
    const parsed = TransitionIncidentSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.transitionIncident(context, incidentId, parsed.data);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async latestRepositoryHealth(context: StoreActorContext, repositoryId: string) {
    this.authorize(context, IncidentPermission.READ);
    const snapshot = await this.store.latestRepositoryHealth(context.organizationId, repositoryId);
    if (!snapshot) throw new NotFoundException('Repository health snapshot was not found.');
    return snapshot;
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
            actorType: context.actorType,
            actorRoles: context.actorRoles,
            requestId: context.requestId,
            correlationId: context.correlationId,
            permission,
            outcome: 'DENIED',
          },
          'Incident authorization denied',
        );
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  private parseCreate(rawInput: unknown): CreateIncidentInput {
    const parsed = CreateIncidentSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return parsed.data;
  }

  private toHttpException(error: unknown): Error {
    if (error instanceof TenantResourceNotFoundError) return new NotFoundException(error.message);
    if (error instanceof IdempotencyConflictError) return new ConflictException(error.message);
    if (error instanceof OptimisticConcurrencyError) return new ConflictException(error.message);
    if (
      error instanceof Error &&
      /not permitted|cannot be triaged|invalid cursor/i.test(error.message)
    ) {
      return new BadRequestException(error.message);
    }
    return error instanceof Error ? error : new Error('Unknown incident service failure');
  }
}
