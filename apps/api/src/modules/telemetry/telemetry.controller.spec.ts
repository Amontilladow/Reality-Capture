import { ValidationPipe } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { TelemetryController, normalizePath } from './telemetry.controller';
import { WebVitalsReportDto } from './dto/web-vitals.dto';

describe('normalizePath', () => {
  it('replaces UUIDs and share-link tokens with :id and drops the query string', () => {
    expect(normalizePath('/projects/3f2b1c9e-0a4d-4f2e-9b1a-1234567890ab/issues?issueId=x')).toBe('/projects/:id/issues');
    expect(normalizePath('/rfi/external/Zx9_aaaaBBBBccccDDDD1234')).toBe('/rfi/external/:id');
    expect(normalizePath('/projects/help')).toBe('/projects/help');
  });
});

describe('TelemetryController', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: WebVitalsReportDto });

  it('logs one structured line per metric with the normalized path', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const dto = await validate({ path: '/projects/3f2b1c9e-0a4d-4f2e-9b1a-1234567890ab', metrics: [{ name: 'LCP', value: 1234.5678, rating: 'good' }] });
    new TelemetryController().report(dto);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({ type: 'web_vital', metric: 'LCP', value: 1234.568, rating: 'good', path: '/projects/:id' });
    log.mockRestore();
  });

  it('rejects unknown metric names and extra fields', async () => {
    await expect(validate({ path: '/', metrics: [{ name: 'FID', value: 1, rating: 'good' }] })).rejects.toBeDefined();
    await expect(validate({ path: '/', metrics: [], userEmail: 'x@example.com' })).rejects.toBeDefined();
  });
});
