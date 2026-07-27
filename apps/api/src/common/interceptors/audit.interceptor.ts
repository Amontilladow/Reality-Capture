import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { createHash } from 'crypto';
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
  [/\/projects\/[^/]+\/documents$/, 'document.uploaded','document'],
  [/\/users\/[^/]+\/invite$/,  'user.invited',          'user'],
  [/\/projects\/[^/]+\/buildings\/[^/]+\/levels\/[^/]+\/locations$/, 'location.created', 'location'],
  [/\/projects\/[^/]+\/buildings\/[^/]+\/levels$/,        'level.created',    'level'],
  [/\/projects\/[^/]+\/buildings$/,                       'building.created', 'building'],
  [/\/projects\/[^/]+$/,       'project.updated',       'project'],
  [/\/projects$/,              'project.created',       'project'],
  [/\/bim\/models$/,           'bim.model_uploaded',    'bim_model'],
];

function deriveAction(method: string, url: string): { action: string; resourceType: string } {
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
            ipAddress: ip,
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

  private async writeAuditLog(entry: Record<string, unknown>): Promise<void> {
    await this.db.query`
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
    `;
  }

  private extractResourceId(body: unknown): string | null {
    if (body && typeof body === 'object' && 'id' in body) return String((body as {id: unknown}).id);
    return null;
  }

  private extractResourceLabel(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    return String(b['title'] ?? b['name'] ?? b['email'] ?? b['issueNumber'] ?? '').slice(0, 500) || null;
  }

  private extractProjectId(url: string): string | null {
    const match = url.match(/\/projects\/([a-f0-9-]{36})/);
    return match ? match[1] : null;
  }
}