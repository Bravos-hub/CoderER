import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requestContext } from '../security/request-context.middleware.js';
import { PublicationsService } from './publications.service.js';

@Controller('recoveries/:recoveryId/publications')
export class RecoveryPublicationsController {
  constructor(private readonly publications: PublicationsService) {}

  @Post()
  create(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
    @Body() input: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.publications.create(requestContext(request), recoveryId, input, idempotencyKey);
  }

  @Get()
  list(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
  ) {
    return this.publications.listForRecovery(requestContext(request), recoveryId);
  }
}
