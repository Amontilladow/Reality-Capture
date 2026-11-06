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
    expect(drawingNote('plan.dwg', 8 * MB, 'DWG').text).toMatch(/converted to DXF on the server/);
    const renamed = drawingNote('plan.dxf', 8 * MB, 'DWG');
    expect(renamed.text).toMatch(/name says \.dxf, but the content is DWG/);
  });

  it('points a too-big DXF to its DWG, and warns about unknown files', () => {
    const big = drawingNote('plan.dxf', 35 * MB, 'DXF');
    expect(big.tone).toBe('warn');
    expect(big.text).toMatch(/Upload the DWG instead/);
    expect(drawingNote('x.dwg', 8 * MB, 'UNKNOWN').tone).toBe('warn');
  });
});
