import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { AdmitRepositoryInput, RepositoryIntakeView } from '@codeer/contracts';
import { RepositoriesService } from './repositories.service.js';

@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Post('intakes')
  admit(@Body() input: AdmitRepositoryInput): Promise<RepositoryIntakeView> {
    return this.repositoriesService.admit(input);
  }

  @Get('intakes')
  list(): Promise<RepositoryIntakeView[]> {
    return this.repositoriesService.list();
  }

  @Get('intakes/:intakeId')
  get(
    @Param('intakeId', new ParseUUIDPipe({ version: '4' })) intakeId: string,
  ): Promise<RepositoryIntakeView> {
    return this.repositoriesService.get(intakeId);
  }
}
