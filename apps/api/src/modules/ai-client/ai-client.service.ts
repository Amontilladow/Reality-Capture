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
  private readonly authHeaders: Record<string, string>;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>('app.aiServiceUrl') ?? 'http://localhost:8001';
    // Proves our identity to the AI service on every call -- it has no auth
    // of its own otherwise and trusts whatever company_id/project_id we send.
    this.authHeaders = { 'X-Internal-Service-Secret': this.config.get<string>('app.internalServiceSecret') ?? '' };
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

  /**
   * Narrow semantic-search call backing the AI Gateway's searchProjectDocuments
   * tool (modules/ai/ai-tools.service.ts) -- the Python service's own
   * monolithic /assistant/ RAG endpoint (full retrieval + prompt build + LLM
   * call in one request) is no longer used by anything in apps/api; the new
   * Gateway owns prompt building, tool orchestration and the provider call
   * itself, and only needs this service for its working Qdrant/embeddings
   * layer, not its old ask() entry point.
   */
  async search(companyId: string, projectId: string | undefined, query: string, collections?: string[], limit = 8): Promise<{
    query: string; total: number;
    results: { resource_type: string; resource_id: string; score: number; text_preview?: string | null }[];
  }> {
    const resp = await firstValueFrom(
      this.http.post(`${this.baseUrl}/search/`, {
        query,
        company_id: companyId,
        project_id: projectId ?? null,
        collections: collections ?? null,
        limit,
      }, { timeout: 15_000, headers: this.authHeaders }),
    );
    return resp.data;
  }

  /**
   * Risk reasoning layer (brief section 13): the caller builds `context` from
   * real, already-computed risk data (never raw retrieval) -- this call is
   * awaited, not fire-and-forget, since its result is shown directly to the
   * user, but it throws on failure exactly like ask() does. Callers must
   * catch and degrade gracefully (never surface a 500 for an AI outage) --
   * see RiskService.generateAiBriefing()/generateAiExplanation().
   */
  async generateRiskBriefing(companyId: string, projectId: string, context: string): Promise<{ narrative: string }> {
    const resp = await firstValueFrom(
      this.http.post(`${this.baseUrl}/risk/briefing`, { company_id: companyId, project_id: projectId, context }, { timeout: 30_000, headers: this.authHeaders }),
    );
    return resp.data;
  }

  async explainRisk(companyId: string, projectId: string, context: string): Promise<{ narrative: string }> {
    const resp = await firstValueFrom(
      this.http.post(`${this.baseUrl}/risk/explain`, { company_id: companyId, project_id: projectId, context }, { timeout: 30_000, headers: this.authHeaders }),
    );
    return resp.data;
  }

  deleteResource(collection: string, resourceId: string, companyId: string, projectId?: string): void {
    firstValueFrom(
      this.http.delete(`${this.baseUrl}/ingest/resource`, {
        data: { collection, resource_id: resourceId, company_id: companyId, project_id: projectId ?? null },
        timeout: 5000,
        headers: this.authHeaders,
      }),
    ).catch(err => this.logDown('delete', err));
  }

  private post(path: string, body: Record<string, unknown>): void {
    firstValueFrom(this.http.post(`${this.baseUrl}${path}`, body, { timeout: 5000, headers: this.authHeaders }))
      .catch(err => this.logDown(path, err));
  }

  private logDown(context: string, err: unknown): void {
    // Deliberately a warning, not an error — a down/slow AI service is an
    // operational concern, not a defect in the request that triggered it.
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`AI service call failed (${context}): ${message}`);
  }
}
