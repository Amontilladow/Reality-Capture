import { describe, expect, it } from 'vitest';
import { convertInputProblems, isDrawingDate } from './bdms-inputs';

describe('BDMS conversion inputs', () => {
  it('accepts the values of a DRM-accepted drawing', () => {
    const meta = { zone_name: 'KHALIFA CITY', sector_number: 'SE45_01', plot_number: 'C8', building_number: '1', floor_id: 'F1' };
    const facts = { floor_height: '3.6', building_height: '15', building_number_of_floors: '2', building_usage_category: 'Commercial',
                    building_usage_type: 'Single-use Commercial', DrawingType: 'As Built', DateOfDrawing: '29-OCT-2026' };
    expect(convertInputProblems(meta, facts, '1')).toEqual([]);
  });

  it('lists the slips of ADM QC trial 02', () => {
    const problems = convertInputProblems(
      { sector_number: 'SE45-01', floor_id: 'Fl' },
      { building_usage_type: 'single use', building_usage_category: 'commercial', DrawingType: 'GIS', DateOfDrawing: '29 oct 26' },
      '',
    ).join(' ');
    for (const field of ['Sector', 'Floor', 'Usage type', 'Usage category', 'Drawing type', 'Date of drawing']) {
      expect(problems).toContain(field);
    }
  });

  it('leaves empty fields to the conversion report (never guessed)', () => {
    expect(convertInputProblems({}, {}, '')).toEqual([]);
  });

  it('checks real calendar dates', () => {
    expect(isDrawingDate('29-OCT-2026')).toBe(true);
    expect(isDrawingDate('31-FEB-2026')).toBe(false);
    expect(isDrawingDate('29-Oct-2026')).toBe(false);
  });
});
