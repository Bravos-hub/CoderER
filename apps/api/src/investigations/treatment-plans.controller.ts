import { Body, Controller, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PlanApprovalDecision } from '@codeer/contracts';
import { requestContext } from '../security/request-context.middleware.js';
import { InvestigationsService } from './investigations.service.js';

@Controller('treatment-plans')
export class TreatmentPlansController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Post(':planId/approve')
  approve(
    @Req() request: Request,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Body() input: unknown,
  ) {
    return this.investigations.decidePlan(
      requestContext(request),
      planId,
      PlanApprovalDecision.APPROVE,
      input,
    );
  }

  @Post(':planId/reject')
  reject(
    @Req() request: Request,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Body() input: unknown,
  ) {
    return this.investigations.decidePlan(
      requestContext(request),
      planId,
      PlanApprovalDecision.REJECT,
      input,
    );
  }

  @Post(':planId/request-revision')
  requestRevision(
    @Req() request: Request,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Body() input: unknown,
  ) {
    return this.investigations.decidePlan(
      requestContext(request),
      planId,
      PlanApprovalDecision.REQUEST_REVISION,
      input,
    );
  }
}
