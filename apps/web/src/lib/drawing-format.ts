// What a chosen drawing file really is, judged by its first bytes rather than its name: a DWG starts with a version
// code such as "AC1032", a text DXF with a "0 / SECTION" pair, a binary DXF with "AutoCAD Binary DXF".
export type DrawingFormat = 'DWG' | 'DXF' | 'UNKNOWN';

export const CLOUD_LIMIT_MB = 25;

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
  if (mb > CLOUD_LIMIT_MB) {
    return {
      tone: 'warn',
      text: `${format} detected, but ${mb.toFixed(0)} MB is over the ${CLOUD_LIMIT_MB} MB cloud limit. ` +
        (format === 'DXF' ? 'Upload the DWG instead (usually several times smaller), or use the desktop tool.' : 'Use the desktop tool.'),
    };
  }
  const mismatch = (format === 'DWG' && ext !== 'dwg') || (format === 'DXF' && ext !== 'dxf')
    ? ` The file name says .${ext}, but the content is ${format}; the content is what counts.` : '';
  if (format === 'DWG') {
    return {
      tone: 'info',
      text: 'DWG detected. It is converted to DXF on the server first. Very large drawings can exceed the server memory; ' +
        'if that happens, use the desktop tool.' + mismatch,
    };
  }
  return { tone: 'info', text: `DXF detected.${mismatch}` };
}
