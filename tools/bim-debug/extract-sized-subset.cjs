// Builds an IFC subset containing the target entity's full closure PLUS the
// closures of the first N "other" building elements (by file order), for
// binary-searching the scale at which the missing-geometry bug appears.
// Usage: node extract_sized_subset.cjs <input.ifc> <output.ifc> <targetGuid> <otherElementCount>
const fs = require('fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const targetGuid = process.argv[4];
const otherCount = Number(process.argv[5]);

const rawBuf = fs.readFileSync(inputPath);
const lines = rawBuf.toString('utf8').split(/\r?\n/);

const entityById = new Map();
const idRe = /^#(\d+)\s*=\s*(.*)$/;
let inData = false;
let schemaLine = null;

for (const line of lines) {
  if (line.startsWith('FILE_SCHEMA')) schemaLine = line;
  if (line.startsWith('DATA;')) { inData = true; continue; }
  if (line.startsWith('ENDSEC;') && inData) break;
  if (!inData) continue;
  const m = line.match(idRe);
  if (m) entityById.set(Number(m[1]), line);
}

function refsOf(line) {
  const refs = new Set();
  const re = /#(\d+)/g;
  let m;
  while ((m = re.exec(line))) refs.add(Number(m[1]));
  return refs;
}

const closure = new Set();
const queue = [];
function addEntity(id) {
  if (closure.has(id)) return;
  const line = entityById.get(id);
  if (!line) return;
  closure.add(id);
  for (const ref of refsOf(line)) queue.push(ref);
}
function drain() {
  while (queue.length) addEntity(queue.shift());
}

// 1) Target entity closure.
let targetId = null;
for (const [id, line] of entityById) {
  if (line.includes(`'${targetGuid}'`)) { targetId = id; break; }
}
if (!targetId) { console.error('Target GUID not found:', targetGuid); process.exit(1); }
queue.push(targetId);
drain();

// 2) Spatial chain (same logic as extract_mre.cjs) so it opens cleanly.
let containingStructureId = null;
for (const [id, line] of entityById) {
  if (!/=\s*IFCRELCONTAINEDINSPATIALSTRUCTURE\(/.test(line)) continue;
  if (!refsOf(line).has(targetId)) continue;
  const trailingRefMatch = line.match(/#(\d+)\)\s*;?\s*$/);
  if (trailingRefMatch) {
    containingStructureId = Number(trailingRefMatch[1]);
    addEntity(id);
    addEntity(containingStructureId);
  }
  break;
}
let current = containingStructureId;
while (current !== null) {
  let parentId = null, relId = null;
  for (const [id, line] of entityById) {
    if (!/=\s*IFCRELAGGREGATES\(/.test(line)) continue;
    const m = line.match(/,\s*#(\d+)\s*,\s*\(([^)]*)\)\s*\)\s*;?\s*$/);
    if (!m) continue;
    const relatedIds = m[2].split(',').map(s => Number(s.trim().replace('#', ''))).filter(Boolean);
    if (relatedIds.includes(current)) { parentId = Number(m[1]); relId = id; break; }
  }
  if (parentId === null) break;
  addEntity(relId);
  addEntity(parentId);
  current = parentId;
}
for (const [id, line] of entityById) {
  if (/=\s*IFCPROJECT\(/.test(line)) { addEntity(id); break; }
}
drain();

const baselineSize = closure.size;

// 3) Find "other" building elements in file order (skip the target itself),
// using the same non-spatial-type heuristic the real parser uses.
const SPATIAL_TYPES = new Set(['IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCPROJECT']);
const RELATIONSHIP_OR_GEOM = /^(IFCREL|IFCSHAPE|IFCPRODUCTDEFINITIONSHAPE|IFCCARTESIAN|IFCDIRECTION|IFCAXIS|IFCLOCALPLACEMENT|IFCPOLY|IFCFACE|IFCCLOSEDSHELL|IFCFACETEDBREP|IFCEXTRUDED|IFCPROFILE|IFCRECTANGLE|IFCCIRCLE|IFCCOLOUR|IFCSTYLED|IFCPRESENTATION|IFCMATERIAL|IFCGEOMETRIC|IFCOWNERHISTORY|IFCPERSON|IFCORGANIZATION|IFCAPPLICATION|IFCUNITASSIGNMENT|IFC.*UNIT\b)/;
const elementIds = [];
for (const [id, line] of entityById) {
  const typeMatch = line.match(/=\s*([A-Z0-9]+)\(/);
  if (!typeMatch) continue;
  const type = typeMatch[1];
  if (SPATIAL_TYPES.has(type)) continue;
  if (RELATIONSHIP_OR_GEOM.test(type)) continue;
  if (!/^IFC[A-Z]/.test(type)) continue;
  if (id === targetId) continue;
  // Only entities that look like they have a GlobalId (first param is a
  // quoted 22-char IFC guid) count as "elements" for this purpose.
  if (!/\(\s*'[^']{20,24}'/.test(line)) continue;
  elementIds.push(id);
}
elementIds.sort((a, b) => a - b);

const chosen = elementIds.slice(0, otherCount);
for (const id of chosen) queue.push(id);
drain();

console.log(`baseline(target-only) closure: ${baselineSize} entities`);
console.log(`otherElementCount requested: ${otherCount}, available: ${elementIds.length}, used: ${chosen.length}`);
console.log(`final closure: ${closure.size} entities`);

const sortedIds = [...closure].sort((a, b) => a - b);
const outLines = [];
outLines.push('ISO-10303-21;');
outLines.push('HEADER;');
outLines.push("FILE_DESCRIPTION((''),'2;1');");
outLines.push("FILE_NAME('subset.ifc','',(''),(''),'','','');");
outLines.push(schemaLine || "FILE_SCHEMA(('IFC4'));");
outLines.push('ENDSEC;');
outLines.push('DATA;');
for (const id of sortedIds) outLines.push(entityById.get(id));
outLines.push('ENDSEC;');
outLines.push('END-ISO-10303-21;');

fs.writeFileSync(outputPath, outLines.join('\n'));
console.log(`Wrote ${outputPath}: ${sortedIds.length} entities, ${fs.statSync(outputPath).size} bytes.`);
