import { ContextMarkupFilter, stripContextMarkup } from './answer-sanitizer';

// Runs a reply through the filter the way the stream does: split into the given
// chunks, push each, then flush.
function streamed(chunks: string[]): string {
  const filter = new ContextMarkupFilter();
  return chunks.map((c) => filter.push(c)).join('') + filter.flush();
}

const ECHO = '<context type="getOpenNcrs">[]</context>';
const ANSWER = 'There are no open NCRs on this project.';

describe('ContextMarkupFilter / stripContextMarkup', () => {
  it('leaves an ordinary answer untouched', () => {
    expect(stripContextMarkup(ANSWER)).toBe(ANSWER);
  });

  it('removes an echoed context block (the exact leak seen in production)', () => {
    expect(stripContextMarkup(`${ECHO}\n\n${ANSWER}`)).toBe(ANSWER);
  });

  it('removes several echoed blocks and keeps the text around them', () => {
    const text = `Checked: ${ECHO} and <context type="getOpenSors">[{"a":1}]</context> done.`;
    expect(stripContextMarkup(text)).toBe('Checked:  and  done.');
  });

  it('gives the same result however the stream is split into chunks', () => {
    const full = `${ECHO}\n\n${ANSWER}`;
    for (let i = 1; i < full.length; i++) {
      expect(streamed([full.slice(0, i), full.slice(i)])).toBe(ANSWER);
    }
    // and one character at a time
    expect(streamed(full.split(''))).toBe(ANSWER);
  });

  it('holds back a possible tag start but releases it once it is clearly plain text', () => {
    const filter = new ContextMarkupFilter();
    expect(filter.push('Cost is 5 <')).toBe('Cost is 5 ');
    expect(filter.push(' 6 dollars')).toBe('< 6 dollars');
    expect(filter.flush()).toBe('');
  });

  it('does not treat a different tag as a context block', () => {
    expect(stripContextMarkup('Use <b>bold</b> and <contact> details')).toBe('Use <b>bold</b> and <contact> details');
  });

  it('drops an unterminated echoed block instead of showing half of it', () => {
    expect(stripContextMarkup(`${ANSWER} <context type="x">[1,2`)).toBe(ANSWER);
  });

  it('keeps whitespace between words and only trims the start of the reply', () => {
    expect(streamed(['  ', ECHO, '\n', 'Two  open', ' NCRs.'])).toBe('Two  open NCRs.');
  });
});
