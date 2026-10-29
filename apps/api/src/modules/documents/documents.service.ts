import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import type { CreateDocumentDto } from './dto/create-document.dto';
import type { LinkDocumentDto } from './dto/link-document.dto';
import type { GenerateDocumentShareDto } from './dto/generate-document-share.dto';
import type { PaginationQuery } from '@engineeringos/types';

const DOCUMENT_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB -- matches getUploadUrl()'s existing figure
const DEFAULT_SHARE_EXPIRY_DAYS = 14;

// Mirrors captures.service.ts's ALLOWED_MIME pattern -- without this,
// contentType was an unconstrained client-supplied string signed straight
// onto the presigned PUT's Content-Type header, and later served back with
// that same attacker-chosen value (a stored content-type-confusion risk if
// ever rendered inline).
const DOCUMENT_ALLOWED_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
]);

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  // contentType is optional (defaults to 'application/pdf', the prior
  // hardcoded value) so existing callers that don't pass one keep working
  // unchanged -- but a real content type (e.g. from the browser's
  // file.type) is now threaded through and signed on the S3 PutObjectCommand
  // itself (see StorageService.getUploadUrl()), which a report attachment
  // photo/image upload needs to actually succeed with a correctly-signed
  // content type instead of a hardcoded PDF one.
  async getUploadUrl(companyId: string, projectId: string, filename: string, contentType?: string) {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const effectiveType = contentType || 'application/pdf';
    if (!DOCUMENT_ALLOWED_MIME.has(effectiveType)) {
      throw new BadRequestException(`File type ${effectiveType} is not supported. Allowed: PDF, JPEG, PNG, WebP.`);
    }
    const key = this.storage.generateKey(companyId, projectId, 'documents', filename);
    const url = await this.storage.getUploadUrl(key, effectiveType, DOCUMENT_MAX_SIZE_BYTES);
    return { ...url, storageKey: key };
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateDocumentDto) {
    await this.assertProjectBelongsToCompany(companyId, projectId);

    // A document is either an internal storage-backed upload (storageKey
    // set, source 'internal' -- the DB default when source is omitted) or a
    // metadata-only reference to an external system (Procore/Aconex/
    // SharePoint/BIM360/a manual link) with no object of ours to verify.
    // Real size enforcement only makes sense for the former -- an external
    // document legitimately has no storageKey at all.
    const isInternalUpload = (dto.source ?? 'internal') === 'internal' && Boolean(dto.storageKey);
    if (isInternalUpload) {
      const actualSizeBytes = await this.storage.getObjectSize(dto.storageKey!);
      if (actualSizeBytes === null) {
        throw new BadRequestException('Uploaded file not found in storage. Complete the upload before registering the document.');
      }
      if (actualSizeBytes > DOCUMENT_MAX_SIZE_BYTES) {
        await this.storage.deleteIfExists(dto.storageKey!);
        throw new BadRequestException(
          `Uploaded file (${(actualSizeBytes / 1024 / 1024).toFixed(1)} MB) exceeds the ${DOCUMENT_MAX_SIZE_BYTES / 1024 / 1024} MB ` +
          'limit for a document. The upload has been rejected and removed.',
        );
      }
    }

    // withTenant required -- documents carries the tenant_isolation RLS policy.
    const [doc] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO documents (
        company_id, project_id, doc_type, title, document_number, revision,
        status, discipline, source, external_id, external_url, storage_key,
        document_date, received_date, due_date, uploaded_by
      ) VALUES (
        ${companyId}, ${projectId}, ${dto.docType}, ${dto.title},
        ${dto.documentNumber ?? null}, ${dto.revision ?? null},
        ${dto.status ?? null}, ${dto.discipline ?? null},
        ${dto.source ?? 'internal'}, ${dto.externalId ?? null},
        ${dto.externalUrl ?? null}, ${dto.storageKey ?? null},
        ${dto.documentDate ?? null}, ${dto.receivedDate ?? null},
        ${dto.dueDate ?? null}, ${userId}
      )
      RETURNING *`);
    return doc;
  }

  async findAll(companyId: string, projectId: string, query: PaginationQuery & { docType?: string; discipline?: string }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT d.*, u.first_name || ' ' || u.last_name AS uploaded_by_name,
             COUNT(*) OVER() AS full_count
      FROM documents d
      JOIN users u ON u.id = d.uploaded_by
      WHERE d.project_id = ${projectId} AND d.company_id = ${companyId}
        AND (${query.docType ?? null}::text IS NULL OR d.doc_type = ${query.docType ?? null})
        AND (${query.discipline ?? null}::text IS NULL OR d.discipline = ${query.discipline ?? null})
        AND (${query.search ?? null}::text IS NULL OR d.search_vector @@ plainto_tsquery('english', ${query.search ?? null}))
      ORDER BY d.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async findOne(companyId: string, projectId: string, documentId: string) {
    const [doc] = await this.db.withTenant(companyId, sql => sql`
      SELECT d.*, u.first_name || ' ' || u.last_name AS uploaded_by_name,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', dl.id, 'captureId', dl.capture_id, 'elementId', dl.element_id,
          'locationId', dl.location_id, 'issueId', dl.issue_id, 'context', dl.link_context
        )) FILTER (WHERE dl.id IS NOT NULL), '[]'::json) AS links
      FROM documents d
      JOIN users u ON u.id = d.uploaded_by
      LEFT JOIN document_links dl ON dl.document_id = d.id
      WHERE d.id = ${documentId} AND d.project_id = ${projectId} AND d.company_id = ${companyId}
      GROUP BY d.id, u.first_name, u.last_name
    `);
    if (!doc) throw new NotFoundException('Document not found.');

    // Resolve presigned URL if internal
    if (doc.storageKey && doc.source === 'internal') {
      const url = await this.storage.getReadUrl(doc.storageKey as string);
      return { ...doc, downloadUrl: url };
    }
    return doc;
  }

  async link(companyId: string, documentId: string, userId: string, dto: LinkDocumentDto) {
    // Exactly one target must be set
    const targets = [dto.captureId, dto.elementId, dto.locationId, dto.issueId].filter(Boolean);
    if (targets.length !== 1) throw new BadRequestException('Exactly one link target must be provided (captureId, elementId, locationId, or issueId).');

    // withTenant required -- document_links carries the tenant_isolation RLS policy.
    const [link] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO document_links (
        company_id, document_id,
        capture_id, element_id, location_id, issue_id,
        link_context, linked_by
      ) VALUES (
        ${companyId}, ${documentId},
        ${dto.captureId ?? null}, ${dto.elementId ?? null},
        ${dto.locationId ?? null}, ${dto.issueId ?? null},
        ${dto.linkContext ?? null}, ${userId}
      )
      RETURNING *
    `);
    return link;
  }

  async getForIssue(companyId: string, issueId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT d.*, dl.link_context
      FROM document_links dl
      JOIN documents d ON d.id = dl.document_id
      WHERE dl.issue_id = ${issueId} AND dl.company_id = ${companyId}
      ORDER BY d.created_at DESC
    `);
  }

  // ── Share links (internal, authenticated side) ──────────────────────────
  // Mirrors progress-reports.service.ts's createShare()/listShares()/
  // revokeShare() and rfi-external-access.service.ts's generate()/list()/
  // revoke() pattern exactly: a random 128-hex-char token (the secret
  // itself, not hashed -- same category as a password-reset token), never
  // re-selected once issued. Lets a project team hand a document to someone
  // outside the company without a Dropbox/WeTransfer-style third party.

  async createShare(companyId: string, projectId: string, documentId: string, userId: string, dto: GenerateDocumentShareDto) {
    const [doc] = await this.db.withTenant(companyId, sql => sql`
      SELECT id, source, storage_key FROM documents
      WHERE id = ${documentId} AND project_id = ${projectId} AND company_id = ${companyId}
    `);
    if (!doc) throw new NotFoundException('Document not found.');
    // Only an internally-stored upload has a file of ours to hand out --
    // an external reference (Procore/Aconex/SharePoint/BIM360/a manual
    // link) has no object here to share; the externalUrl itself is already
    // whatever that other system exposes.
    if (doc.source !== 'internal' || !doc.storageKey) {
      throw new BadRequestException('Only an internally-stored document can be shared externally.');
    }

    const token = randomBytes(64).toString('hex'); // 128 hex chars -- exact fit for the token VARCHAR(128) column
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? DEFAULT_SHARE_EXPIRY_DAYS) * 24 * 60 * 60 * 1000);

    const [share] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO document_external_shares (
        company_id, project_id, document_id, recipient_email, recipient_name, token, expires_at, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${documentId}, ${dto.recipientEmail ?? null}, ${dto.recipientName ?? null},
        ${token}, ${expiresAt.toISOString()}, ${userId}
      )
      RETURNING *
    `);

    const frontendUrl = this.config.get<string>('app.frontendUrl');
    return { ...share, shareUrl: `${frontendUrl}/documents/external/${token}` };
  }

  // Never selects `token` -- same "don't re-display a bearer credential"
  // practice as rfi-external-access.service.ts's list().
  async listShares(companyId: string, projectId: string, documentId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT id, recipient_email, recipient_name, expires_at, revoked_at, used_at, created_by, created_at
      FROM document_external_shares
      WHERE document_id = ${documentId} AND project_id = ${projectId} AND company_id = ${companyId}
      ORDER BY created_at DESC
    `);
  }

  async revokeShare(companyId: string, projectId: string, documentId: string, shareId: string, userId: string) {
    const [revoked] = await this.db.withTenant(companyId, sql => sql`
      UPDATE document_external_shares
      SET revoked_at = NOW(), revoked_by = ${userId}
      WHERE id = ${shareId} AND document_id = ${documentId} AND project_id = ${projectId} AND company_id = ${companyId}
        AND revoked_at IS NULL
      RETURNING id
    `);
    if (!revoked) throw new NotFoundException({ code: 'SHARE_NOT_FOUND', message: 'No active share link found with that id.' });
    return { message: 'Share link revoked.' };
  }

  // ── Public, unauthenticated side ───────────────────────────────────────────
  // Deliberately global (withSystemBypass, no withTenant) -- the token
  // itself is the only credential; the caller has no session, no company_id.
  // Same bootstrap category as rfi-external-access.service.ts's and
  // progress-reports.service.ts's identical validateToken()/
  // validateShareToken(). Not single-use -- used_at is "last successful
  // view," matching that same precedent.
  private async validateShareToken(token: string): Promise<Record<string, unknown>> {
    const [share] = await this.db.withSystemBypass(sql => sql`
      SELECT * FROM document_external_shares WHERE token = ${token} AND expires_at > NOW() AND revoked_at IS NULL
    `);

    if (!share) {
      const [existing] = await this.db.withSystemBypass(sql => sql`SELECT expires_at, revoked_at FROM document_external_shares WHERE token = ${token}`);
      if (existing?.revokedAt) {
        throw new ForbiddenException({ code: 'LINK_REVOKED', message: 'This link has been revoked. Ask the project team to send a new one.' });
      }
      if (existing && new Date(existing.expiresAt as string) <= new Date()) {
        throw new ForbiddenException({ code: 'LINK_EXPIRED', message: 'This link has expired. Ask the project team to send a new one.' });
      }
      throw new NotFoundException({ code: 'LINK_INVALID', message: 'This link is invalid.' });
    }

    await this.db.withTenant(share.companyId as string, sql => sql`
      UPDATE document_external_shares SET used_at = NOW() WHERE id = ${share.id} AND company_id = ${share.companyId}
    `);

    return share;
  }

  // The deliberately narrow read model -- never findOne()'s full shape,
  // never the links/full document row, just enough to display and download
  // this one file.
  async getByToken(token: string): Promise<{ title: string; docType: string; documentNumber?: string; revision?: string; downloadUrl: string }> {
    const share = await this.validateShareToken(token);
    const companyId = share.companyId as string;
    const documentId = share.documentId as string;

    return this.db.withTenant(companyId, async (sql) => {
      const [doc] = await sql`
        SELECT title, doc_type, document_number, revision, storage_key
        FROM documents
        WHERE id = ${documentId} AND company_id = ${companyId}
      `;
      if (!doc) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found.' });

      const downloadUrl = await this.storage.getReadUrl(doc.storageKey as string);
      return {
        title: doc.title as string,
        docType: doc.docType as string,
        documentNumber: doc.documentNumber as string | undefined,
        revision: doc.revision as string | undefined,
        downloadUrl,
      };
    });
  }

  // Same rationale as captures.service.ts's assertProjectBelongsToCompany --
  // this controller has no @RequireProjectPermission gate either, and
  // getUploadUrl/create both take a client-supplied projectId.
  private async assertProjectBelongsToCompany(companyId: string, projectId: string): Promise<void> {
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    if (!project) throw new NotFoundException(`Project ${projectId} not found.`);
  }
}