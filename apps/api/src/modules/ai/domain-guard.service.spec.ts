import { DomainGuardService } from './domain-guard.service';

// Locks in the exact allow/block matrix the AI rebuild spec gives as its
// minimum domain test set (section 25), plus the "block wins even if an
// in-domain word is also present" rule the service's own comment describes.
describe('DomainGuardService', () => {
  const guard = new DomainGuardService();

  describe('allows in-domain questions', () => {
    const cases = [
      'Show me my open RFIs.',
      'Which issues have risk above 7?',
      'Summarize the current project.',
      'What are the overdue snags?',
      'Explain why this issue is high risk.',
      'Summarize progress this month.',
      'Find recurring issues in Zone B.',
      'Draft an RFI based on this issue.',
      'Summarize the latest project report.',
    ];
    it.each(cases)('%s', (question) => {
      expect(guard.evaluate(question).inDomain).toBe(true);
    });
  });

  describe('blocks off-topic questions', () => {
    const cases = [
      'Tell me a joke.',
      'Write a poem.',
      'What is Bitcoin?',
      "What's the weather?",
      'Help me write a Python program.',
      'Who is the president of the USA?',
      'Write me a dating message.',
    ];
    it.each(cases)('%s', (question) => {
      expect(guard.evaluate(question).inDomain).toBe(false);
    });
  });

  it('blocks a joke request even when it mentions an in-domain word', () => {
    expect(guard.evaluate('Tell me a joke about RFIs.').inDomain).toBe(false);
  });

  it('blocks an empty question', () => {
    expect(guard.evaluate('   ').inDomain).toBe(false);
  });

  it('blocks a question matching neither list (ambiguous defaults to blocked)', () => {
    expect(guard.evaluate('asdkfj qwerty 12345').inDomain).toBe(false);
  });

  // Owner request: "make sure users won't use the AI assistant beyond the
  // platform." These are real phrasings that used to pass as in-domain
  // under the old single-keyword-presence list (verified before this fix),
  // because a bare action word with no construction noun was enough
  // ("explain"/"status"/"summarize"/"critical"/"open"/"closed") or because
  // the matched noun is also common outside construction ("who built that
  // famous building", "what level is this video game on").
  describe('closes previously-demonstrated bypasses', () => {
    const cases = [
      'Explain the theory of relativity',
      'What is the status of the French Revolution',
      'Give me a summary of World War 2',
      'Who built the Eiffel Tower, that famous building',
      'Give me the priority queue algorithm in Python',
      'What level is this video game on?',
    ];
    it.each(cases)('%s', (question) => {
      expect(guard.evaluate(question).inDomain).toBe(false);
    });
  });

  describe('strength', () => {
    it('is "strong" for jargon essentially unique to this platform', () => {
      expect(guard.evaluate('Show me my open RFIs.')).toMatchObject({ inDomain: true, strength: 'strong' });
      expect(guard.evaluate('Which issues have risk above 7?')).toMatchObject({ inDomain: true, strength: 'strong' });
    });

    it('is "weak" for a real construction term that is also common in everyday English', () => {
      expect(guard.evaluate('What building is this drawing for?')).toMatchObject({ inDomain: true, strength: 'weak' });
      expect(guard.evaluate('What zone is this in?')).toMatchObject({ inDomain: true, strength: 'weak' });
    });

    it('is "strong" (skips the extra check) when a weak word co-occurs with a strong one', () => {
      expect(guard.evaluate("The designer's contact is needed for this project.")).toMatchObject({ inDomain: true, strength: 'strong' });
    });
  });
});
