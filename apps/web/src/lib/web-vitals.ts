import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { API_BASE } from './api';

// Real user monitoring: Core Web Vitals as measured in each visitor's own
// browser, sent to POST /telemetry/web-vitals (apps/api's TelemetryModule),
// which writes them to the API log for aggregation. One small request per
// page view, sent when the tab is hidden or closed (when CLS/INP are final).

// Id-like path segments (UUIDs, share-link tokens, which are credentials)
// become ':id', so reports group by page and never carry a token.
export function normalizePath(path: string): string {
  return path
    .split('?')[0]
    .split('/')
    .map((seg) => (/^[A-Za-z0-9_-]{16,}$/.test(seg) ? ':id' : seg))
    .join('/')
    .slice(0, 200);
}

export function startWebVitals(endpoint = `${API_BASE}/telemetry/web-vitals`): void {
  // LCP/FCP/TTFB describe the page the visitor first loaded, not wherever
  // client-side routing has taken them by the time the report is sent.
  const path = normalizePath(window.location.pathname);
  let pending: Metric[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const body = JSON.stringify({
      path,
      metrics: pending.map((m) => ({ name: m.name, value: m.value, rating: m.rating, navigationType: m.navigationType })),
    });
    pending = [];
    // keepalive lets the request finish after the page is gone; unlike
    // sendBeacon it can send a JSON content type cross-origin (the API
    // already allows it through CORS).
    void fetch(endpoint, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => undefined);
  };

  const queue = (metric: Metric) => { pending.push(metric); };
  onCLS(queue);
  onFCP(queue);
  onINP(queue);
  onLCP(queue);
  onTTFB(queue);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}
