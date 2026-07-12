import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { databaseStatus } from '@codeer/database';

@Controller('health')
export class HealthController {
  @Get()
  liveness() {
    return {
      service: 'codeer-api',
      status: 'ok',
      check: 'liveness',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async readiness() {
    const database = await databaseStatus();
    if (!database.connected) {
      throw new ServiceUnavailableException({
        service: 'codeer-api',
        status: 'not-ready',
        check: 'readiness',
        database,
      });
    }
    return {
      service: 'codeer-api',
      status: 'ready',
      check: 'readiness',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
