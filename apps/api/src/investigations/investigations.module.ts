import { Module } from '@nestjs/common';
import { IncidentInvestigationsController } from './incident-investigations.controller.js';
import { InvestigationsController } from './investigations.controller.js';
import { TreatmentPlansController } from './treatment-plans.controller.js';
import { InvestigationsService } from './investigations.service.js';

@Module({
  controllers: [
    IncidentInvestigationsController,
    InvestigationsController,
    TreatmentPlansController,
  ],
  providers: [InvestigationsService],
  exports: [InvestigationsService],
})
export class InvestigationsModule {}
