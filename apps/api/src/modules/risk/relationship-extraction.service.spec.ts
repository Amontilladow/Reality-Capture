import { computeInferredRfiIssueConfidence, jaccard, titleWords } from './relationship-extraction.service';

describe('titleWords / jaccard — pure text-similarity helpers', () => {
  it('ignores short words and stopwords, keeping only meaningful terms', () => {
    const words = titleWords('Ceiling coordination clash at Level 12');
    expect(words.has('ceiling')).toBe(true);
    expect(words.has('coordination')).toBe(true);
    expect(words.has('at')).toBe(false); // too short
  });

  it('computes 0 similarity for completely disjoint titles', () => {
    expect(jaccard(titleWords('Ceiling coordination clash'), titleWords('Electrical panel relocation'))).toBe(0);
  });

  it('computes a high similarity for near-identical titles', () => {
    const sim = jaccard(titleWords('Ceiling coordination clash near duct'), titleWords('Ceiling coordination clash at Level 12'));
    expect(sim).toBeGreaterThan(0.3);
  });
});

describe('computeInferredRfiIssueConfidence — the "no fabricated relationship" guarantee (Scenarios B, G)', () => {
  it('Scenario G: returns null (no relationship at all) when the disciplines do not match, however similar the titles are', () => {
    const confidence = computeInferredRfiIssueConfidence('MEP', 'STRUCTURAL', 0, 'Ceiling coordination clash', 'Ceiling coordination clash');
    expect(confidence).toBeNull();
  });

  it('Scenario G: returns null when the two events are too far apart in time, even with matching discipline and identical titles', () => {
    const confidence = computeInferredRfiIssueConfidence('MEP', 'MEP', 30, 'Ceiling coordination clash', 'Ceiling coordination clash');
    expect(confidence).toBeNull();
  });

  it('Scenario B: returns a real, non-trivial confidence when discipline matches and the events are close in time', () => {
    const confidence = computeInferredRfiIssueConfidence('MEP', 'MEP', 1, 'Ceiling coordination clash at Level 12', 'Ceiling clash near duct 42');
    expect(confidence).not.toBeNull();
    expect(confidence as number).toBeGreaterThan(0);
    expect(confidence as number).toBeLessThan(1); // never presented as a confirmed (1.0) fact
  });

  it('never returns full confidence (1.0) for an inferred relationship, even in the most favorable case', () => {
    const confidence = computeInferredRfiIssueConfidence('MEP', 'MEP', 0, 'Ceiling coordination clash near duct forty two', 'Ceiling coordination clash near duct forty two');
    expect(confidence as number).toBeLessThan(1);
  });

  it('gives higher confidence to a closer-in-time pair than a farther-in-time pair, all else equal', () => {
    const close = computeInferredRfiIssueConfidence('MEP', 'MEP', 1, 'Ceiling clash', 'Ceiling clash issue');
    const far = computeInferredRfiIssueConfidence('MEP', 'MEP', 13, 'Ceiling clash', 'Ceiling clash issue');
    expect(close as number).toBeGreaterThan(far as number);
  });
});
