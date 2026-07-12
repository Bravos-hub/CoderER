import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requestContext } from '../security/request-context.middleware.js';
import { RecoveriesService } from './recoveries.service.js';

@Controller('incidents/:incidentId/recoveries')
export class IncidentRecoveriesController {
  constructor(private readonly recoveries: RecoveriesService) {}

  @Get()
  list(
    @Req() request: Request,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.recoveries.list(requestContext(request), incidentId, query);
  }
}
