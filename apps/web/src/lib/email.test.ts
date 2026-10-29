import { describe, expect, it } from 'vitest';
import { buildMailtoHref, isValidEmail } from './email';

describe('isValidEmail', () => {
  it.each([
    'jane.doe@m4contracting.ae',
    'a@b.co',
    'first.last+tag@sub.example.com',
  ])('accepts %s', (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each([
    '',
    'not-an-email',
    'missing-domain@',
    '@missing-local.com',
    'no-dot@localhost',
    'has space@example.com',
    'two@@example.com',
    null,
    undefined,
    'a'.repeat(250) + '@example.com', // over the 254-char cap
  ])('rejects %s', (value) => {
    expect(isValidEmail(value as string)).toBe(false);
  });
});

describe('buildMailtoHref', () => {
  it('builds a bare mailto: link for a valid address with no options', () => {
    expect(buildMailtoHref('jane.doe@m4contracting.ae')).toBe('mailto:jane.doe@m4contracting.ae');
  });

  it('returns null for an invalid address -- never builds an unsafe link', () => {
    expect(buildMailtoHref('not-an-email')).toBeNull();
  });

  it('appends an encoded subject and body as query parameters', () => {
    const href = buildMailtoHref('jane.doe@m4contracting.ae', { subject: 'Re: RFI 12', body: 'See attached' });
    expect(href).not.toBeNull();
    expect(href!.startsWith('mailto:jane.doe@m4contracting.ae?')).toBe(true);
    // Round-trip through URLSearchParams rather than asserting an exact
    // encoded string -- only the decoded values matter, not which of the
    // (several, equally valid) encodings was chosen for the space character.
    const query = new URLSearchParams(href!.split('?')[1]);
    expect(query.get('subject')).toBe('Re: RFI 12');
    expect(query.get('body')).toBe('See attached');
  });

  it('safely encodes subject/body text that looks like it could break the URL', () => {
    const href = buildMailtoHref('jane.doe@m4contracting.ae', { subject: 'A & B? #1 100%' });
    expect(href).not.toContain('A & B? #1 100%'); // raw, unencoded text must not appear
    const query = new URLSearchParams(href!.split('?')[1]);
    expect(query.get('subject')).toBe('A & B? #1 100%'); // but decodes back to the original
  });

  it('omits the query string entirely when no subject or body is given', () => {
    expect(buildMailtoHref('jane.doe@m4contracting.ae')).not.toContain('?');
  });
});
