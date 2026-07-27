import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // ── Global prefix ────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── CORS ─────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: configService.get<string>('ALLOWED_ORIGINS', 'http://localhost:5173').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Source'],
  });

  // ── Global validation pipe ───────────────────────────────────────────────
  // Strips unknown properties, validates all DTOs, provides field-level errors
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // strip unknown properties
      forbidNonWhitelisted: true, // throw on unknown properties
      transform: true,           // auto-transform types (string → number etc)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Class serializer (handles @Exclude, @Expose decorators) ─────────────
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // ── Swagger (disabled in production) ────────────────────────────────────
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('EngineeringOS™ Reality Capture API')
      .setDescription('Architecture Specification v1.1 — Phase 1')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addTag('auth', 'Authentication and session management')
      .addTag('projects', 'Project hierarchy management')
      .addTag('captures', 'Reality capture operations')
      .addTag('issues', 'Issue tracking and defect management')
      .addTag('bim', 'BIM model and element management')
      .addTag('documents', 'Construction document integration')
      .addTag('audit', 'Audit log access and export')
      .addTag('subscription', 'Subscription and billing management')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    logger.log(`Swagger UI available at http://localhost:${port}/api/docs`);
  }

  // ── Shutdown hooks ───────────────────────────────────────────────────────
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`EngineeringOS API running on port ${port} [${nodeEnv}]`);
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error('Failed to start application', error);
  process.exit(1);
});
