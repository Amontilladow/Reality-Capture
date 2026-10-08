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
});
