import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  Headers,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { GithubWebhookStore } from '@codeer/database';
import {
  WEBHOOK_DELIVERY_ID_PATTERN,
  extractIngressContext,
  isSupportedWebhookEvent,
  mapCheckEvent,
  mapPullRequestEvent,
  mapReviewEvent,
  verifyGithubWebhookSignature,
} from '@codeer/publication';

/**
 * Signed GitHub webhook ingress. Order of operations is deliberate: the raw
 * body is verified before any parsing, the delivery id is reserved durably
 * (replay protection survives restarts and multiple instances), the tenant is
 * resolved from persisted installation/repository rows — never from payload
 * claims — and only normalized metadata is queued for asynchronous worker
 * processing. Payload bodies never persist beyond their digests.
 */
@Controller('webhooks')
export class GithubWebhookController {
  constructor(private readonly webhookStore: GithubWebhookStore = new GithubWebhookStore()) {}

  @Post('github')
  async receive(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-github-event') eventName: string | undefined,
  ) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret || secret.length < 32) {
      throw new BadRequestException('GitHub webhook ingress is not configured.');
    }
    if (!request.rawBody) throw new BadRequestException('Raw webhook body is unavailable.');
    if (!deliveryId || !eventName || !WEBHOOK_DELIVERY_ID_PATTERN.test(deliveryId)) {
      throw new BadRequestException('Required GitHub headers are missing.');
    }
    if (
      !verifyGithubWebhookSignature({
        secret,
        rawBody: request.rawBody,
        signatureHeader: signature,
      })
    ) {
      throw new BadRequestException('GitHub webhook signature is invalid.');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(request.rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('GitHub webhook payload is not valid JSON.');
    }
    const context = extractIngressContext(payload);
    const payloadDigest = createHash('sha256').update(request.rawBody).digest('hex');

    const reservedId = await this.webhookStore.reserveWebhookDelivery({
      deliveryId,
      eventName,
      action: context.action,
      signatureValid: true,
      payloadDigest,
      installationExternalId: context.installationExternalId,
    });
    if (!reservedId) {
      return { accepted: true, duplicate: true, deliveryId };
    }

    if (context.installationExternalId === null) {
      await this.webhookStore.markUnresolvedDeliveryStatus(
        deliveryId,
        'REJECTED',
        'NO_INSTALLATION',
      );
      throw new BadRequestException('GitHub webhook has no installation context.');
    }
    const tenant = await this.webhookStore.resolveAndAssignTenant(
      deliveryId,
      context.installationExternalId,
      context.repositoryExternalId,
    );
    if (!tenant) {
      await this.webhookStore.markUnresolvedDeliveryStatus(
        deliveryId,
        'REJECTED',
        'UNKNOWN_INSTALLATION',
      );
      throw new NotFoundException('GitHub installation is not registered.');
    }

    if (!isSupportedWebhookEvent(eventName)) {
      await this.webhookStore.markWebhookDeliveryStatus(
        tenant.organizationId,
        deliveryId,
        'IGNORED',
        'UNSUPPORTED_EVENT',
      );
      return { accepted: true, duplicate: false, ignored: true, deliveryId };
    }

    const normalized = normalizeEvent(eventName, payload);
    if (!normalized || !tenant.repositoryId) {
      await this.webhookStore.markWebhookDeliveryStatus(
        tenant.organizationId,
        deliveryId,
        'IGNORED',
        'UNMATCHED_REPOSITORY_OR_PAYLOAD',
      );
      return { accepted: true, duplicate: false, ignored: true, deliveryId };
    }

    await this.webhookStore.enqueueWebhookProcessMessage({
      deliveryId,
      organizationId: tenant.organizationId,
      eventName,
      correlationId: deliveryId,
      normalized: { ...normalized, repositoryId: tenant.repositoryId },
    });
    return { accepted: true, duplicate: false, deliveryId };
  }
}

function normalizeEvent(eventName: string, payload: unknown): Record<string, unknown> | null {
  const mapped =
    eventName === 'pull_request'
      ? mapPullRequestEvent(payload)
      : eventName === 'pull_request_review'
        ? mapReviewEvent(payload)
        : mapCheckEvent(eventName, payload);
  return mapped ? { ...mapped } : null;
}
