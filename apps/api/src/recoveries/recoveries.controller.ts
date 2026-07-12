import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PublicationDecision } from '@codeer/contracts';
import { requestContext } from '../security/request-context.middleware.js';
import { RecoveriesService } from './recoveries.service.js';

@Controller('recoveries')
export class RecoveriesController {
  constructor(private readonly recoveries: RecoveriesService) {}

  @Get(':recoveryId')
  get(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
  ) {
    return this.recoveries.get(requestContext(request), recoveryId);
  }

  @Post(':recoveryId/cancel')
  @HttpCode(202)
  cancel(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
  ) {
    return this.recoveries.cancel(requestContext(request), recoveryId);
  }

  @Post(':recoveryId/resume')
  @HttpCode(202)
  resume(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
  ) {
    return this.recoveries.resume(requestContext(request), recoveryId);
  }

  @Get(':recoveryId/events')
  events(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
    @Query('afterSequence') afterSequence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.recoveries.events(requestContext(request), recoveryId, afterSequence, limit);
  }

  @Get(':recoveryId/patches')
  patch(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
  ) {
    return this.recoveries.patch(requestContext(request), recoveryId);
  }

  @Get(':recoveryId/patches/:patchVersion')
  patchVersion(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
    @Param('patchVersion', ParseIntPipe) patchVersion: number,
  ) {
    return this.recoveries.patchVersion(requestContext(request), recoveryId, patchVersion);
  }

  @Post(':recoveryId/request-revision')
  @HttpCode(202)
  requestRevision(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
    @Body() input: unknown,
  ) {
    return this.recoveries.requestRevision(requestContext(request), recoveryId, input);
  }

  @Get(':recoveryId/security-review')
  securityReview(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
  ) {
    return this.recoveries.securityReview(requestContext(request), recoveryId);
  }

  @Get(':recoveryId/verification')
  verification(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
  ) {
    return this.recoveries.verification(requestContext(request), recoveryId);
  }

  @Get(':recoveryId/pull-request-package')
  pullRequestPackage(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
  ) {
    return this.recoveries.pullRequestPackage(requestContext(request), recoveryId);
  }

  @Post(':recoveryId/approve-publication')
  approvePublication(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
    @Body() input: unknown,
  ) {
    return this.recoveries.decidePublication(
      requestContext(request),
      recoveryId,
      PublicationDecision.APPROVE,
      input,
    );
  }

  @Post(':recoveryId/reject-publication')
  rejectPublication(
    @Req() request: Request,
    @Param('recoveryId', new ParseUUIDPipe({ version: '4' })) recoveryId: string,
    @Body() input: unknown,
  ) {
    return this.recoveries.decidePublication(
      requestContext(request),
      recoveryId,
      PublicationDecision.REJECT,
      input,
    );
  }
}
