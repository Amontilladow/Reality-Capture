// What a chosen drawing file really is, judged by its first bytes rather than its name: a DWG starts with a version
// code such as "AC1032", a text DXF with a "0 / SECTION" pair, a binary DXF with "AutoCAD Binary DXF".
export type DrawingFormat = 'DWG' | 'DXF' | 'UNKNOWN';

// What the cloud server can process. It has 512 MB, about 210 of them used by the service itself; loading a DXF takes
// roughly 100 MB plus 9 MB per MB of file (measured on the M19B drawings), so DXFs over 18 MB are refused. A DWG
// becomes a DXF about 5 to 6 times larger, so a DWG over about 3 MB lands past the limit too.
export const CLOUD_DXF_LIMIT_MB = 18;
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
      text: `DWG detected, ${mb.toFixed(1)} MB. A DWG becomes a DXF about 5 to 6 times larger, so this one will probably be ` +
        `more than the ${CLOUD_DXF_LIMIT_MB} MB the cloud server can process, and the job will say so. Use the desktop tool for it.`,
    };
  }
  const mismatch = (format === 'DWG' && ext !== 'dwg') || (format === 'DXF' && ext !== 'dxf')
    ? ` The file name says .${ext}, but the content is ${format}; the content is what counts.` : '';
  if (format === 'DWG') {
    return { tone: 'info', text: 'DWG detected. It is converted to DXF on the server first.' + mismatch };
  }
  return { tone: 'info', text: `DXF detected.${mismatch}` };
}
