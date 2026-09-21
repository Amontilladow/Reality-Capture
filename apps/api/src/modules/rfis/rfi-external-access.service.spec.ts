import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RfiExternalAccessService } from './rfi-external-access.service';
import type { DatabaseService } from '../../database/database.service';
import type { ConfigService } from '@nestjs/config';
import type { StorageService } from '../storage/storage.service';
import type { RfisService } from './rfis.service';

// Mirrors rfis.service.spec.ts's own makeQuery/withTenant convention, but
// this service uses BOTH this.db.query (validateToken -- no tenant context
// yet, same bootstrap category as auth.service.ts) and this.db.withTenant
// (everything after company_id is known), so each gets its own responder.
function makeQueryMock(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const fn = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve(responder(text, values) ?? []);
  });
  return { fn, calls };
}

function makeService(
  queryResponder: (text: string, values: unknown[]) => unknown[] | undefined,
  tenantResponder: (text: string, values: unknown[]) => unknown[] | undefined,
) {
  const { fn: query, calls: queryCalls } = makeQueryMock(queryResponder);
  const { fn: tenantSql, calls: tenantCalls } = makeQueryMock(tenantResponder);
  const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(tenantSql));
  const db = { query, withTenant };
  const config = { get: jest.fn(() => 'https://app.example.com') };
  const storage = { resolveUrls: jest.fn().mockResolvedValue(new Map()) };
  const rfis = {
    findOne: jest.fn().mockResolvedValue({ id: 'rfi-1' }),
    respond: jest.fn().mockResolvedValue({ id: 'rfi-1', status: 'responded' }),
    decideReview: jest.fn().mockResolvedValue({ id: 'rfi-1', status: 'closed' }),
    addComment: jest.fn().mockResolvedValue({ id: 'comment-1' }),
  };
  const svc = new RfiExternalAccessService(
    db as unknown as DatabaseService,
    config as unknown as ConfigService,
    storage as unknown as StorageService,
    rfis as unknown as RfisService,
  );
  return { svc, queryCalls, tenantCalls, rfis, storage };
}

const companyId = 'company-1';
const projectId = 'project-1';
const rfiId = 'rfi-1';
const token = 'a'.repeat(128);

const activeRespondAccess = {
  id: 'access-1', companyId, projectId, rfiId,
  organizationSlot: 'ldc', action: 'respond',
  recipientEmail: 'consultant@example.com', recipientName: 'Jane Doe',
};

describe('RfiExternalAccessService.generate', () => {
  it('creates a token row and returns the constructed external URL', async () => {
    // The service generates the token itself (randomBytes) and never re-reads
    // it back from the INSERT's RETURNING row for the URL, so the mock's
    // RETURNING payload deliberately omits `token` -- asserting otherwise
    // would just be asserting the mock's own echo, not the service's logic.
    const { svc, tenantCalls } = makeService(
      () => undefined,
      (text) => (text.includes('INSERT INTO rfi_external_access') ? [{ id: 'access-1' }] : undefined),
    );

    const result = await svc.generate(companyId, projectId, rfiId, 'user-1', {
      organizationSlot: 'ldc', action: 'respond', recipientEmail: 'consultant@example.com',
    });

    const insertCall = tenantCalls.find((c) => c.text.includes('INSERT INTO rfi_external_access'));
    expect(insertCall).toBeDefined();
    const insertedToken = insertCall!.values.find((v) => typeof v === 'string' && v.length === 128) as string;
    expect(insertedToken).toBeDefined();
    expect(result.externalUrl).toBe(`https://app.example.com/rfi/external/${insertedToken}`);
  });
});

describe('RfiExternalAccessService.revoke', () => {
  it('throws NotFoundException when no active link matches', async () => {
    const { svc } = makeService(() => undefined, () => []);
    await expect(svc.revoke(companyId, projectId, rfiId, 'access-1', 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('succeeds when an active link is revoked', async () => {
    const { svc } = makeService(() => undefined, () => [{ id: 'access-1' }]);
    await expect(svc.revoke(companyId, projectId, rfiId, 'access-1', 'user-1')).resolves.toEqual({ message: 'External access link revoked.' });
  });
});

describe('RfiExternalAccessService.getByToken', () => {
  it('throws NotFoundException for a token that never existed', async () => {
    const { svc } = makeService(() => [], () => undefined);
    await expect(svc.getByToken('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException with a distinct message for a revoked token', async () => {
    const { svc } = makeService(
      (text) => (text.includes('expires_at, revoked_at') ? [{ revokedAt: '2026-01-01T00:00:00.000Z' }] : []),
      () => undefined,
    );
    await expect(svc.getByToken(token)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException with a distinct message for an expired token', async () => {
    const { svc } = makeService(
      (text) => (text.includes('expires_at, revoked_at') ? [{ revokedAt: null, expiresAt: '2020-01-01T00:00:00.000Z' }] : []),
      () => undefined,
    );
    await expect(svc.getByToken(token)).rejects.toThrow(ForbiddenException);
  });

  it('stamps used_at and returns the narrow read model for a valid token', async () => {
    const { svc, tenantCalls } = makeService(
      (text) => (text.includes('FROM rfi_external_access') ? [activeRespondAccess] : undefined),
      (text) => {
        if (text.includes('UPDATE rfi_external_access SET used_at')) return [];
        if (text.includes('FROM rfis WHERE id')) {
          return [{ rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', question: 'Q?', status: 'responded' }];
        }
        if (text.includes('FROM rfi_attachments')) return [];
        if (text.includes('FROM rfi_comments')) return [];
        return undefined;
      },
    );

    const detail = await svc.getByToken(token);

    expect(detail.subject).toBe('Subj');
    expect(detail.action).toBe('respond');
    expect(detail.organizationSlot).toBe('ldc');
    const touchCall = tenantCalls.find((c) => c.text.includes('UPDATE rfi_external_access SET used_at'));
    expect(touchCall).toBeDefined();
  });
});

describe('RfiExternalAccessService.respondExternal', () => {
  it("throws ForbiddenException when the link's action is not 'respond'", async () => {
    const { svc } = makeService(
      (text) => (text.includes('FROM rfi_external_access') ? [{ ...activeRespondAccess, action: 'review' }] : undefined),
      () => [],
    );
    await expect(svc.respondExternal(token, { answer: 'Use 450mm' })).rejects.toThrow(ForbiddenException);
  });

  it("calls RfisService.respond() with the reserved system user and the external attribution", async () => {
    const { svc, rfis, tenantCalls } = makeService(
      (text) => (text.includes('FROM rfi_external_access') ? [activeRespondAccess] : undefined),
      (text) => {
        if (text.includes('UPDATE rfi_external_access SET used_at')) return [];
        if (text.includes('SELECT id FROM users')) return [{ id: 'system-user-1' }];
        return undefined;
      },
    );

    await svc.respondExternal(token, { answer: 'Use 450mm depth' });

    expect(rfis.respond).toHaveBeenCalledWith(
      companyId, projectId, rfiId, 'system-user-1', { answer: 'Use 450mm depth' },
      { recipientEmail: 'consultant@example.com', organizationSlot: 'ldc' },
    );
    // getOrCreateSystemUser found an existing row -- no INSERT attempted.
    expect(tenantCalls.some((c) => c.text.includes('INSERT INTO users'))).toBe(false);
  });

  it('creates the reserved system user when none exists yet for this company', async () => {
    const { svc, tenantCalls } = makeService(
      (text) => (text.includes('FROM rfi_external_access') ? [activeRespondAccess] : undefined),
      (text) => {
        if (text.includes('UPDATE rfi_external_access SET used_at')) return [];
        if (text.includes('SELECT id FROM users')) return []; // no existing row
        if (text.includes('INSERT INTO users')) return [{ id: 'system-user-new' }];
        return undefined;
      },
    );

    await svc.respondExternal(token, { answer: 'Use 450mm depth' });

    const insertUserCall = tenantCalls.find((c) => c.text.includes('INSERT INTO users'));
    expect(insertUserCall).toBeDefined();
    expect(insertUserCall!.text).toContain('is_system_account');
  });
});

describe('RfiExternalAccessService.reviewExternal', () => {
  it("throws ForbiddenException when the link's action is not 'review'", async () => {
    const { svc } = makeService(
      (text) => (text.includes('FROM rfi_external_access') ? [activeRespondAccess] : undefined), // action: 'respond'
      () => [],
    );
    await expect(svc.reviewExternal(token, { decision: 'approved' })).rejects.toThrow(ForbiddenException);
  });

  it("calls RfisService.decideReview() when the link's action is 'review'", async () => {
    const reviewAccess = { ...activeRespondAccess, action: 'review', organizationSlot: 'client' };
    const { svc, rfis } = makeService(
      (text) => (text.includes('FROM rfi_external_access') ? [reviewAccess] : undefined),
      (text) => {
        if (text.includes('UPDATE rfi_external_access SET used_at')) return [];
        if (text.includes('SELECT id FROM users')) return [{ id: 'system-user-1' }];
        return undefined;
      },
    );

    await svc.reviewExternal(token, { decision: 'approved' });

    expect(rfis.decideReview).toHaveBeenCalledWith(
      companyId, projectId, rfiId, 'system-user-1', { decision: 'approved' },
      { recipientEmail: 'consultant@example.com', organizationSlot: 'client' },
    );
  });
});

describe('RfiExternalAccessService.commentExternal', () => {
  it('is valid for any action value and forces organizationSlot from the token row', async () => {
    const { svc, rfis } = makeService(
      (text) => (text.includes('FROM rfi_external_access') ? [{ ...activeRespondAccess, action: 'comment_only' }] : undefined),
      (text) => {
        if (text.includes('UPDATE rfi_external_access SET used_at')) return [];
        if (text.includes('SELECT id FROM users')) return [{ id: 'system-user-1' }];
        return undefined;
      },
    );

    await svc.commentExternal(token, { body: 'Following up on this.' });

    expect(rfis.addComment).toHaveBeenCalledWith(
      companyId, projectId, rfiId, 'system-user-1',
      { body: 'Following up on this.', organizationSlot: 'ldc' },
      { recipientEmail: 'consultant@example.com', organizationSlot: 'ldc' },
    );
  });
});
