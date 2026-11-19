// OpenTelemetry tracing for the API. Imported first in main.ts: the
// instrumentations work by patching modules (http, express, ioredis, the
// fetch/undici client the AI and webhook calls use) as they are required,
// so they must be registered before anything else loads them.
//
// Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set, so local dev, tests and any
// deployment without a tracing backend pay nothing. The SDK reads the rest
// of its configuration from the standard OTEL_* variables, e.g.
//   OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com
//   OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer <token>
//   OTEL_SERVICE_NAME=engineeringos-api   (defaulted below)
// Any OTLP/HTTP backend works (Grafana Cloud, Honeycomb, Datadog, a
// self-hosted collector...).
//
// postgres.js (the DB driver) has no OpenTelemetry instrumentation, so SQL
// time shows up inside each request span rather than as separate DB spans.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

export function startTracing(env: NodeJS.ProcessEnv = process.env): NodeSDK | null {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? 'engineeringos-api',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // One span per file read/write is noise, not insight.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          // Render's health checker hits this every few seconds.
          ignoreIncomingRequestHook: (req) => (req.url ?? '').startsWith('/api/v1/health'),
        },
      }),
    ],
  });
  sdk.start();

  // Flush buffered spans on shutdown (Render sends SIGTERM before replacing
  // an instance), so the last requests before a deploy aren't lost.
  process.once('SIGTERM', () => { void sdk.shutdown().catch(() => undefined); });
  return sdk;
}

startTracing();
