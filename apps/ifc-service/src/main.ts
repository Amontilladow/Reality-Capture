import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3100;
  await app.listen(port);
  Logger.log(`ifc-service listening on port ${port} (health checks + Bull worker running in-process)`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error('ifc-service failed to start', error instanceof Error ? error.stack : String(error), 'Bootstrap');
  process.exit(1);
});
