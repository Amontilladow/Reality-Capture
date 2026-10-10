import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import type { AuthenticatedUser } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Map URL patterns to (action, resourceType) tuples
const ROUTE_MAP: [RegExp, string, string][] = [
  [/\/auth\/login$/,           'auth.login',            'session'],
  [/\/auth\/logout$/,          'auth.logout',           'session'],
  [/\/projects\/[^/]+\/captures$/,  'capture.created',  'capture'],
  [/\/captures\/[^/]+$/,       'capture.updated',       'capture'],
  [/\/projects\/[^/]+\/issues$/,    'issue.created',    'issue'],
  [/\/issues\/[^/]+$/,         'issue.updated',         'issue'],
  // Phase 7: RFI lifecycle was previously uncovered entirely -- every RFI
  // create/respond/close fell through to deriveAction()'s generic
  // last-segment fallback, giving unreadable labels (the same gap this
  // file's RBAC-phase comment already called out for a different set of
  // routes). More specific patterns (respond/close) must stay above the
  // general :id update pattern below them, since this is a first-match scan.
  [/\/rfis\/[^/]+\/respond$/,  'rfi.responded',         'rfi'],
  [/\/rfis\/[^/]+\/close$/,    'rfi.closed',            'rfi'],
  [/\/projects\/[^/]+\/rfis$/, 'rfi.created',           'rfi'],
  [/\/rfis\/[^/]+$/,           'rfi.updated',           'rfi'],
  // QAQC NCR/SOR -- same specific-before-general ordering as RFI above.
  // One shared route/table for both record types (record_type is a body
  // field, not visible in the URL), so the label is generic "qaqc_record",
  // not ncr/sor-specific -- resourceLabel (subject) still distinguishes rows.
  [/\/qaqc\/[^/]+\/close$/,    'qaqc_record.closed',    'qaqc_record'],
  [/\/projects\/[^/]+\/qaqc$/, 'qaqc_record.created',   'qaqc_record'],
  // Snag creation had the same gap -- only snag_item.verified (below) was
  // ever captured, never the initial create.
  [/\/projects\/[^/]+\/snag-items$/, 'snag_item.created', 'snag_item'],
  [/\/projects\/[^/]+\/documents$/, 'document.uploaded','document'],
  [/\/users\/[^/]+\/invite$/,  'user.invited',          'user'],
  [/\/projects\/[^/]+\/buildings\/[^/]+\/levels\/[^/]+\/locations$/, 'location.created', 'location'],
  [/\/projects\/[^/]+\/buildings\/[^/]+\/levels$/,        'level.created',    'level'],
  [/\/projects\/[^/]+\/buildings$/,                       'building.created', 'building'],
  [/\/projects\/[^/]+$/,       'project.updated',       'project'],
  [/\/projects$/,              'project.created',       'project'],
  [/\/bim\/models$/,           'bim.model_uploaded',    'bim_model'],
  // Workforce Intelligence -- admin/policy actions only. High-frequency
  // telemetry (activity ingestion, device heartbeat) is deliberately not
  // audited here to avoid drowning audit_log in routine traffic.
  [/\/workforce\/devices$/,               'workforce.device_enrolled',            'device'],
  [/\/workforce\/devices\/[^/]+$/,        'workforce.device_updated',             'device'],
  [/\/workforce\/applications$/,          'workforce.application_created',        'application_registry'],
  [/\/workforce\/applications\/[^/]+$/,   'workforce.application_updated',        'application_registry'],
  [/\/workforce\/privacy-settings$/,      'workforce.privacy_settings_updated',   'workforce_privacy_settings'],
  [/\/workforce\/reporting-lines$/,       'workforce.reporting_line_set',         'workforce_reporting_line'],
  // Matches only the exact /workforce/screenshots path (the "record" POST)
  // -- not /workforce/screenshots/upload-url (no state change yet) or the
  // GET :userId list (read-only).
  [/\/workforce\/screenshots$/,           'workforce.screenshot_captured',        'workforce_screenshot'],
  [/\/workforce\/scheduling\/shifts$/,    'workforce.shift_assigned',             'workforce_shift_assignment'],
  [/\/workforce\/scheduling\/absences\/[^/]+\/decide$/, 'workforce.absence_decided', 'workforce_absence'],
  // RBAC Phase 6 -- "who has access to what" is exactly the kind of mutation
  // this audit trail exists for, but every one of these fell through to the
  // generic URL-derived fallback below (deriveAction()'s last-segment
  // heuristic), giving unreadable labels like "verify.created" or
  // "members.created" with no indication these are access-control changes.
  // Each pair below is two separate regexes (collection POST vs item-level
  // DELETE), not one pattern relying on the method==='DELETE' auto-rewrite
  // below -- the two URL shapes differ by a trailing /:id segment, so they
  // never share a single regex anyway; writing the exact verb directly is
  // clearer than threading them through the created/updated->deleted rewrite.
  [/\/projects\/[^/]+\/members$/,                                  'project_member.added',           'project_member'],
  [/\/projects\/[^/]+\/members\/[^/]+$/,                           'project_member.removed',         'project_member'],
  [/\/projects\/[^/]+\/permission-grants$/,                        'project_permission.granted',     'project_permission_grant'],
  [/\/projects\/[^/]+\/permission-grants\/[^/]+\/[^/]+$/,          'project_permission.revoked',     'project_permission_grant'],
  [/\/projects\/[^/]+\/organizations\/[^/]+\/members$/,            'project_organization.member_added',   'project_organization_member'],
  [/\/projects\/[^/]+\/organizations\/members\/[^/]+$/,            'project_organization.member_removed', 'project_organization_member'],
  [/\/snag-items\/[^/]+\/verify$/,                                 'snag_item.verified',             'snag_item'],
];

interface AuditLogEntry {
  companyId: string;
  projectId: string | null;
  userId: string;
  userEmail: string;
  userName: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceLabel: string | null;
  changes: unknown;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  source: string;
}

export function deriveAction(method: string, url: string): { action: string; resourceType: string } {
  for (const [pattern, action, resourceType] of ROUTE_MAP) {
    if (pattern.test(url)) {
      // Override action verb for DELETE
      if (method === 'DELETE') return { action: action.replace(/\.(created|updated)/, '.deleted'), resourceType };
      return { action, resourceType };
    }
  }
  // Fallback for any route not explicitly mapped above. A trailing UUID/param
  // means this is a /resource/:id-style route — the resource name is the
  // segment BEFORE that id. Otherwise (a collection POST like /projects/:id/buildings)
  // the resource name is simply the last segment.
  const segments = url.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'unknown';
  const looksLikeId = /^[0-9a-f-]{8,}$/i.test(last);
  const resourceType = looksLikeId ? (segments[segments.length - 2] ?? 'unknown') : last;
  const actionVerb = method === 'POST' ? 'created' : method === 'DELETE' ? 'deleted' : 'updated';
  return { action: `${resourceType}.${actionVerb}`, resourceType };
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly db: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const { method, url, ip } = req;

    if (!MUTATING_METHODS.has(method)) return next.handle();

    const user = req.user;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseBody: unknown) => {
          if (!user?.companyId) return; // unauthenticated mutation — skip (auth failures logged separately)

          const { action, resourceType } = deriveAction(method, url);
          const resourceId = this.extractResourceId(responseBody);
          const requestId = req.headers['x-request-id'] as string | undefined;
          const source = (req.headers['x-source'] as string | undefined) ?? 'api';

          // Fire-and-forget — never block the response for audit logging
          this.writeAuditLog({
            companyId: user.companyId,
            projectId: this.extractProjectId(url),
            userId: user.id,
            userEmail: user.email,
            userName: `${user.firstName} ${user.lastName}`.trim(),
            action,
            resourceType,
            resourceId,
            resourceLabel: this.extractResourceLabel(responseBody),
            changes: null, // full diff requires before-state capture (Phase 2 enhancement)
            metadata: { durationMs: Date.now() - startedAt },
            ipAddress: ip ?? null,
            userAgent: req.headers['user-agent'] ?? null,
            requestId: requestId ?? null,
            source,
          }).catch(err => this.logger.error('Failed to write audit log', err));
        },
        error: () => {
          // Errors are handled by the GlobalExceptionFilter — not logged here to avoid duplication
        },
      }),
    );
  }

  // withTenant required -- audit_log carries the tenant_isolation RLS policy. A plain
  // this.db.query() never sets app.current_company_id, so under any DB role that isn't the
  // table owner/a superuser the implicit WITH CHECK rejects this insert outright -- and since
  // the caller only logs the failure (never surfaces it), the entire audit trail is silently
  // dark in production.
  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    await this.db.withTenant(entry.companyId, sql => sql`
      INSERT INTO audit_log (
        company_id, project_id, user_id, user_email, user_name,
        action, resource_type, resource_id, resource_label,
        changes, metadata, ip_address, user_agent, request_id, source
      ) VALUES (
        ${entry.companyId}, ${entry.projectId ?? null}, ${entry.userId},
        ${entry.userEmail}, ${entry.userName},
        ${entry.action}, ${entry.resourceType}, ${entry.resourceId ?? null},
        ${entry.resourceLabel ?? null},
        ${entry.changes ? JSON.stringify(entry.changes) : null},
        ${entry.metadata ? JSON.stringify(entry.metadata) : null},
        ${entry.ipAddress ?? null}, ${entry.userAgent ?? null},
        ${entry.requestId ?? null}, ${entry.source}
      )
    `);
  }

  private extractResourceId(body: unknown): string | null {
    if (body && typeof body === 'object' && 'id' in body) return String((body as {id: unknown}).id);
    return null;
  }

  private extractResourceLabel(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    return String(b['title'] ?? b['name'] ?? b['email'] ?? b['issueNumber'] ?? b['subject'] ?? '').slice(0, 500) || null;
  }

  private extractProjectId(url: string): string | null {
    const match = url.match(/\/projects\/([a-f0-9-]{36})/);
    return match ? match[1] : null;
  }
}