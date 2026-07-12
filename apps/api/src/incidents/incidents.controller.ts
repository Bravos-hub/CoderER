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
import type { StoreActorContext } from '@codeer/database';
import { IncidentsService } from './incidents.service.js';
import { requestContext } from '../security/request-context.middleware.js';

function actorContext(request: Request): StoreActorContext {
  return requestContext(request);
}

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  list(@Req() request: Request, @Query() query: Record<string, unknown>) {
    return this.incidentsService.list(actorContext(request), query);
  }

  @Get(':id')
  get(@Req() request: Request, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.incidentsService.get(actorContext(request), id);
  }

  @Post()
  create(
    @Req() request: Request,
    @Body() input: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.incidentsService.create(actorContext(request), input, idempotencyKey);
  }

  @Post(':id/evidence')
  addEvidence(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: unknown,
  ) {
    return this.incidentsService.addEvidence(actorContext(request), id, input);
  }

  @Post(':id/triage')
  @HttpCode(202)
  requestTriage(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: unknown,
  ) {
    return this.incidentsService.requestTriage(actorContext(request), id, input);
  }

  @Post(':id/transitions')
  transition(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: unknown,
  ) {
    return this.incidentsService.transition(actorContext(request), id, input);
  }
}
