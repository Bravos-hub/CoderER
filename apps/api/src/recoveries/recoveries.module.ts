import { Module } from '@nestjs/common';
import { IncidentRecoveriesController } from './incident-recoveries.controller.js';
import { RecoveriesController } from './recoveries.controller.js';
import { RecoveriesService } from './recoveries.service.js';
import { TreatmentPlanRecoveriesController } from './treatment-plan-recoveries.controller.js';

@Module({
  controllers: [
    TreatmentPlanRecoveriesController,
    IncidentRecoveriesController,
    RecoveriesController,
  ],
  providers: [RecoveriesService],
  exports: [RecoveriesService],
})
export class RecoveriesModule {}
