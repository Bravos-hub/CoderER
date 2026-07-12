import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller.js';
import { IncidentsService } from './incidents.service.js';
import { RepositoryHealthController } from './repository-health.controller.js';

@Module({
  controllers: [IncidentsController, RepositoryHealthController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
