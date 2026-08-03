import { createHash } from 'crypto';
import { digest, captureGenerationVersions } from './provenance.util';

describe('digest', () => {
  it('returns a SHA-256 hex digest and byte size matching the input', () => {
    const bytes = new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;');
    const result = digest(bytes);

    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different input, same hash for identical input', () => {
    const a = digest(new Uint8Array([1, 2, 3]));
    const b = digest(new Uint8Array([1, 2, 3]));
    const c = digest(new Uint8Array([1, 2, 4]));

    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
  });

  it('hashes an empty buffer without throwing', () => {
    const result = digest(new Uint8Array(0));
    expect(result.sizeBytes).toBe(0);
    expect(result.sha256).toBe(createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  });
});

describe('captureGenerationVersions', () => {
  it('reads the actual running Node version and installed package versions', () => {
    const versions = captureGenerationVersions();

    expect(versions.nodeVersion).toBe(process.version);
    // Real installed versions, not hardcoded strings -- pinned in
    // package.json, must match what pnpm-lock.yaml actually resolved.
    expect(versions.fragmentsVersion).toBe('3.4.6');
    expect(versions.webIfcVersion).toBe('0.0.77');
  });

  it('falls back to null for gitCommit when RENDER_GIT_COMMIT is not set', () => {
    const original = process.env.RENDER_GIT_COMMIT;
    delete process.env.RENDER_GIT_COMMIT;
    try {
      expect(captureGenerationVersions().gitCommit).toBeNull();
    } finally {
      if (original !== undefined) process.env.RENDER_GIT_COMMIT = original;
    }
  });

  it('reports gitCommit when RENDER_GIT_COMMIT is set', () => {
    const original = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = 'abc1234';
    try {
      expect(captureGenerationVersions().gitCommit).toBe('abc1234');
    } finally {
      if (original === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = original;
    }
  });
});
