import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ActorRole, ActorType, IncidentPermission } from '@codeer/contracts';
import { closeDatabase, PublicationStore } from '@codeer/database';
import type { CodeerRequestContext } from '../security/request-context.middleware.js';
import {
  PublicationStatus,
  PublicationTransitionRequestSchema,
  StartPublicationSchema,
  evaluateMergeReadiness,
  MergeReadinessInputSchema,
} from '@codeer/publication';
import { AuthorizationError, assertIncidentPermission } from '@codeer/security';

@Injectable()
export class PublicationsService implements OnModuleDestroy {
  private readonly store = new PublicationStore();

  async create(
    context: CodeerRequestContext,
    recoveryId: string,
    rawInput: unknown,
    idempotencyKey?: string,
  ) {
    this.authorize(context, IncidentPermission.START_PUBLICATION);
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException('A valid Idempotency-Key header is required.');
    }
    const parsed = StartPublicationSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.createPublication({
        context,
        recoveryId,
        installationId: parsed.data.installationId,
        package: parsed.data.approvedPackage,
        policy: parsed.data.policy,
        idempotencyKey,
      });
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async listForRecovery(context: CodeerRequestContext, recoveryId: string) {
    this.authorize(context, IncidentPermission.READ_PUBLICATION);
    return this.store.listForRecovery(context.organizationId, recoveryId);
  }

  async listOrganization(context: CodeerRequestContext, rawLimit?: string) {
    this.authorize(context, IncidentPermission.READ_PUBLICATION);
    const limit = rawLimit ? Number(rawLimit) : 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('Publication limit must be an integer from 1 to 100.');
    }
    return this.store.listOrganization(context.organizationId, limit);
  }

  async get(context: CodeerRequestContext, publicationId: string) {
    this.authorize(context, IncidentPermission.READ_PUBLICATION);
    try {
      const publication = await this.store.getPublication(context.organizationId, publicationId);
      const [events, checks, reviews] = await Promise.all([
        this.store.listEvents(context.organizationId, publicationId),
        this.store.listChecks(context.organizationId, publicationId),
        this.store.listReviews(context.organizationId, publicationId),
      ]);
      return { publication, events, checks, reviews };
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async events(context: CodeerRequestContext, publicationId: string) {
    this.authorize(context, IncidentPermission.READ_PUBLICATION);
    return this.store.listEvents(context.organizationId, publicationId);
  }

  async checks(context: CodeerRequestContext, publicationId: string) {
    this.authorize(context, IncidentPermission.READ_PUBLICATION);
    return this.store.listChecks(context.organizationId, publicationId);
  }

  async reviews(context: CodeerRequestContext, publicationId: string) {
    this.authorize(context, IncidentPermission.READ_PUBLICATION);
    return this.store.listReviews(context.organizationId, publicationId);
  }

  async cancel(context: CodeerRequestContext, publicationId: string, rawInput: unknown) {
    this.requireHuman(context);
    this.authorize(context, IncidentPermission.CANCEL_PUBLICATION);
    const parsed = PublicationTransitionRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.store.transition(
      context,
      publicationId,
      parsed.data.expectedVersion,
      PublicationStatus.CANCELLED,
    );
  }

  async retry(context: CodeerRequestContext, publicationId: string, rawInput: unknown) {
    this.requireHuman(context);
    this.authorize(context, IncidentPermission.RETRY_PUBLICATION);
    const parsed = PublicationTransitionRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const current = await this.store.getPublication(context.organizationId, publicationId);
    const retryable = new Set([
      PublicationStatus.PUSH_FAILED,
      PublicationStatus.PR_CREATION_FAILED,
      PublicationStatus.CI_FAILED,
      PublicationStatus.REVISION_REQUIRED,
      PublicationStatus.BASE_BRANCH_STALE,
      PublicationStatus.SECURITY_BLOCKED,
    ]);
    if (!retryable.has(current.status)) {
      throw new BadRequestException('Publication is not in a retryable state.');
    }
    return this.store.transition(
      context,
      publicationId,
      parsed.data.expectedVersion,
      PublicationStatus.POLICY_CHECK,
    );
  }

  mergeReadiness(context: CodeerRequestContext, rawInput: unknown, policyInput: unknown) {
    this.authorize(context, IncidentPermission.READ_PUBLICATION);
    const input = MergeReadinessInputSchema.safeParse(rawInput);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    const policy = StartPublicationSchema.shape.policy.safeParse(policyInput);
    if (!policy.success) throw new BadRequestException(policy.error.flatten());
    return evaluateMergeReadiness(input.data, policy.data);
  }

  async markReady(context: CodeerRequestContext, publicationId: string, rawInput: unknown) {
    this.requireHuman(context);
    this.authorize(context, IncidentPermission.MARK_PUBLICATION_READY);
    const parsed = PublicationTransitionRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const current = await this.store.getPublication(context.organizationId, publicationId);
    if (current.status !== PublicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException(
        'Publication must be awaiting review before it can be marked ready.',
      );
    }
    return this.store.transition(
      context,
      publicationId,
      parsed.data.expectedVersion,
      PublicationStatus.READY_FOR_HUMAN_MERGE,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await closeDatabase();
  }

  private authorize(context: CodeerRequestContext, permission: IncidentPermission): void {
    try {
      assertIncidentPermission(context.actorRoles, permission);
    } catch (error) {
      if (error instanceof AuthorizationError) throw new ForbiddenException(error.message);
      throw error;
    }
  }

  private requireHuman(context: CodeerRequestContext): void {
    if (
      context.actorType !== ActorType.USER ||
      context.actorRoles.includes(ActorRole.SERVICE) ||
      !context.trustedContext
    ) {
      throw new ForbiddenException('This publication decision requires a trusted human identity.');
    }
  }

  private toHttp(error: unknown): Error {
    const message = error instanceof Error ? error.message : 'Publication request failed.';
    if (/not found/i.test(message)) return new NotFoundException(message);
    if (/organization|policy|stale|ready|match|conflict/i.test(message)) {
      return new BadRequestException(message);
    }
    return new BadRequestException('Publication request could not be completed.');
  }
}
