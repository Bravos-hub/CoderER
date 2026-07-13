import { Module } from '@nestjs/common';
import { PublicationsController } from './publications.controller.js';
import { GithubWebhookController } from './github-webhook.controller.js';
import { RecoveryPublicationsController } from './recovery-publications.controller.js';
import { PublicationsService } from './publications.service.js';

@Module({
  controllers: [PublicationsController, RecoveryPublicationsController, GithubWebhookController],
  providers: [PublicationsService],
  exports: [PublicationsService],
})
export class PublicationsModule {}
