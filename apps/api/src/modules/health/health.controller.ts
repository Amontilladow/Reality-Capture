import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseService } from '../../database/database.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check — used by load balancers' })
  async check() {
    const dbOk = await this.db.ping();
    const status = dbOk ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      services: { database: dbOk ? 'ok' : 'error' },
    };
  }
}