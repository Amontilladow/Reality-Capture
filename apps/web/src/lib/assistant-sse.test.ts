import { describe, expect, it } from 'vitest';
import { createSseParser } from './assistant.api';

describe('createSseParser', () => {
  it('parses complete frames with their event names', () => {
    const parse = createSseParser();
    expect(parse('event: delta\ndata: {"text":"Hi"}\n\nevent: done\ndata: {"answer":"Hi"}\n\n')).toEqual([
      { event: 'delta', data: '{"text":"Hi"}' },
      { event: 'done', data: '{"answer":"Hi"}' },
    ]);
  });

  it('holds a frame split across network chunks until it is complete', () => {
    const parse = createSseParser();
    expect(parse('event: delta\nda')).toEqual([]);
    expect(parse('ta: {"text":"a"}\n')).toEqual([]);
    expect(parse('\nevent: delta\ndata: {"text":"b"}\n\n')).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'delta', data: '{"text":"b"}' },
    ]);
  });

  it('accepts CRLF line endings and defaults the event name to "message"', () => {
    const parse = createSseParser();
    expect(parse('data: x\r\n\r\n')).toEqual([{ event: 'message', data: 'x' }]);
  });
});
