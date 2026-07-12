import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { requestContext } from '../security/request-context.middleware.js';
import { RecoveriesService } from './recoveries.service.js';

@Controller('treatment-plans/:planId/recoveries')
export class TreatmentPlanRecoveriesController {
  constructor(private readonly recoveries: RecoveriesService) {}

  @Post()
  @HttpCode(202)
  create(
    @Req() request: Request,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Body() input: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.recoveries.create(requestContext(request), planId, input, idempotencyKey);
  }
}
