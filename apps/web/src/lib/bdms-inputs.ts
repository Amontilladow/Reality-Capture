// Input rules for the GIS conversion form, so slips that the official ADM/DRM QC rejects (lowercase floor IDs,
// "single use" instead of a code-list value, "29 oct 26" as a date) are caught before a job is sent.
// The lists and patterns are copied from apps/adm-gis-prep/rules/drm_bdms_v4.1.yaml (domains and file_name);
// apps/adm-gis-prep/tests/test_web_inputs.py fails if they drift apart.

export const USAGE_CATEGORY_TYPES = [
  'Agricultural', 'Cultural', 'Commercial', 'CommercialResidential', 'Diplomatic', 'Educational', 'Governmental',
  'Health', 'Industrial', 'Recreational', 'Religious', 'Residential', 'Utility', 'PublicFacility', 'Undefined',
] as const;

export const USAGE_TYPES = [
  'Residential', 'Commercial', 'Industrial', 'Community Services', 'Open Space and Recreation', 'Inrastructure',
  'Agricultural', 'Household Living', 'Institutional Living', 'Employee Hosing', 'Labor Housing', 'Palace Residential',
  'Mixed-use Residential', 'Single-use Commercial', 'Mixed-use Commercial', 'City Serving Industrial',
  'Research & Development', 'General Industrial', 'Heavy Industrial', 'Public & Institutional', 'Educational',
  'Healthcare', 'Religious', 'General Community Services', 'Developed Open Space', 'Natural Open Space',
  'Archeological', 'Transportation', 'Utilities', 'Farm', 'Poultry/Broiler Operation', 'Dairy Livestock Facility',
  'Abbatoir', 'Ranch', 'Other',
] as const;

export const DRAWING_TYPES = ['As Planned', 'As Built', 'Modification'] as const;

const FLOOR_ID = /^(G|[FMB][1-9][0-9]*)$/;
const POSITIVE_INT = /^[1-9][0-9]*$/;
const NUMBER = /^[0-9]+(\.[0-9]+)?$/;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// File-name parts and the drawing date are written in capitals, as in the DRM-accepted drawings.
export const UPPERCASE_META = new Set(['zone_name', 'sector_number', 'plot_number', 'floor_id']);
export const UPPERCASE_FACTS = new Set(['DateOfDrawing']);

export function isDrawingDate(value: string): boolean {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(value);
  if (!m) return false;
  const month = MONTHS.indexOf(m[2]);
  const day = Number(m[1]);
  const date = new Date(Date.UTC(Number(m[3]), month, day));
  return month >= 0 && date.getUTCMonth() === month && date.getUTCDate() === day;
}

/** Problems that would make the official QC reject the draft. Empty fields are not listed: the conversion reports
 *  them as missing and marks the draft blocked, without guessing a value. */
export function convertInputProblems(meta: Record<string, string>, facts: Record<string, string>,
                                     unitNumber: string): string[] {
  const problems: string[] = [];
  const v = (x: string | undefined) => (x ?? '').trim();
  for (const [key, label] of [['zone_name', 'Zone name'], ['sector_number', 'Sector'], ['plot_number', 'Plot'],
    ['floor_id', 'Floor']] as const) {
    if (v(meta[key]).includes('-')) problems.push(`${label}: no hyphen allowed (it separates the file-name parts; use _).`);
  }
  if (v(meta.building_number) && !POSITIVE_INT.test(v(meta.building_number))) problems.push('Building: a whole number 1, 2, 3 ...');
  if (v(meta.floor_id) && !FLOOR_ID.test(v(meta.floor_id))) problems.push('Floor: G, F1, F2 ..., M1 ... or B1 ...');
  if (v(unitNumber) && !POSITIVE_INT.test(v(unitNumber))) problems.push('Unit number: a whole number 1, 2, 3 ...');
  if (v(facts.building_number_of_floors) && !POSITIVE_INT.test(v(facts.building_number_of_floors))) {
    problems.push('Number of floors: a whole number.');
  }
  for (const [key, label] of [['floor_height', 'Floor height'], ['building_height', 'Building height']] as const) {
    if (v(facts[key]) && !NUMBER.test(v(facts[key]))) problems.push(`${label}: a number in metres, e.g. 3.6.`);
  }
  const lists = [['building_usage_category', 'Usage category', USAGE_CATEGORY_TYPES],
    ['building_usage_type', 'Usage type', USAGE_TYPES], ['DrawingType', 'Drawing type', DRAWING_TYPES]] as const;
  for (const [key, label, list] of lists) {
    if (v(facts[key]) && !(list as readonly string[]).includes(v(facts[key]))) problems.push(`${label}: choose a value from the list.`);
  }
  if (v(facts.DateOfDrawing) && !isDrawingDate(v(facts.DateOfDrawing))) {
    problems.push('Date of drawing: DD-MON-YYYY, e.g. 29-OCT-2026.');
  }
  return problems;
}
