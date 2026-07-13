import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebhookReplayGuard, verifyGithubWebhookSignature } from '@codeer/publication';

const replayGuard = new WebhookReplayGuard(
  Number(process.env.GITHUB_WEBHOOK_REPLAY_WINDOW_SECONDS ?? 600),
);

@Controller('webhooks')
export class GithubWebhookController {
  @Post('github')
  receive(
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
    if (!deliveryId || !eventName)
      throw new BadRequestException('Required GitHub headers are missing.');
    if (
      !verifyGithubWebhookSignature({
        secret,
        rawBody: request.rawBody,
        signatureHeader: signature,
      })
    ) {
      throw new BadRequestException('GitHub webhook signature is invalid.');
    }
    if (!replayGuard.accept(deliveryId)) {
      return { accepted: true, duplicate: true, deliveryId };
    }
    return {
      accepted: true,
      duplicate: false,
      deliveryId,
      eventName,
      action:
        request.body &&
        typeof request.body === 'object' &&
        'action' in request.body &&
        typeof (request.body as { action?: unknown }).action === 'string'
          ? (request.body as { action: string }).action
          : null,
    };
  }
}
