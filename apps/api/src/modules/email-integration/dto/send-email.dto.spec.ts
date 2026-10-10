import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SendEmailDto } from './send-email.dto';

// Security regression (Phase 3I): GmailClient.buildMimeMessage() hand-builds
// raw RFC 2822 headers from these fields -- an embedded \r\n would let a
// subject (or, via SendEmailAttachmentDto, a filename/contentType) smuggle
// in an extra header, such as a hidden Bcc. These fields must reject line
// breaks at the validation layer, before any provider client ever sees them.
function baseDtoInput() {
  return {
    provider: 'google',
    to: ['recipient@example.com'],
    subject: 'A normal subject',
    bodyText: 'Hello',
    idempotencyKey: 'idem-1',
  };
}

describe('SendEmailDto validation', () => {
  it('accepts a normal, line-break-free subject', async () => {
    const dto = plainToInstance(SendEmailDto, baseDtoInput());
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a subject containing an embedded CRLF (header-injection attempt)', async () => {
    const dto = plainToInstance(SendEmailDto, { ...baseDtoInput(), subject: 'Legit subject\r\nBcc: attacker@evil.com' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'subject')).toBe(true);
  });

  it('rejects a subject containing a bare line feed', async () => {
    const dto = plainToInstance(SendEmailDto, { ...baseDtoInput(), subject: 'line one\nline two' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'subject')).toBe(true);
  });

  it('rejects an attachment filename containing an embedded CRLF', async () => {
    const dto = plainToInstance(SendEmailDto, {
      ...baseDtoInput(),
      attachments: [{ storageKey: 'k', filename: 'evil.pdf\r\nX-Injected: 1', contentType: 'application/pdf' }],
    });
    const errors = await validate(dto, { whitelist: false });
    const attachmentErrors = errors.find((e) => e.property === 'attachments')?.children?.[0]?.children ?? [];
    expect(attachmentErrors.some((e) => e.property === 'filename')).toBe(true);
  });
});
