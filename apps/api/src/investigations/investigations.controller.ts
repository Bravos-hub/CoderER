import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requestContext } from '../security/request-context.middleware.js';
import { InvestigationsService } from './investigations.service.js';

@Controller('investigations')
export class InvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get()
  list(@Req() request: Request, @Query() query: Record<string, unknown>) {
    return this.investigations.listOrganization(requestContext(request), query);
  }

  @Get(':investigationId')
  get(
    @Req() request: Request,
    @Param('investigationId', new ParseUUIDPipe({ version: '4' })) investigationId: string,
  ) {
    return this.investigations.get(requestContext(request), investigationId);
  }

  @Post(':investigationId/cancel')
  @HttpCode(202)
  cancel(
    @Req() request: Request,
    @Param('investigationId', new ParseUUIDPipe({ version: '4' })) investigationId: string,
  ) {
    return this.investigations.cancel(requestContext(request), investigationId);
  }

  @Post(':investigationId/resume')
  @HttpCode(202)
  resume(
    @Req() request: Request,
    @Param('investigationId', new ParseUUIDPipe({ version: '4' })) investigationId: string,
  ) {
    return this.investigations.resume(requestContext(request), investigationId);
  }

  @Get(':investigationId/events')
  events(
    @Req() request: Request,
    @Param('investigationId', new ParseUUIDPipe({ version: '4' })) investigationId: string,
    @Query('afterSequence') afterSequence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.investigations.events(
      requestContext(request),
      investigationId,
      afterSequence,
      limit,
    );
  }

  @Get(':investigationId/tool-calls')
  toolCalls(
    @Req() request: Request,
    @Param('investigationId', new ParseUUIDPipe({ version: '4' })) investigationId: string,
    @Query('limit') limit?: string,
  ) {
    return this.investigations.toolCalls(requestContext(request), investigationId, limit);
  }

  @Get(':investigationId/diagnosis')
  diagnosis(
    @Req() request: Request,
    @Param('investigationId', new ParseUUIDPipe({ version: '4' })) investigationId: string,
  ) {
    return this.investigations.diagnosis(requestContext(request), investigationId);
  }

  @Get(':investigationId/treatment-plans')
  treatmentPlans(
    @Req() request: Request,
    @Param('investigationId', new ParseUUIDPipe({ version: '4' })) investigationId: string,
  ) {
    return this.investigations.treatmentPlans(requestContext(request), investigationId);
  }
}
