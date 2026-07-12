import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { requestContext } from '../security/request-context.middleware.js';
import { InvestigationsService } from './investigations.service.js';

@Controller('incidents/:incidentId/investigations')
export class IncidentInvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Post()
  @HttpCode(202)
  create(
    @Req() request: Request,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Body() input: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.investigations.create(requestContext(request), incidentId, input, idempotencyKey);
  }

  @Get()
  list(
    @Req() request: Request,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.investigations.list(requestContext(request), incidentId, query);
  }
}
