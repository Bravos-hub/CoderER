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
import { requestContext } from '../security/request-context.middleware.js';
import { ReproductionsService } from './reproductions.service.js';

function actorContext(request: Request): StoreActorContext {
  return requestContext(request);
}

@Controller()
export class ReproductionsController {
  constructor(private readonly reproductionsService: ReproductionsService) {}

  @Post('incidents/:incidentId/reproductions')
  @HttpCode(202)
  create(
    @Req() request: Request,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Body() input: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.reproductionsService.create(
      actorContext(request),
      incidentId,
      input,
      idempotencyKey,
    );
  }

  @Get('incidents/:incidentId/reproductions')
  list(
    @Req() request: Request,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.reproductionsService.list(actorContext(request), incidentId, query);
  }

  @Get('reproductions/:reproductionId')
  get(
    @Req() request: Request,
    @Param('reproductionId', new ParseUUIDPipe({ version: '4' })) reproductionId: string,
  ) {
    return this.reproductionsService.get(actorContext(request), reproductionId);
  }

  @Post('reproductions/:reproductionId/cancel')
  @HttpCode(202)
  cancel(
    @Req() request: Request,
    @Param('reproductionId', new ParseUUIDPipe({ version: '4' })) reproductionId: string,
  ) {
    return this.reproductionsService.cancel(actorContext(request), reproductionId);
  }

  @Get('reproductions/:reproductionId/logs')
  logs(
    @Req() request: Request,
    @Param('reproductionId', new ParseUUIDPipe({ version: '4' })) reproductionId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.reproductionsService.logs(actorContext(request), reproductionId, query);
  }

  @Get('reproductions/:reproductionId/artifacts')
  artifacts(
    @Req() request: Request,
    @Param('reproductionId', new ParseUUIDPipe({ version: '4' })) reproductionId: string,
  ) {
    return this.reproductionsService.artifacts(actorContext(request), reproductionId);
  }
}
