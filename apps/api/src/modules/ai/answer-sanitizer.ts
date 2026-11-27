// The assistant's prompt wraps each tool result in <context type="...">json</context>
// tags (see buildContextBlock() in ai.service.ts). Some models (observed with
// Gemini flash-lite on an empty result) echo that block straight back into
// their reply, so the user sees raw markup such as
// <context type="getOpenNcrs">[]</context> in the chat. The prompt tells the
// model not to, but a prompt is a request, not a guarantee, so this strips the
// markup in code.
//
// Replies are streamed to the browser chunk by chunk, so the filter must work
// on a stream: a tag can be split across chunks at any point ("<con" + "text ...").
// It holds back only a trailing piece that could still turn into "<context",
// and releases it as soon as it is clear it is ordinary text.
const OPEN = '<context';
const CLOSE = '</context>';

export class ContextMarkupFilter {
  private buf = '';
  private inside = false;
  private started = false;

  /** Feed one streamed chunk; returns the text that is safe to show now. */
  push(chunk: string): string {
    this.buf += chunk;
    let out = '';

    for (;;) {
      if (this.inside) {
        const end = this.buf.indexOf(CLOSE);
        if (end === -1) {
          // Still inside the echoed block: discard it, keeping only a tail that
          // might be the start of the closing tag.
          this.buf = this.buf.slice(-(CLOSE.length - 1));
          return this.release(out);
        }
        this.buf = this.buf.slice(end + CLOSE.length);
        this.inside = false;
        continue;
      }

      const start = this.buf.indexOf(OPEN);
      if (start !== -1) {
        out += this.buf.slice(0, start);
        this.buf = this.buf.slice(start + OPEN.length);
        this.inside = true;
        continue;
      }

      // No complete opening tag. Hold back a trailing fragment that is a prefix
      // of it ("<", "<con", ...); everything before that is plain text.
      const keep = partialPrefixLength(this.buf);
      out += this.buf.slice(0, this.buf.length - keep);
      this.buf = this.buf.slice(this.buf.length - keep);
      return this.release(out);
    }
  }

  /** Call once when the stream ends; returns anything still held back. */
  flush(): string {
    const rest = this.inside ? '' : this.buf; // an unterminated echoed block is dropped
    this.buf = '';
    this.inside = false;
    return this.release(rest);
  }

  // Drop whitespace left behind where a block was removed, but only at the very
  // start of the reply; whitespace between real words is untouched.
  private release(text: string): string {
    if (!this.started) {
      text = text.replace(/^\s+/, '');
      if (text) this.started = true;
    }
    return text;
  }
}

function partialPrefixLength(s: string): number {
  const max = Math.min(OPEN.length - 1, s.length);
  for (let n = max; n > 0; n--) {
    if (s.endsWith(OPEN.slice(0, n))) return n;
  }
  return 0;
}

/** Non-streaming convenience: strip echoed <context> blocks from a full reply. */
export function stripContextMarkup(text: string): string {
  const filter = new ContextMarkupFilter();
  return (filter.push(text) + filter.flush()).trim();
}
