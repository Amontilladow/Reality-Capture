import { describe, expect, it } from 'vitest';
import { progressPercent, sheetFiles, stageLabel, symbolSummary } from './evac-plans.api';

describe('evac-plans helpers', () => {
  it('progress is a clamped whole percentage', () => {
    expect(progressPercent(undefined)).toBe(0);
    expect(progressPercent({ total: 0, done: 0 })).toBe(0);
    expect(progressPercent({ total: 7, done: 3 })).toBe(43);
    expect(progressPercent({ total: 4, done: 9 })).toBe(100);
  });

  it('stage labels read as plain words and name the current sheet', () => {
    expect(stageLabel(undefined)).toBe('Waiting for the converter');
    expect(stageLabel({ stage: 'rendering', current: 'GF-02' })).toBe('Rendering 3D · GF-02');
    expect(stageLabel({ stage: 'something new' })).toBe('something new');
  });

  it('summarises symbol counts', () => {
    expect(symbolSummary({ fire_extinguisher: 2, exit_sign: 3, odd_kind: 1 })).toBe('2 extinguishers · 3 exits · 1 odd kind');
  });

  it('finds the files of one sheet', () => {
    const outputs = [
      { path: 'previews/GF-01.png', storageKey: 'a', sizeBytes: 1 },
      { path: 'sheets/GF-01.pdf', storageKey: 'b', sizeBytes: 1 },
      { path: 'sheets/GF-010.pdf', storageKey: 'c', sizeBytes: 1 },
    ];
    const f = sheetFiles(outputs, 'GF-01');
    expect(f.preview?.storageKey).toBe('a');
    expect(f.pdf?.storageKey).toBe('b');
    expect(f.model).toBeUndefined();
  });
});
