import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      service: 'codeer-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
