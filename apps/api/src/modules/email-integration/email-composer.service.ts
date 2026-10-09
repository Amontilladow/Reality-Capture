import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { ATTACHMENT_MAX_SIZE, ATTACHMENT_ALLOWED_EXTENSIONS } from '../../common/constants/attachment-limits';
import { OutlookIntegrationService } from './outlook/outlook-integration.service';
import { GmailIntegrationService } from './gmail/gmail-integration.service';
import type { OutgoingMessage, SendResult } from './email-integration.types';
import type { SendEmailDto } from './dto/send-email.dto';
import type { EmailAttachmentUploadUrlDto } from './dto/email-attachment-upload-url.dto';
import type { CompanyRole } from '@engineeringos/types';

// A single, project-scoped reference-number lookup -- one entry per table
// the brief names as an email workflow target (Section 7: RFIs, issues,
// snagging, submittals). Adding a fifth related-record type later means
// adding one entry here, not a new branch of custom logic.
const REFERENCE_NUMBER_TABLES: { type: string; table: string; column: string }[] = [
  { type: 'rfi', table: 'rfis', column: 'rfi_number' },
  { type: 'issue', table: 'issues', column: 'issue_number' },
  { type: 'submittal', table: 'submittals', column: 'submittal_number' },
  { type: 'snag_item', table: 'snag_items', column: 'snag_number' },
];

// Every number format in this codebase (PRJ-GEN-RFI-STR-0001, PRJ-STR-0001,
// PRJ-SUB-0001, ...) is 2+ uppercase-alnum segments joined by hyphens -- a
// bare word like "Re:" or "Update" never matches, so this only ever
// surfaces real candidates, not every capitalized word in the subject line.
const REFERENCE_NUMBER_PATTERN = /\b[A-Z0-9]{2,}(?:-[A-Z0-9]{1,10}){2,}\b/g;

@Injectable()
export class EmailComposerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly outlook: OutlookIntegrationService,
    private readonly gmail: GmailIntegrationService,
  ) {}

  // Mirrors ChatService.canAccessChannel('project', ...) exactly -- same
  // super_admin bypass, same project_members lookup. A separate copy
  // because EmailComposerService has no reason to depend on the chat
  // module, but the rule itself (Section 10: only authorized project
  // members see/send project communications) must stay identical.
  private async isProjectMember(companyId: string, userId: string, companyRole: CompanyRole, projectId: string): Promise<boolean> {
    if (companyRole === 'super_admin') return true;
    const [membership] = await this.db.withTenant(companyId, sql => sql`
      SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}
    `);
    return !!membership;
  }

  // Step 1 of the presigned-PUT flow, same allow-list/size cap and shape as
  // RfisService.getAttachmentUploadUrl() -- the client PUTs the bytes
  // straight to storage with this URL, then hands the resulting storageKey
  // back as one of SendEmailDto.attachments on the actual send() call,
  // where resolveAttachments() re-validates the real stored object.
  async getAttachmentUploadUrl(companyId: string, projectId: string, userId: string, companyRole: CompanyRole, dto: EmailAttachmentUploadUrlDto) {
    if (!(await this.isProjectMember(companyId, userId, companyRole, projectId))) {
      throw new ForbiddenException('You are not a member of this project.');
    }

    const ext = dto.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!ATTACHMENT_ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`File type ".${ext}" is not supported. Allowed: ${[...ATTACHMENT_ALLOWED_EXTENSIONS].join(', ')}.`);
    }
    if (dto.sizeBytes > ATTACHMENT_MAX_SIZE) {
      throw new BadRequestException(`File too large (${(dto.sizeBytes / 1024 / 1024).toFixed(1)} MB). Max: ${ATTACHMENT_MAX_SIZE / 1024 / 1024} MB.`);
    }

    const key = this.storage.generateKey(companyId, projectId, 'email-attachments', dto.filename);
    const { uploadUrl } = await this.storage.getUploadUrl(key, 'application/octet-stream', dto.sizeBytes);
    return { uploadUrl, storageKey: key };
  }

  async send(companyId: string, userId: string, companyRole: CompanyRole, projectId: string, dto: SendEmailDto) {
    if (!(await this.isProjectMember(companyId, userId, companyRole, projectId))) {
      throw new ForbiddenException('You are not a member of this project.');
    }

    // Idempotent no-op on a retried request that already sent -- the whole
    // point of the UNIQUE constraint (Section 6: "prevent accidental
    // duplicate sends when users retry after a timeout"). A previously
    // *failed* attempt is not short-circuited: nothing was actually sent,
    // so retrying under the same key must be allowed to try again.
    const [existing] = await this.db.withTenant(companyId, sql => sql`
      SELECT * FROM email_messages WHERE initiating_user_id = ${userId} AND idempotency_key = ${dto.idempotencyKey}
    `);
    if (existing && existing.status === 'sent') return existing;

    const attachments = await this.resolveAttachments(dto.attachments ?? []);
    const related = await this.resolveRelatedRecord(companyId, projectId, dto);

    const providerService = dto.provider === 'microsoft' ? this.outlook : this.gmail;
    const message: OutgoingMessage = {
      to: dto.to,
      cc: dto.cc ?? [],
      bcc: dto.bcc ?? [],
      subject: dto.subject,
      bodyText: dto.bodyText,
      attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, contentBase64: a.contentBase64 })),
    };

    let result: (SendResult & { senderEmail: string }) | null = null;
    let failureReason: string | null = null;
    try {
      result = await providerService.sendMail(companyId, userId, message);
    } catch (err) {
      // Never the raw provider error body (migration 066's own comment) --
      // a Graph/Gmail error can echo back request content or internal
      // detail not meant for an audit trail any project member can read.
      failureReason = err instanceof Error ? err.message.slice(0, 500) : 'Unknown error sending email.';
    }

    const attachmentMetadata = attachments.map((a) => ({ filename: a.filename, sizeBytes: a.sizeBytes, contentType: a.contentType }));

    const [row] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO email_messages (
        company_id, project_id, related_record_type, related_record_id, initiating_user_id,
        provider, sender_email, recipients_to, recipients_cc, recipients_bcc, subject,
        provider_message_id, thread_id, status, failure_reason, attachment_metadata, idempotency_key
      ) VALUES (
        ${companyId}, ${projectId}, ${related?.type ?? null}, ${related?.id ?? null}, ${userId},
        ${dto.provider}, ${result?.senderEmail ?? 'unknown'}, ${JSON.stringify(dto.to)}, ${JSON.stringify(dto.cc ?? [])}, ${JSON.stringify(dto.bcc ?? [])}, ${dto.subject},
        ${result?.providerMessageId ?? null}, ${result?.threadId ?? null}, ${result ? 'sent' : 'failed'}, ${failureReason}, ${JSON.stringify(attachmentMetadata)}, ${dto.idempotencyKey}
      )
      ON CONFLICT (initiating_user_id, idempotency_key) DO UPDATE SET
        status = EXCLUDED.status,
        sender_email = EXCLUDED.sender_email,
        provider_message_id = EXCLUDED.provider_message_id,
        thread_id = EXCLUDED.thread_id,
        failure_reason = EXCLUDED.failure_reason
      RETURNING *
    `);

    if (!result) throw new BadRequestException({ message: 'Failed to send email.', reason: failureReason, record: row });
    return row;
  }

  // Fetches and re-validates each already-uploaded attachment against the
  // same size/extension allow-list RFI attachments use (ticket 2b's own
  // constants) -- the client-declared contentType/filename on the DTO is
  // never trusted for the size check, only the real object as stored.
  private async resolveAttachments(items: { storageKey: string; filename: string; contentType: string }[]) {
    return Promise.all(items.map(async (item) => {
      const ext = item.filename.split('.').pop()?.toLowerCase();
      if (!ext || !ATTACHMENT_ALLOWED_EXTENSIONS.has(ext)) {
        throw new BadRequestException(`Attachment type not allowed: ${item.filename}`);
      }

      const sizeBytes = await this.storage.getObjectSize(item.storageKey);
      if (sizeBytes === null) throw new BadRequestException(`Attachment not found in storage: ${item.filename}`);
      if (sizeBytes > ATTACHMENT_MAX_SIZE) throw new BadRequestException(`Attachment too large: ${item.filename}`);

      const bytes = await this.storage.download(item.storageKey);
      return { filename: item.filename, contentType: item.contentType, sizeBytes, contentBase64: bytes.toString('base64') };
    }));
  }

  // "Auto-match by reference number" (the brief's own chosen design): an
  // explicit relatedRecordType/Id always wins over guessing, and is
  // verified to actually belong to this project before being trusted --
  // a client-supplied ID is not proof by itself. Only when neither is
  // given does this scan the subject for a reference-number-shaped token
  // and look it up across every workflow table; more than one hit (or
  // zero) is left unmatched rather than guessed, per the brief's own
  // "do not silently associate the wrong record" caution.
  private async resolveRelatedRecord(companyId: string, projectId: string, dto: SendEmailDto): Promise<{ type: string; id: string } | null> {
    const relatedRecordId = dto.relatedRecordId;
    if (dto.relatedRecordType && relatedRecordId) {
      const entry = REFERENCE_NUMBER_TABLES.find((t) => t.type === dto.relatedRecordType);
      if (!entry) return null;
      const found = await this.db.withTenant(companyId, sql => sql`
        SELECT id FROM ${sql(entry.table)} WHERE id = ${relatedRecordId} AND project_id = ${projectId} AND company_id = ${companyId}
      `);
      if (found.length === 0) throw new BadRequestException('The selected related record was not found on this project.');
      return { type: entry.type, id: relatedRecordId };
    }

    const candidates = [...new Set(dto.subject.toUpperCase().match(REFERENCE_NUMBER_PATTERN) ?? [])];
    if (candidates.length === 0) return null;

    const matches: { type: string; id: string }[] = [];
    for (const entry of REFERENCE_NUMBER_TABLES) {
      const rows = await this.db.withTenant(companyId, sql => sql`
        SELECT id FROM ${sql(entry.table)}
        WHERE project_id = ${projectId} AND company_id = ${companyId} AND UPPER(${sql(entry.column)}) = ANY(${candidates})
      `);
      matches.push(...rows.map((r) => ({ type: entry.type, id: r.id as string })));
    }

    return matches.length === 1 ? matches[0] : null;
  }
}
