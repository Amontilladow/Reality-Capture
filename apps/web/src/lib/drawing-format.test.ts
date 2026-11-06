import { describe, expect, it } from 'vitest';
import { detectDrawingFormat, drawingNote, formatFromHead } from './drawing-format';

const MB = 1024 * 1024;

describe('drawing format', () => {
  it('recognises DWG, DXF and binary DXF by content', () => {
    expect(formatFromHead('AC1032\u0000\u0000')).toBe('DWG');
    expect(formatFromHead('AC1015')).toBe('DWG');
    expect(formatFromHead('  0\r\nSECTION\r\n  2\r\nHEADER')).toBe('DXF');
    expect(formatFromHead('999\nDXF by x\n0\nSECTION')).toBe('DXF');
    expect(formatFromHead('AutoCAD Binary DXF\r\n\u001a')).toBe('DXF');
    expect(formatFromHead('%PDF-1.7')).toBe('UNKNOWN');
    expect(formatFromHead('')).toBe('UNKNOWN');
  });

  it('reads the head of a real File object', async () => {
    expect(await detectDrawingFormat(new File(['AC1032' + 'x'.repeat(100)], 'a.dwg'))).toBe('DWG');
    expect(await detectDrawingFormat(new File(['  0\nSECTION\n  2\nHEADER\n'], 'a.dxf'))).toBe('DXF');
  });

  it('explains a DWG, and says when the name and the content disagree', () => {
    expect(drawingNote('plan.dwg', 2 * MB, 'DWG').text).toMatch(/converted to DXF on the server/);
    const renamed = drawingNote('plan.dxf', 2 * MB, 'DWG');
    expect(renamed.text).toMatch(/name says \.dxf, but the content is DWG/);
  });

  it('warns about drawings the cloud server cannot hold, by the size that matters (the DXF)', () => {
    const bigDxf = drawingNote('plan.dxf', 35 * MB, 'DXF');
    expect(bigDxf.tone).toBe('warn');
    expect(bigDxf.text).toMatch(/18 MB as DXF/);
    expect(drawingNote('plan.dxf', 12 * MB, 'DXF').tone).toBe('info');
    const bigDwg = drawingNote('plan.dwg', 8 * MB, 'DWG');       // the 8 MB drawing that becomes a 35 MB DXF
    expect(bigDwg.tone).toBe('warn');
    expect(bigDwg.text).toMatch(/5 to 6 times larger/);
    expect(drawingNote('plan.dwg', 2.4 * MB, 'DWG').tone).toBe('info');
  });

  it('warns about files that are neither', () => {
    expect(drawingNote('x.dwg', 8 * MB, 'UNKNOWN').tone).toBe('warn');
  });
});
