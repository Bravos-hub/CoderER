import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AdmitRepositoryInput, RepositoryIntakeView } from '@codeer/contracts';
import { RepositoriesService } from './repositories.service.js';
import { requestContext } from '../security/request-context.middleware.js';

@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Post('intakes')
  admit(
    @Req() request: Request,
    @Body() input: AdmitRepositoryInput,
  ): Promise<RepositoryIntakeView> {
    return this.repositoriesService.admit(requestContext(request), input);
  }

  @Get('intakes')
  list(@Req() request: Request): Promise<RepositoryIntakeView[]> {
    return this.repositoriesService.list(requestContext(request));
  }

  @Get('intakes/:intakeId')
  get(
    @Req() request: Request,
    @Param('intakeId', new ParseUUIDPipe({ version: '4' })) intakeId: string,
  ): Promise<RepositoryIntakeView> {
    return this.repositoriesService.get(requestContext(request), intakeId);
  }
}
