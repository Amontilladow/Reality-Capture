import { GIS_PREP_MAX_UPLOAD_MB } from '@engineeringos/types';

// What a chosen drawing file really is, judged by its first bytes rather than its name: a DWG starts with a version
// code such as "AC1032", a text DXF with a "0 / SECTION" pair, a binary DXF with "AutoCAD Binary DXF".
export type DrawingFormat = 'DWG' | 'DXF' | 'UNKNOWN';

// The DXF limit shown here MUST be the same number the API actually
// enforces (gis-prep.service.ts's GIS_PREP_MAX_UPLOAD_BYTES) -- it used to
// be a separate, hand-maintained "18 MB" guess that had drifted from what
// was really enforced server-side (a real bug this now closes: a note
// mentioning the wrong number is worse than no note at all). Re-exported
// here under the old name so this file's own call sites don't all need
// renaming, but it's GIS_PREP_MAX_UPLOAD_MB, not a second constant.
export const CLOUD_DXF_LIMIT_MB = GIS_PREP_MAX_UPLOAD_MB;
// DWG is a SEPARATE, narrower check: a DWG is converted to DXF server-side
// first, and that CONVERTED file is what apps/ai-service's Dockerfile-baked
// M4ADM_MAX_DXF_MB (18 MB, unrelated to GIS_PREP_MAX_UPLOAD_MB above -- see
// that Dockerfile's own comment) is checked against, not the raw DWG
// upload. A DWG becomes a DXF about 5 to 6 times larger (measured on the
// M19B drawings), so a DWG over about 3 MB predictably fails THAT check --
// this is a prediction shown early, not the enforcement itself.
export const CLOUD_DWG_LIMIT_MB = 3;

export function formatFromHead(head: string): DrawingFormat {
  if (/^AC\d/.test(head)) return 'DWG';
  if (head.startsWith('AutoCAD Binary DXF')) return 'DXF';
  if (/^\s*0\s*\r?\n\s*SECTION\b/.test(head) || /^\s*999\s*\r?\n/.test(head)) return 'DXF';
  return 'UNKNOWN';
}

export async function detectDrawingFormat(file: Blob): Promise<DrawingFormat> {
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file.slice(0, 64));
  });
  return formatFromHead(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
}

export interface DrawingNote { tone: 'info' | 'warn'; text: string }

/** One line to show next to the file picker. `name` is the file name, `sizeBytes` its size. */
export function drawingNote(name: string, sizeBytes: number, format: DrawingFormat): DrawingNote {
  const mb = sizeBytes / (1024 * 1024);
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (format === 'UNKNOWN') {
    return { tone: 'warn', text: 'This does not look like a DWG or DXF file. Export the drawing from CAD and try again.' };
  }
  if (format === 'DXF' && mb > CLOUD_DXF_LIMIT_MB) {
    return {
      tone: 'warn',
      text: `DXF detected, but ${mb.toFixed(0)} MB is more than the cloud server can process (${CLOUD_DXF_LIMIT_MB} MB as DXF). ` +
        'Use the desktop tool for this drawing.',
    };
  }
  if (format === 'DWG' && mb > CLOUD_DWG_LIMIT_MB) {
    return {
      tone: 'warn',
      // 18 MB here is the server's separate post-conversion DXF cap
      // (M4ADM_MAX_DXF_MB), not CLOUD_DXF_LIMIT_MB above -- see this
      // file's own comment on why those are two different numbers.
      text: `DWG detected, ${mb.toFixed(1)} MB. A DWG becomes a DXF about 5 to 6 times larger, so this one will probably be ` +
        'more than the 18 MB the cloud server can process once converted, and the job will say so. Use the desktop tool for it.',
    };
  }
  const mismatch = (format === 'DWG' && ext !== 'dwg') || (format === 'DXF' && ext !== 'dxf')
    ? ` The file name says .${ext}, but the content is ${format}; the content is what counts.` : '';
  if (format === 'DWG') {
    return { tone: 'info', text: 'DWG detected. It is converted to DXF on the server first.' + mismatch };
  }
  return { tone: 'info', text: `DXF detected.${mismatch}` };
}
