import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IncidentsService } from './incidents.service.js';
import { requestContext } from '../security/request-context.middleware.js';

@Controller('repositories')
export class RepositoryHealthController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get(':repositoryId/health/latest')
  latest(
    @Req() request: Request,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' })) repositoryId: string,
  ) {
    return this.incidentsService.latestRepositoryHealth(requestContext(request), repositoryId);
  }
}
