import { compareRevisionOrder } from './revision-order';

describe('compareRevisionOrder', () => {
  it('compares pure numeric revisions', () => {
    expect(compareRevisionOrder('1', '2')).toBe('incoming_newer');
    expect(compareRevisionOrder('2', '1')).toBe('incoming_older');
    expect(compareRevisionOrder('3', '3')).toBe('equal');
  });

  it('compares single-letter revisions', () => {
    expect(compareRevisionOrder('A', 'B')).toBe('incoming_newer');
    expect(compareRevisionOrder('C', 'A')).toBe('incoming_older');
  });

  it('places a doubled letter after every single letter -- the convention once single letters run out', () => {
    expect(compareRevisionOrder('Z', 'AA')).toBe('incoming_newer');
    expect(compareRevisionOrder('AA', 'Z')).toBe('incoming_older');
  });

  it('compares a shared non-numeric prefix with a varying trailing number', () => {
    expect(compareRevisionOrder('P1', 'P2')).toBe('incoming_newer');
    expect(compareRevisionOrder('REV-03', 'REV-02')).toBe('incoming_older');
  });

  // Test 5 from the Site Drawing Hub integrity hardening brief: an older
  // revision imported/processed after a newer one must never be read as
  // confidently newer.
  it('Test 5: an older revision imported last is never reported as newer', () => {
    expect(compareRevisionOrder('C', 'A')).toBe('incoming_older');
    expect(compareRevisionOrder('10', '3')).toBe('incoming_older');
  });

  it('is ambiguous, never a guess, when the two labels are different shapes', () => {
    expect(compareRevisionOrder('A', '1')).toBe('ambiguous');
    expect(compareRevisionOrder('P1', 'REV-2')).toBe('ambiguous');
    expect(compareRevisionOrder('1', 'A')).toBe('ambiguous');
  });

  it('is case-insensitive', () => {
    expect(compareRevisionOrder('a', 'B')).toBe('incoming_newer');
  });
});
