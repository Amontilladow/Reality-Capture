import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import type { CreateDocumentDto } from './dto/create-document.dto';
import type { LinkDocumentDto } from './dto/link-document.dto';
import type { PaginationQuery } from '@engineeringos/types';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  async getUploadUrl(companyId: string, projectId: string, filename: string) {
    const key = this.storage.generateKey(companyId, projectId, 'documents', filename);
    const url = await this.storage.getUploadUrl(key, 'application/pdf', 50 * 1024 * 1024);
    return { ...url, storageKey: key };
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateDocumentDto) {
    const [doc] = await this.db.query`
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
      RETURNING *`;
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

    const [link] = await this.db.query`
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
    `;
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
}