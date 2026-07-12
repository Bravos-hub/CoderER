import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { loadApiConfig } from '@codeer/config';
import {
  IncidentPermission,
  ReproductionListQuerySchema,
  SandboxLogQuerySchema,
  StartReproductionSchema,
  type Reproduction,
} from '@codeer/contracts';
import {
  IdempotencyConflictError,
  SandboxStore,
  TenantResourceNotFoundError,
  type StoreActorContext,
} from '@codeer/database';
import { logger } from '@codeer/logger';
import { evaluateSandboxPolicy } from '@codeer/sandbox';
import { AuthorizationError, assertIncidentPermission } from '@codeer/security';

@Injectable()
export class ReproductionsService {
  private readonly store = new SandboxStore();
  private readonly config = loadApiConfig(process.env);

  async create(
    context: StoreActorContext,
    incidentId: string,
    rawInput: unknown,
    idempotencyKey?: string,
  ): Promise<Reproduction> {
    this.authorize(context, IncidentPermission.REQUEST_REPRODUCTION);
    if (this.config.REQUIRE_IDEMPOTENCY_KEYS && !idempotencyKey) {
      throw new BadRequestException('Idempotency-Key is required for reproduction requests.');
    }
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key contains unsupported characters.');
    }
    const source =
      rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
    const parsed = StartReproductionSchema.safeParse({
      ...source,
      image: source.image ?? this.config.SANDBOX_DEFAULT_IMAGE,
    });
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (parsed.data.policyOverrideReason) {
      this.authorize(context, IncidentPermission.OVERRIDE_SANDBOX_POLICY);
    }

    const policy = evaluateSandboxPolicy(parsed.data, {
      production: this.config.NODE_ENV === 'production',
      approvedImageRegistries: this.config.SANDBOX_APPROVED_REGISTRIES,
      defaultImage: this.config.SANDBOX_DEFAULT_IMAGE,
      installationNetwork: this.config.SANDBOX_INSTALL_NETWORK,
      installationAllowedRegistries: this.config.SANDBOX_INSTALL_ALLOWED_REGISTRIES,
      installationAllowedDomains: this.config.SANDBOX_INSTALL_ALLOWED_DOMAINS,
      allowInstallScriptsOverride: this.config.SANDBOX_ALLOW_INSTALL_SCRIPTS_OVERRIDE,
      defaultResourceLimits: {
        cpuCores: this.config.SANDBOX_CPU_CORES,
        memoryBytes: this.config.SANDBOX_MEMORY_BYTES,
        pids: this.config.SANDBOX_PIDS_LIMIT,
        workspaceBytes: this.config.SANDBOX_WORKSPACE_BYTES,
        tempBytes: this.config.SANDBOX_TEMP_BYTES,
        commandTimeoutMs: this.config.SANDBOX_COMMAND_TIMEOUT_MS,
        executionTimeoutMs: this.config.SANDBOX_EXECUTION_TIMEOUT_MS,
        maximumCommands: this.config.SANDBOX_MAX_COMMANDS,
        maximumLogBytes: this.config.SANDBOX_MAX_LOG_BYTES,
        maximumArtifactBytes: this.config.SANDBOX_MAX_ARTIFACT_BYTES,
      },
    });
    try {
      return await this.store.createReproduction({
        context,
        incidentId,
        input: parsed.data,
        policy,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        idempotencyTtlSeconds: this.config.IDEMPOTENCY_TTL_SECONDS,
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async list(context: StoreActorContext, incidentId: string, rawQuery: unknown) {
    this.authorize(context, IncidentPermission.READ_REPRODUCTION);
    const parsed = ReproductionListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.listReproductions(context.organizationId, incidentId, {
        limit: parsed.data.limit,
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.result ? { result: parsed.data.result } : {}),
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async get(context: StoreActorContext, reproductionId: string) {
    this.authorize(context, IncidentPermission.READ_REPRODUCTION);
    try {
      return await this.store.getReproduction(context.organizationId, reproductionId);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async cancel(context: StoreActorContext, reproductionId: string) {
    this.authorize(context, IncidentPermission.CANCEL_REPRODUCTION);
    try {
      return await this.store.requestCancellation(context, reproductionId);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async logs(context: StoreActorContext, reproductionId: string, rawQuery: unknown) {
    this.authorize(context, IncidentPermission.READ_REPRODUCTION);
    const parsed = SandboxLogQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.listLogs(context.organizationId, reproductionId, {
        limit: parsed.data.limit,
        ...(parsed.data.afterSequence !== undefined
          ? { afterSequence: parsed.data.afterSequence }
          : {}),
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async artifacts(context: StoreActorContext, reproductionId: string) {
    this.authorize(context, IncidentPermission.READ_REPRODUCTION);
    try {
      return await this.store.listArtifacts(context.organizationId, reproductionId);
    } catch (error) {
      throw this.toHttpException(error);
    }
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
            requestId: context.requestId,
            correlationId: context.correlationId,
            permission,
            outcome: 'DENIED',
          },
          'Sandbox authorization denied',
        );
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  private toHttpException(error: unknown): Error {
    if (error instanceof TenantResourceNotFoundError) return new NotFoundException(error.message);
    if (error instanceof IdempotencyConflictError) return new ConflictException(error.message);
    if (error instanceof Error && /policy|cursor|worktree/i.test(error.message)) {
      return new BadRequestException(error.message);
    }
    return error instanceof Error ? error : new Error('Unknown reproduction service failure');
  }
}
