import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async check() {
    const dbOk = await this.db.ping();
    return {
      status: dbOk ? 'ok' : 'degraded',
      service: 'ifc-service',
      timestamp: new Date().toISOString(),
      database: dbOk ? 'ok' : 'unreachable',
    };
  }
}
