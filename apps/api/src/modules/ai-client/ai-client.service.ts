import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface IngestCapturePayload {
  id: string;
  companyId: string;
  projectId: string;
  title?: string | null;
  description?: string | null;
  captureType?: string;
  phase?: string | null;
  capturedAt?: string;
  locationName?: string | null;
}

export interface IngestIssuePayload {
  id: string;
  companyId: string;
  projectId: string;
  title: string;
  issueNumber?: string | null;
  description?: string | null;
  issueType?: string;
  priority?: string | null;
  status?: string;
  discipline?: string | null;
  locationName?: string | null;
}

/**
 * Talks to the Python AI service's ingestion endpoints so new captures and
 * issues become searchable (AI search, AI assistant) shortly after creation.
 *
 * Every call here is fire-and-forget: indexing failures must never block or
 * fail the primary request that created the resource. If the AI service is
 * down, the resource still exists correctly in Postgres — it's just not
 * searchable yet. This mirrors the AuditInterceptor's error-isolation pattern
 * used elsewhere in this codebase.
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>('app.aiServiceUrl') ?? 'http://localhost:8001';
  }

  ingestCapture(payload: IngestCapturePayload): void {
    this.post('/ingest/capture', {
      id: payload.id,
      company_id: payload.companyId,
      project_id: payload.projectId,
      title: payload.title ?? null,
      description: payload.description ?? null,
      capture_type: payload.captureType ?? null,
      phase: payload.phase ?? null,
      captured_at: payload.capturedAt ?? null,
      location_name: payload.locationName ?? null,
    });
  }

  ingestIssue(payload: IngestIssuePayload): void {
    this.post('/ingest/issue', {
      id: payload.id,
      company_id: payload.companyId,
      project_id: payload.projectId,
      title: payload.title,
      issue_number: payload.issueNumber ?? null,
      description: payload.description ?? null,
      issue_type: payload.issueType ?? null,
      priority: payload.priority ?? null,
      status: payload.status ?? null,
      discipline: payload.discipline ?? null,
      location_name: payload.locationName ?? null,
    });
  }

  async ask(companyId: string, projectId: string, question: string, conversationHistory?: { role: string; content: string }[]): Promise<{ answer: string; sources: unknown[] }> {
    const resp = await firstValueFrom(
      this.http.post(`${this.baseUrl}/assistant/`, {
        question,
        company_id: companyId,
        project_id: projectId,
        conversation_history: conversationHistory ?? null,
      }, { timeout: 30_000 }),
    );
    return resp.data;
  }

  deleteResource(collection: string, resourceId: string): void {
    firstValueFrom(
      this.http.delete(`${this.baseUrl}/ingest/resource`, {
        data: { collection, resource_id: resourceId },
        timeout: 5000,
      }),
    ).catch(err => this.logDown('delete', err));
  }

  private post(path: string, body: Record<string, unknown>): void {
    firstValueFrom(this.http.post(`${this.baseUrl}${path}`, body, { timeout: 5000 }))
      .catch(err => this.logDown(path, err));
  }

  private logDown(context: string, err: unknown): void {
    // Deliberately a warning, not an error — a down/slow AI service is an
    // operational concern, not a defect in the request that triggered it.
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`AI service call failed (${context}): ${message}`);
  }
}
