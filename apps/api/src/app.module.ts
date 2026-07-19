import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadApiConfig } from '@codeer/config';
import { HealthController } from './health.controller.js';
import { IncidentsModule } from './incidents/incidents.module.js';
import { RepositoriesModule } from './repositories/repositories.module.js';
import { ReproductionsModule } from './reproductions/reproductions.module.js';
import { InvestigationsModule } from './investigations/investigations.module.js';
import { RecoveriesModule } from './recoveries/recoveries.module.js';
import { PublicationsModule } from './publications/publications.module.js';
import { SettingsModule } from './settings/settings.module.js';

const config = loadApiConfig(process.env);

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: config.RATE_LIMIT_TTL_MS,
        limit: config.RATE_LIMIT_LIMIT,
      },
    ]),
    IncidentsModule,
    RepositoriesModule,
    ReproductionsModule,
    InvestigationsModule,
    RecoveriesModule,
    PublicationsModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
