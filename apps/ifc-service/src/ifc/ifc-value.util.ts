// web-ifc represents every IFC attribute as either:
//   - a plain scalar (rare, mostly null)
//   - { value, type, name } for simple typed values (STRING/LABEL/ENUM/BOOLEAN/REF)
//   - { _internalValue, _representationValue, name } for numeric measure types
//     (IFCLENGTHMEASURE, IFCAREAMEASURE, etc.)
//   - an array, for list-valued attributes
// This unwraps any of those into a plain JS value, recursively for arrays.
// Never throws — malformed/unexpected shapes resolve to null rather than
// crashing a batch over one bad attribute.
export function unwrapIfcValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.map(unwrapIfcValue);
  if (typeof raw !== 'object') return raw;

  const obj = raw as Record<string, unknown>;
  if ('_representationValue' in obj) return obj._representationValue;
  if ('value' in obj) return obj.value;
  return raw;
}

// Extracts the REF expressID from a { value, type: 5 } reference attribute.
// Returns null for anything that isn't a well-formed reference.
export function unwrapIfcRef(raw: unknown): number | null {
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    const v = (raw as Record<string, unknown>).value;
    return typeof v === 'number' ? v : null;
  }
  return null;
}

export function unwrapIfcRefList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(unwrapIfcRef).filter((v): v is number => v !== null);
}

// The IFC quantity subtypes each carry their measure in a differently
// named field. This finds whichever one is present and returns
// { quantityType, value, unit }.
const QUANTITY_VALUE_FIELDS: Record<string, string> = {
  LengthValue: 'length',
  AreaValue: 'area',
  VolumeValue: 'volume',
  WeightValue: 'weight',
  CountValue: 'count',
  TimeValue: 'time',
};

export function extractQuantityValue(line: Record<string, unknown>): { quantityType: string | null; value: number | null } {
  for (const [field, type] of Object.entries(QUANTITY_VALUE_FIELDS)) {
    if (field in line && line[field] !== null && line[field] !== undefined) {
      const value = unwrapIfcValue(line[field]);
      return { quantityType: type, value: typeof value === 'number' ? value : null };
    }
  }
  return { quantityType: null, value: null };
}
