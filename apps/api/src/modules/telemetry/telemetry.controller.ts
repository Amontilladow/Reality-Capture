import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { WebVitalsReportDto } from './dto/web-vitals.dto';

// Collapses any id-like path segment (UUIDs, and the opaque share-link
// tokens in /rfi/external/:token etc., which are credentials) so reports
// group by page and never record a token. The browser does the same before
// sending; this is the server-side guarantee.
export function normalizePath(path: string): string {
  return path
    .split('?')[0]
    .split('/')
    .map((seg) => (/^[A-Za-z0-9_-]{16,}$/.test(seg) ? ':id' : seg))
    .join('/')
    .slice(0, 200);
}

// Real user monitoring: Core Web Vitals (LCP, INP, CLS, plus FCP/TTFB)
// measured in real browsers by apps/web (src/lib/web-vitals.ts). Written as
// one structured log line per page view, so Render's log search (or any log
// drain) can aggregate p75 per page; with OpenTelemetry enabled the request
// also appears as a span. Public because it is also sent from the signed-out
// landing page; it accepts only these few numeric fields and stores nothing.
@ApiTags('telemetry')
@Controller('telemetry')
export class TelemetryController {
  private readonly logger = new Logger('WebVitals');

  @Public()
  @Post('web-vitals')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Report Core Web Vitals measured in the browser' })
  report(@Body() dto: WebVitalsReportDto): void {
    const path = normalizePath(dto.path);
    for (const m of dto.metrics) {
      this.logger.log(JSON.stringify({
        type: 'web_vital', metric: m.name, value: Math.round(m.value * 1000) / 1000,
        rating: m.rating, navigationType: m.navigationType, path,
      }));
    }
  }
}
