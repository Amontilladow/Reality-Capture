import { describe, expect, it } from 'vitest';
import { normalizePath } from './web-vitals';

describe('normalizePath', () => {
  it('collapses UUIDs and share tokens, keeps named routes', () => {
    expect(normalizePath('/projects/3f2b1c9e-0a4d-4f2e-9b1a-1234567890ab/rfis/main')).toBe('/projects/:id/rfis/main');
    expect(normalizePath('/progress-report/AbCdEfGhIjKlMnOp1234')).toBe('/progress-report/:id');
    expect(normalizePath('/login?next=/x')).toBe('/login');
  });
});
