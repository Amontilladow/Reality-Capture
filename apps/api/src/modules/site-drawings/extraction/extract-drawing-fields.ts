import { Logger } from '@nestjs/common';
import type { ExtractedDrawingFields } from '@engineeringos/types';
import { StorageService } from '../../storage/storage.service';
import { AiClientService } from '../../ai-client/ai-client.service';
import { extractTitleBlockFields, extractTitleBlockFieldsFromCells } from './title-block-extractor';
import { buildPseudoTableFromTextRuns, type TextRun } from './text-run-structure';
import { applyFieldVerification, extractSupplementaryRevisionFromHistoryTable, fillMissingFieldsFromSupplementarySources } from './verification';

const logger = new Logger('extractDrawingFields');

// Site Drawing Hub, extraction accuracy Phase 0 (kept through the
// Drawing Identification Engine replacement): one structured log line
// per file is enough to answer, from real data rather than a guess, how
// often each path actually runs and how confident its results are.
function logExtractionOutcome(label: string, path: 'title-block-region' | 'whole-page' | 'none', fields: ExtractedDrawingFields | null): void {
  logger.log(
    `Extraction for "${label}": path=${path}, confidence=${fields?.confidence ?? 'n/a'}, `
    + `hasDrawingNumber=${Boolean(fields?.drawingNumber)}, hasRevision=${Boolean(fields?.revisionNumber)}, hasTitle=${Boolean(fields?.drawingTitle)}`,
  );
}

export interface DrawingFieldsExtractionResult {
  fields: ExtractedDrawingFields | null;
  // Null only when the AI service's own request failed outright (no
  // page count could be reported at all) -- effectively "unknown",
  // never read as "single page" by a caller that cares about this (Site
  // Drawing Hub integrity hardening, Phase 6): a PDF with more than one
  // page may hold several independently-numbered sheets, which this
  // pipeline only ever reads page 1 of (see the single aiClient call
  // below). Callers that skip this field entirely and just read .fields
  // get the exact same behavior as before this existed.
  pageCount: number | null;
}

function regionSource(runs: TextRun[]): 'embedded_text' | 'ocr' {
  // A region's runs are either ALL native or ALL targeted-OCR, never
  // mixed (apps/ai-service's drawing_vision.py tries native text in a
  // region first and only falls back to OCR when that region had none
  // at all) -- checking for any OCR run is enough, but done rather than
  // assuming the first run's method always represents the whole region.
  return runs.some((run) => run.method === 'ocr') ? 'ocr' : 'embedded_text';
}

// Drawing Identification Engine replacement: a single call to
// apps/ai-service's unified pipeline (native PDF text via pypdfium2,
// OpenCV title-block grid detection, targeted OCR only where native text
// is insufficient) replaces this function's previous two-path split
// (a local embedded-text parse, then a separate OCR-fallback call).
//
// Every candidate title-block-shaped region the AI service found is
// tried, reconstructing each one's row/column structure (text-run-
// structure.ts) and running it through the SAME title-block field-
// matching engine (title-block-extractor.ts) the system has always
// used -- unchanged by this replacement, since cell-scoped matching is
// still what makes cross-field contamination structurally impossible,
// regardless of whether a region's runs came from native text or OCR.
//
// Real production failure, confirmed by hand: a region that ISN'T the
// title block at all -- a door-hardware/ironmongery schedule, in one
// real case -- can still produce a non-null candidate once OCR'd (a
// stray token in a huge schedule table happening to match the bare,
// unlabeled drawing-number shape, e.g. "HS-05" inside "HS-05(EML)"),
// with near-zero overall confidence (no plausible title or revision
// found alongside it). Stopping at the FIRST non-null candidate, as
// this used to, let that near-worthless match shadow a much better one
// found in a LATER region (including the native-text-anchor fallback
// below, which found the real "Drawing No:"/"Drawing Title"/"Revision"
// trio with full confidence). Every region is tried now, and the
// HIGHEST-CONFIDENCE candidate wins -- ties keep whichever came first,
// preserving the AI service's own edge-distance-based ranking for the
// common case where confidence alone doesn't distinguish them.
//
// Only when NO region yields a plausible drawing number at all does
// this fall back to whole-page matching (native text first, the AI
// service's own whole-page OCR text only if it computed one) -- the
// same "whole page is the last resort, never the primary strategy"
// structure this pipeline has always had.
//
// Shared by SiteDrawingImportProcessor (a bulk ZIP/PDF import) and
// SiteDrawingsService.extractFields() (a single manual upload via
// "Register a drawing") -- same pipeline either way, so a drawing read
// the same way regardless of which path it came in through. A failure
// anywhere here degrades to a null result (manual entry required),
// never thrown: an extraction failure must not block a drawing from
// being registered.
export async function extractDrawingFields(
  storage: StorageService,
  aiClient: AiClientService,
  companyId: string,
  projectId: string,
  storageKey: string,
  buffer: Buffer,
  label: string,
): Promise<DrawingFieldsExtractionResult> {
  let fields: ExtractedDrawingFields | null = null;
  let pageCount: number | null = null;
  try {
    const readUrl = await storage.getReadUrl(storageKey, 300);
    const result = await aiClient.extractDrawingStructure(companyId, projectId, readUrl, 1);
    pageCount = result.pageCount;

    let titleBlockFields: ExtractedDrawingFields | null = null;
    let titleBlockRegionIndex = -1;
    for (let i = 0; i < result.regions.length; i++) {
      const region = result.regions[i];
      if (region.runs.length === 0) continue;
      const table = buildPseudoTableFromTextRuns(region.runs);
      const candidate = extractTitleBlockFieldsFromCells(table, regionSource(region.runs));
      if (candidate && (!titleBlockFields || candidate.confidence > titleBlockFields.confidence)) {
        titleBlockFields = candidate;
        titleBlockRegionIndex = i;
      }
    }

    if (titleBlockFields) {
      fields = titleBlockFields;
      // A still-missing revision number can be filled from ANOTHER
      // region that looks like a genuine revision-history table (never
      // overriding the title block's own value -- see
      // extractSupplementaryRevisionFromHistoryTable()'s and
      // fillMissingFieldsFromSupplementarySources()'s own comments on
      // why this precedence is structural, not a confidence comparison).
      if (!fields.revisionNumber) {
        for (let i = 0; i < result.regions.length; i++) {
          if (i === titleBlockRegionIndex) continue;
          const table = buildPseudoTableFromTextRuns(result.regions[i].runs);
          const hint = extractSupplementaryRevisionFromHistoryTable(table);
          if (hint) {
            fields = fillMissingFieldsFromSupplementarySources(fields, { revisionNumber: hint });
            break;
          }
        }
      }
      fields = applyFieldVerification(fields);
      logExtractionOutcome(label, 'title-block-region', fields);
    } else {
      const wholePage = extractTitleBlockFields(result.wholePageNativeText, 'embedded_text')
        ?? (result.wholePageOcrText ? extractTitleBlockFields(result.wholePageOcrText, 'ocr') : null);
      fields = wholePage ? applyFieldVerification(wholePage) : null;
      logExtractionOutcome(label, fields ? 'whole-page' : 'none', fields);
    }
  } catch (err) {
    logger.warn(`Drawing structure extraction failed for "${label}": ${err instanceof Error ? err.message : String(err)}`);
  }

  return { fields, pageCount };
}
