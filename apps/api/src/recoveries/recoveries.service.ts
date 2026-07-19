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
  ActorRole,
  ActorType,
  IncidentPermission,
  PublicationDecision,
  PublicationDecisionSchema,
  RecoveryListQuerySchema,
  RecoveryRevisionRequestSchema,
  StartRecoverySchema,
  type RecoveryRun,
} from '@codeer/contracts';
import {
  closeDatabase,
  IdempotencyConflictError,
  OptimisticConcurrencyError,
  RecoveryStore,
  TenantResourceNotFoundError,
  type StoreActorContext,
} from '@codeer/database';
import { logger } from '@codeer/logger';
import { defaultRecoveryPolicy } from '@codeer/recovery';
import { AuthorizationError, assertIncidentPermission } from '@codeer/security';

@Injectable()
export class RecoveriesService implements OnModuleDestroy {
  private readonly store = new RecoveryStore();
  private readonly config = loadApiConfig(process.env);

  async create(
    context: StoreActorContext,
    planId: string,
    rawInput: unknown,
    idempotencyKey?: string,
  ): Promise<RecoveryRun> {
    this.authorize(context, IncidentPermission.START_RECOVERY);
    if (this.config.REQUIRE_IDEMPOTENCY_KEYS && !idempotencyKey) {
      throw new BadRequestException('Idempotency-Key is required for recovery creation.');
    }
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must contain 8-128 safe characters.');
    }
    const parsed = StartRecoverySchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const policy = defaultRecoveryPolicy(
      this.config.RECOVERY_ALLOWED_PATHS,
      this.config.RECOVERY_ALLOWED_EXTENSIONS,
    );
    const configured = {
      ...policy,
      maximumChangedFiles: this.config.RECOVERY_MAX_CHANGED_FILES,
      maximumChangedLines: this.config.RECOVERY_MAX_CHANGED_LINES,
      maximumPatchHunks: this.config.RECOVERY_MAX_PATCH_HUNKS,
      maximumPatchBytes: this.config.RECOVERY_MAX_PATCH_BYTES,
      allowNewFiles: this.config.RECOVERY_ALLOW_NEW_FILES,
      allowDeletedFiles: this.config.RECOVERY_ALLOW_DELETED_FILES,
      allowGeneratedFiles: this.config.RECOVERY_ALLOW_GENERATED_FILES,
      allowDependencyChanges: this.config.RECOVERY_ALLOW_DEPENDENCY_CHANGES,
      allowLockfileChanges: this.config.RECOVERY_ALLOW_LOCKFILE_CHANGES,
      allowWorkflowChanges: this.config.RECOVERY_ALLOW_WORKFLOW_CHANGES,
      allowInfrastructureChanges: this.config.RECOVERY_ALLOW_INFRASTRUCTURE_CHANGES,
      allowMigrationChanges: this.config.RECOVERY_ALLOW_MIGRATION_CHANGES,
      allowSecuritySensitiveChanges: this.config.RECOVERY_ALLOW_SECURITY_SENSITIVE_CHANGES,
      requiredPublicationApprovals: this.config.RECOVERY_REQUIRED_PUBLICATION_APPROVALS,
      retentionDays: this.config.RECOVERY_RETENTION_DAYS,
    };
    try {
      return await this.store.createRecovery({
        context,
        planId,
        input: parsed.data,
        policy: configured,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        idempotencyTtlSeconds: this.config.IDEMPOTENCY_TTL_SECONDS,
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async list(context: StoreActorContext, incidentId: string, rawQuery: unknown) {
    this.authorize(context, IncidentPermission.READ_RECOVERY);
    const parsed = RecoveryListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.listRecoveries(context.organizationId, incidentId, parsed.data);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async listOrganization(context: StoreActorContext, rawQuery: unknown) {
    this.authorize(context, IncidentPermission.READ_RECOVERY);
    const parsed = RecoveryListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.listOrganizationRecoveries(context.organizationId, parsed.data);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async get(context: StoreActorContext, recoveryId: string) {
    this.authorize(context, IncidentPermission.READ_RECOVERY);
    try {
      const recovery = await this.store.getRecovery(context.organizationId, recoveryId);
      const [patch, securityReview, verification, pullRequestPackage] = await Promise.all([
        this.store.getLatestPatch(context.organizationId, recoveryId),
        this.store.getSecurityReview(context.organizationId, recoveryId),
        this.store.getVerification(context.organizationId, recoveryId),
        this.store.getPullRequestPackage(context.organizationId, recoveryId),
      ]);
      return { recovery, patch, securityReview, verification, pullRequestPackage };
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async cancel(context: StoreActorContext, recoveryId: string) {
    this.authorize(context, IncidentPermission.CANCEL_RECOVERY);
    try {
      return await this.store.requestCancellation(context, recoveryId);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async resume(context: StoreActorContext, recoveryId: string) {
    this.authorize(context, IncidentPermission.RESUME_RECOVERY);
    try {
      return await this.store.resumeRecovery(context, recoveryId);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async events(
    context: StoreActorContext,
    recoveryId: string,
    rawAfter?: string,
    rawLimit?: string,
  ) {
    this.authorize(context, IncidentPermission.READ_RECOVERY);
    const afterSequence = rawAfter === undefined ? 0 : Number(rawAfter);
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new BadRequestException('afterSequence must be a non-negative integer.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException('limit must be between 1 and 500.');
    }
    return this.store.listEvents(context.organizationId, recoveryId, afterSequence, limit);
  }

  async patch(context: StoreActorContext, recoveryId: string) {
    this.authorize(context, IncidentPermission.READ_RECOVERY);
    const patch = await this.store.getLatestPatch(context.organizationId, recoveryId);
    if (!patch) throw new NotFoundException('Recovery patch is not available.');
    return patch;
  }

  async patchVersion(context: StoreActorContext, recoveryId: string, version: number) {
    this.authorize(context, IncidentPermission.READ_RECOVERY);
    if (!Number.isInteger(version) || version < 1)
      throw new BadRequestException('Patch version must be a positive integer.');
    const patch = await this.store.getPatchVersion(context.organizationId, recoveryId, version);
    if (!patch) throw new NotFoundException('Recovery patch version is not available.');
    return patch;
  }

  async requestRevision(context: StoreActorContext, recoveryId: string, rawInput: unknown) {
    if (context.actorType !== ActorType.USER || context.actorRoles.includes(ActorRole.SERVICE)) {
      throw new ForbiddenException('Recovery revisions require an authenticated human user.');
    }
    this.authorize(context, IncidentPermission.REQUEST_RECOVERY_REVISION);
    const parsed = RecoveryRevisionRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.requestRevision(context, recoveryId, parsed.data);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async securityReview(context: StoreActorContext, recoveryId: string) {
    this.authorize(context, IncidentPermission.READ_RECOVERY);
    const review = await this.store.getSecurityReview(context.organizationId, recoveryId);
    if (!review) throw new NotFoundException('Recovery security review is not available.');
    return review;
  }

  async verification(context: StoreActorContext, recoveryId: string) {
    this.authorize(context, IncidentPermission.READ_RECOVERY);
    const report = await this.store.getVerification(context.organizationId, recoveryId);
    if (!report) throw new NotFoundException('Recovery verification is not available.');
    return report;
  }

  async pullRequestPackage(context: StoreActorContext, recoveryId: string) {
    this.authorize(context, IncidentPermission.READ_RECOVERY);
    const pkg = await this.store.getPullRequestPackage(context.organizationId, recoveryId);
    if (!pkg) throw new NotFoundException('Pull-request package is not available.');
    return pkg;
  }

  async decidePublication(
    context: StoreActorContext,
    recoveryId: string,
    decision: PublicationDecision,
    rawInput: unknown,
  ) {
    if (context.actorType !== ActorType.USER || context.actorRoles.includes(ActorRole.SERVICE)) {
      throw new ForbiddenException('Publication decisions require an authenticated human user.');
    }
    const permission =
      decision === PublicationDecision.APPROVE
        ? IncidentPermission.APPROVE_RECOVERY_PUBLICATION
        : IncidentPermission.REJECT_RECOVERY_PUBLICATION;
    this.authorize(context, permission);
    const parsed = PublicationDecisionSchema.safeParse({
      ...(typeof rawInput === 'object' && rawInput ? rawInput : {}),
      decision,
    });
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.decidePublication({
        context,
        recoveryId,
        decision,
        comment: parsed.data.comment,
        expectedVersion: parsed.data.expectedRecoveryVersion,
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
            permission,
          },
          'recovery authorization denied',
        );
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  private toHttpException(error: unknown): Error {
    if (error instanceof IdempotencyConflictError || error instanceof OptimisticConcurrencyError) {
      return new ConflictException(error.message);
    }
    if (error instanceof TenantResourceNotFoundError) return new NotFoundException(error.message);
    if (error instanceof Error) {
      if (/not authorized|authenticated human/i.test(error.message)) {
        return new ForbiddenException(error.message);
      }
      return new BadRequestException(error.message);
    }
    return new BadRequestException('Recovery operation failed.');
  }
}
