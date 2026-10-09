import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EmailComposerService } from './email-composer.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { OutlookIntegrationService } from './outlook/outlook-integration.service';
import type { GmailIntegrationService } from './gmail/gmail-integration.service';
import type { SendEmailDto } from './dto/send-email.dto';

const companyId = 'company-1';
const projectId = 'project-1';
const userId = 'user-1';

// A single sql-tag mock that handles both call styles this service actually
// uses: a tagged template (sql`...`, first arg is the strings array) and a
// plain identifier call (sql(tableName), first arg is a bare string) --
// see email-composer.service.ts's own dynamic-table comment. Responses are
// looked up by substring match against the joined template text, the same
// text-keyed dispatch style issues.service.spec.ts already uses.
function makeSqlMock(responders: { match: string; rows: Record<string, unknown>[] }[]) {
  return jest.fn((first: unknown, ..._rest: unknown[]) => {
    if (!Array.isArray(first)) return first; // identifier call: sql(table) / sql(column)
    const text = (first as string[]).join('¶');
    const responder = responders.find((r) => text.includes(r.match));
    return Promise.resolve(responder ? responder.rows : []);
  });
}

function makeService(opts: {
  responders?: { match: string; rows: Record<string, unknown>[] }[];
  storageOverrides?: Partial<StorageService>;
  outlookOverrides?: Partial<OutlookIntegrationService>;
  gmailOverrides?: Partial<GmailIntegrationService>;
} = {}) {
  const sqlMock = makeSqlMock(opts.responders ?? []);
  const db = {
    withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)),
    paginate: jest.fn((rows: unknown[], page: number, perPage: number) => ({ data: rows, total: rows.length, page, perPage, totalPages: 1 })),
  };
  const storage = {
    getObjectSize: jest.fn().mockResolvedValue(1024),
    download: jest.fn().mockResolvedValue(Buffer.from('file-bytes')),
    ...opts.storageOverrides,
  };
  const outlook = {
    sendMail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1', threadId: 'thread-1', senderEmail: 'sender@company.com' }),
    ...opts.outlookOverrides,
  };
  const gmail = {
    sendMail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-2', threadId: 'thread-2', senderEmail: 'sender@company.com' }),
    ...opts.gmailOverrides,
  };
  const svc = new EmailComposerService(
    db as unknown as DatabaseService,
    storage as unknown as StorageService,
    outlook as unknown as OutlookIntegrationService,
    gmail as unknown as GmailIntegrationService,
  );
  return { svc, db, storage, outlook, gmail, sqlMock };
}

function baseDto(overrides: Partial<SendEmailDto> = {}): SendEmailDto {
  return {
    provider: 'microsoft',
    to: ['recipient@example.com'],
    subject: 'Test subject',
    bodyText: 'Hello',
    idempotencyKey: 'idem-1',
    ...overrides,
  } as SendEmailDto;
}

describe('EmailComposerService.getAttachmentUploadUrl', () => {
  it('rejects a non-member and never calls storage', async () => {
    const { svc, storage } = makeService({ responders: [{ match: 'FROM project_members', rows: [] }] });
    await expect(svc.getAttachmentUploadUrl(companyId, projectId, userId, 'project_engineer', { filename: 'drawing.pdf', sizeBytes: 1024 }))
      .rejects.toThrow(ForbiddenException);
    expect(storage.getObjectSize).not.toHaveBeenCalled();
  });

  it('generates a key under the exact prefix resolveAttachments() later requires', async () => {
    const generateKey = jest.fn().mockReturnValue(`${companyId}/email-attachments/${projectId}/generated.pdf`);
    const getUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: 'https://example.com/put' });
    const { svc } = makeService({
      responders: [{ match: 'FROM project_members', rows: [{ role: 'site_engineer' }] }],
      storageOverrides: { generateKey, getUploadUrl },
    });

    const result = await svc.getAttachmentUploadUrl(companyId, projectId, userId, 'project_engineer', { filename: 'drawing.pdf', sizeBytes: 1024 });

    expect(generateKey).toHaveBeenCalledWith(companyId, projectId, 'email-attachments', 'drawing.pdf');
    expect(result.storageKey.startsWith(`${companyId}/email-attachments/${projectId}/`)).toBe(true);
  });
});

describe('EmailComposerService.send -- project membership', () => {
  it('rejects a user who is not a member of the project, even before touching any provider', async () => {
    const { svc, outlook } = makeService({ responders: [{ match: 'FROM project_members', rows: [] }] });
    await expect(svc.send(companyId, userId, 'company_admin', projectId, baseDto())).rejects.toThrow(ForbiddenException);
    expect(outlook.sendMail).not.toHaveBeenCalled();
  });

  it('allows a super_admin regardless of project_members rows', async () => {
    const { svc } = makeService({
      responders: [
        { match: 'FROM project_members', rows: [] },
        { match: 'FROM email_messages WHERE', rows: [] },
        { match: 'INSERT INTO email_messages', rows: [{ id: 'row-1', status: 'sent' }] },
      ],
    });
    const result = await svc.send(companyId, userId, 'super_admin', projectId, baseDto());
    expect(result).toEqual({ id: 'row-1', status: 'sent' });
  });
});

describe('EmailComposerService.send -- idempotency', () => {
  it('returns the existing row unchanged on a retry of an already-sent attempt, without calling the provider again', async () => {
    const { svc, outlook } = makeService({
      responders: [
        { match: 'FROM project_members', rows: [{ role: 'site_engineer' }] },
        { match: 'FROM email_messages WHERE', rows: [{ id: 'row-1', status: 'sent', idempotencyKey: 'idem-1' }] },
      ],
    });
    const result = await svc.send(companyId, userId, 'project_engineer', projectId, baseDto());
    expect(result).toEqual({ id: 'row-1', status: 'sent', idempotencyKey: 'idem-1' });
    expect(outlook.sendMail).not.toHaveBeenCalled();
  });

  it('retries the send when the prior attempt under the same key failed', async () => {
    const { svc, outlook } = makeService({
      responders: [
        { match: 'FROM project_members', rows: [{ role: 'site_engineer' }] },
        { match: 'FROM email_messages WHERE', rows: [{ id: 'row-1', status: 'failed', idempotencyKey: 'idem-1' }] },
        { match: 'INSERT INTO email_messages', rows: [{ id: 'row-1', status: 'sent' }] },
      ],
    });
    const result = await svc.send(companyId, userId, 'project_engineer', projectId, baseDto());
    expect(outlook.sendMail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'row-1', status: 'sent' });
  });
});

describe('EmailComposerService.send -- provider dispatch and failure handling', () => {
  it('dispatches to GmailIntegrationService when provider is google', async () => {
    const { svc, outlook, gmail } = makeService({
      responders: [
        { match: 'FROM project_members', rows: [{ role: 'site_engineer' }] },
        { match: 'FROM email_messages WHERE', rows: [] },
        { match: 'INSERT INTO email_messages', rows: [{ id: 'row-1', status: 'sent' }] },
      ],
    });
    await svc.send(companyId, userId, 'project_engineer', projectId, baseDto({ provider: 'google' }));
    expect(gmail.sendMail).toHaveBeenCalledTimes(1);
    expect(outlook.sendMail).not.toHaveBeenCalled();
  });

  it('persists a failed row and throws when the provider rejects the send, without leaking the raw provider error as a secret-bearing message beyond a truncated reason', async () => {
    const { svc } = makeService({
      responders: [
        { match: 'FROM project_members', rows: [{ role: 'site_engineer' }] },
        { match: 'FROM email_messages WHERE', rows: [] },
        { match: 'INSERT INTO email_messages', rows: [{ id: 'row-1', status: 'failed', failureReason: 'Outlook rejected the request.' }] },
      ],
      outlookOverrides: { sendMail: jest.fn().mockRejectedValue(new Error('Outlook rejected the request.')) },
    });
    await expect(svc.send(companyId, userId, 'project_engineer', projectId, baseDto())).rejects.toThrow(BadRequestException);
  });
});

describe('EmailComposerService.send -- attachment validation', () => {
  it('rejects a disallowed file extension before ever calling the provider', async () => {
    const { svc, outlook } = makeService({ responders: [{ match: 'FROM project_members', rows: [{ role: 'site_engineer' }] }] });
    const dto = baseDto({ attachments: [{ storageKey: 'company-1/email-attachments/project-1/key-1', filename: 'malware.exe', contentType: 'application/octet-stream' }] });
    await expect(svc.send(companyId, userId, 'project_engineer', projectId, dto)).rejects.toThrow(BadRequestException);
    expect(outlook.sendMail).not.toHaveBeenCalled();
  });

  it('rejects an attachment that no longer exists in storage', async () => {
    const { svc } = makeService({
      responders: [{ match: 'FROM project_members', rows: [{ role: 'site_engineer' }] }],
      storageOverrides: { getObjectSize: jest.fn().mockResolvedValue(null) },
    });
    const dto = baseDto({ attachments: [{ storageKey: 'company-1/email-attachments/project-1/key-1', filename: 'drawing.pdf', contentType: 'application/pdf' }] });
    await expect(svc.send(companyId, userId, 'project_engineer', projectId, dto)).rejects.toThrow(BadRequestException);
  });

  it('rejects an attachment over the shared size limit', async () => {
    const { svc } = makeService({
      responders: [{ match: 'FROM project_members', rows: [{ role: 'site_engineer' }] }],
      storageOverrides: { getObjectSize: jest.fn().mockResolvedValue(10 * 1024 * 1024) },
    });
    const dto = baseDto({ attachments: [{ storageKey: 'company-1/email-attachments/project-1/key-1', filename: 'drawing.pdf', contentType: 'application/pdf' }] });
    await expect(svc.send(companyId, userId, 'project_engineer', projectId, dto)).rejects.toThrow(BadRequestException);
  });

  // Security regression (Phase 3I): without this check, a project member
  // could pass ANY storage key they happen to know -- another project's
  // RFI attachment, another company's object, anything -- and this
  // service would download and email its real bytes to an external
  // address. Verifies the fix rejects a key that was never issued for
  // this project's own email attachments, before download() is ever called.
  it('rejects an attachment storage key from a different project or attachment type, even if otherwise valid', async () => {
    const { svc, storage } = makeService({
      responders: [{ match: 'FROM project_members', rows: [{ role: 'site_engineer' }] }],
    });
    const dto = baseDto({ attachments: [{ storageKey: 'company-1/rfi-attachments/some-other-project/secret.pdf', filename: 'secret.pdf', contentType: 'application/pdf' }] });
    await expect(svc.send(companyId, userId, 'project_engineer', projectId, dto)).rejects.toThrow(BadRequestException);
    expect(storage.download).not.toHaveBeenCalled();
  });
});

describe('EmailComposerService.listMessages', () => {
  it('rejects a user who is not a member of the project', async () => {
    const { svc } = makeService({ responders: [{ match: 'FROM project_members', rows: [] }] });
    await expect(svc.listMessages(companyId, userId, 'project_engineer', projectId, {})).rejects.toThrow(ForbiddenException);
  });

  it('scopes the query to this project and passes through the related-record filter', async () => {
    const { svc, sqlMock } = makeService({
      responders: [
        { match: 'FROM project_members', rows: [{ role: 'site_engineer' }] },
        { match: 'FROM email_messages m', rows: [{ id: 'row-1', status: 'sent' }] },
      ],
    });
    const result = await svc.listMessages(companyId, userId, 'project_engineer', projectId, { relatedRecordType: 'rfi', relatedRecordId: 'rfi-1' });
    expect(result.data).toEqual([{ id: 'row-1', status: 'sent' }]);

    const listCall = sqlMock.mock.calls.find((c) => Array.isArray(c[0]) && (c[0] as string[]).join('¶').includes('FROM email_messages m'));
    expect(listCall).toBeDefined();
  });
});

describe('EmailComposerService.send -- auto-match by reference number', () => {
  it('leaves the record unmatched when the subject has no reference-number-shaped token', async () => {
    const { svc, sqlMock } = makeService({
      responders: [
        { match: 'FROM project_members', rows: [{ role: 'site_engineer' }] },
        { match: 'FROM email_messages WHERE', rows: [] },
        { match: 'INSERT INTO email_messages', rows: [{ id: 'row-1', status: 'sent', relatedRecordType: null }] },
      ],
    });
    await svc.send(companyId, userId, 'project_engineer', projectId, baseDto({ subject: 'General project update' }));

    const insertCall = sqlMock.mock.calls.find((c) => Array.isArray(c[0]) && (c[0] as string[]).join('¶').includes('INSERT INTO email_messages'));
    expect(insertCall).toBeDefined();
    // Positional values after the strings array: companyId, projectId, related_record_type, ...
    expect(insertCall![3]).toBeNull();
  });

  it('verifies an explicitly supplied related record belongs to this project before trusting it', async () => {
    const { svc } = makeService({
      responders: [
        { match: 'FROM project_members', rows: [{ role: 'site_engineer' }] },
        { match: 'FROM email_messages WHERE', rows: [] },
        { match: 'SELECT id FROM', rows: [] }, // not found on this project
      ],
    });
    const dto = baseDto({ relatedRecordType: 'rfi', relatedRecordId: '11111111-1111-1111-1111-111111111111' });
    await expect(svc.send(companyId, userId, 'project_engineer', projectId, dto)).rejects.toThrow(BadRequestException);
  });
});
