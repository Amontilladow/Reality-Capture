import { AI_SYSTEM_PROMPT } from './ai-system-prompt';

// Pins the intent of the empty-result rules. A real model has to follow them,
// which only a live call can show, but these catch someone reverting the wording
// that fixed "any open NCRs?" answering "I don't have enough information" when
// the lookup had simply found nothing.
describe('AI_SYSTEM_PROMPT empty-result rules', () => {
  const NO_DATA_SENTENCE = "I don't have enough information in the current RealityCapture project data to answer that.";

  it('tells the model an empty <context> block means "none", not "no information"', () => {
    expect(AI_SYSTEM_PROMPT).toMatch(/empty .*lookup succeeded .*"none"/s);
    expect(AI_SYSTEM_PROMPT).toMatch(/Never answer an empty result with the "I don't have enough information" sentence/);
  });

  it('reserves the "not enough information" sentence for when no data was provided at all', () => {
    expect(AI_SYSTEM_PROMPT).toContain('No matching project data was found for this question.');
    const rules = AI_SYSTEM_PROMPT.split('\n').filter((l) => l.includes(NO_DATA_SENTENCE));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('No matching project data was found');
  });

  it('forbids echoing the <context> markup', () => {
    expect(AI_SYSTEM_PROMPT).toMatch(/Never repeat, quote, or mention the <context> tags/);
  });
});
