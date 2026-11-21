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

// The raw shape apps/ai-service's /drawings/extract-structured actually
// returns (snake_case: no camelCase conversion configured on that side).
// Kept private to this file; extractDrawingStructure() below maps it
// onto DrawingExtractionResult, this app's own normal convention.
interface TextRunWire {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  method: string; // 'native' | 'ocr'
}
interface RegionWire {
  left: number;
  top: number;
  width: number;
  height: number;
  runs: TextRunWire[];
}
interface DrawingExtractionWireResponse {
  page_count: number;
  page_width: number;
  page_height: number;
  page_rotation_degrees: number;
  regions: RegionWire[];
  whole_page_native_text: string;
  whole_page_ocr_text?: string | null;
  whole_page_ocr_confidence?: number | null;
}

export interface DrawingExtractionRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  // Text run (@engineeringos/types) -- same shape extraction/
  // text-run-structure.ts's buildPseudoTableFromTextRuns() consumes.
  runs: { text: string; left: number; top: number; width: number; height: number; conf: number; method: 'native' | 'ocr' }[];
}

export interface DrawingExtractionResult {
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  // The PDF's own declared page rotation (exact, never a guessed OSD
  // value) -- see apps/ai-service's drawing_vision.py module docstring
  // for why. Reported for a caller that wants to flag a rotated page for
  // review; nothing currently acts on it automatically.
  pageRotationDegrees: number;
  // Every candidate title-block-shaped grid region the AI service found,
  // ranked (closest to a page edge, then largest) but not filtered --
  // extract-drawing-fields.ts tries each in turn with its own
  // drawing-number-plausibility check until one succeeds. Empty when no
  // grid-shaped region was found at all.
  regions: DrawingExtractionRegion[];
  wholePageNativeText: string;
  // Computed by the AI service only when truly nothing else produced
  // any text at all; null when not attempted (the common case).
  wholePageOcrText: string | null;
  wholePageOcrConfidence: number | null;
}

/**
 * Talks to the Python AI service's ingestion endpoints so new captures and
 * issues become searchable (AI search, AI assistant) shortly after creation.
 *
 * Every call here is fire-and-forget: indexing failures must never block or
 * fail the primary request that created the resource. If the AI service is
 * down, the resource still exists correctly in Postgres; it's just not
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
    // Proves our identity to the AI service on every call; it has no auth
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
   * tool (modules/ai/ai-tools.service.ts): the Python service's own
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
   * real, already-computed risk data (never raw retrieval): this call is
   * awaited, not fire-and-forget, since its result is shown directly to the
   * user, but it throws on failure exactly like ask() does. Callers must
   * catch and degrade gracefully (never surface a 500 for an AI outage);
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

  /**
   * Cross-domain reporting briefing (Phase 4 extension of the risk
   * reasoning layer above): same contract exactly; the caller builds
   * `context` from already-computed, already-authorized Reports KPIs/Risk
   * summary, this is awaited and shown directly to the user, and callers
   * must catch and degrade gracefully. See ReportsService.generateAiBriefing().
   */
  async generateReportsBriefing(companyId: string, projectId: string, context: string): Promise<{ narrative: string }> {
    const resp = await firstValueFrom(
      this.http.post(`${this.baseUrl}/report/briefing`, { company_id: companyId, project_id: projectId, context }, { timeout: 30_000, headers: this.authHeaders }),
    );
    return resp.data;
  }

  /**
   * Drawing Identification Engine replacement (Site Drawing Hub): the
   * multi-stage page-vision pipeline (native-PDF-text extraction via
   * pypdfium2, OpenCV title-block grid detection, targeted OCR only on
   * the detected region) now lives entirely in apps/ai-service -- this
   * is the single call that replaces the old embedded-text-local-parse
   * + separate-OCR-fallback two-path split extract-drawing-fields.ts
   * used to do itself. pdfUrl must be a short-lived, already-authorized
   * URL (StorageService.getReadUrl()), never a raw storage key or
   * credential; the AI service fetches the bytes itself. Awaited and
   * throws on failure, like the risk-briefing calls above; the caller
   * (extract-drawing-fields.ts) must catch and degrade to a null result
   * (manual entry required) rather than let an AI-service outage fail
   * the whole import batch.
   *
   * The AI service has no camelCase conversion configured (FastAPI/
   * pydantic serialize using the declared Python field names as-is), so
   * this maps its snake_case response onto this app's normal camelCase
   * convention explicitly, same as every DB row mapper in this codebase
   * already does for its own external shape.
   */
  async extractDrawingStructure(companyId: string, projectId: string, pdfUrl: string, page = 1): Promise<DrawingExtractionResult> {
    const resp = await firstValueFrom(
      this.http.post<DrawingExtractionWireResponse>(`${this.baseUrl}/drawings/extract-structured`, {
        company_id: companyId, project_id: projectId, pdf_url: pdfUrl, page,
      }, { timeout: 30_000, headers: this.authHeaders }),
    );
    const data = resp.data;
    return {
      pageCount: data.page_count,
      pageWidth: data.page_width,
      pageHeight: data.page_height,
      pageRotationDegrees: data.page_rotation_degrees,
      regions: data.regions.map((region) => ({
        left: region.left, top: region.top, width: region.width, height: region.height,
        runs: region.runs.map((run) => ({
          text: run.text, left: run.left, top: run.top, width: run.width, height: run.height,
          conf: run.conf, method: run.method === 'native' ? 'native' : 'ocr',
        })),
      })),
      wholePageNativeText: data.whole_page_native_text,
      wholePageOcrText: data.whole_page_ocr_text ?? null,
      wholePageOcrConfidence: data.whole_page_ocr_confidence ?? null,
    };
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
    // Deliberately a warning, not an error; a down/slow AI service is an
    // operational concern, not a defect in the request that triggered it.
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`AI service call failed (${context}): ${message}`);
  }
}
