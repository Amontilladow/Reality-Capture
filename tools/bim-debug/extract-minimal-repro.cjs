// Extracts a minimal, self-contained IFC file containing one target entity
// (the problematic IFCFASTENER) plus the full transitive closure of every
// entity it references (geometry, placement, representation context,
// owner history), plus a minimal valid spatial hierarchy so the file opens
// cleanly in web-ifc/fragments.
const fs = require('fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const targetGuid = process.argv[4];

const rawBuf = fs.readFileSync(inputPath);
const lines = rawBuf.toString('utf8').split(/\r?\n/);

const entityById = new Map(); // id -> full line text
const idRe = /^#(\d+)\s*=\s*(.*)$/;
let headerLines = [];
let inData = false;
let schemaLine = null;

for (const line of lines) {
  if (line.startsWith('FILE_SCHEMA')) schemaLine = line;
  if (line.startsWith('DATA;')) { inData = true; continue; }
  if (line.startsWith('ENDSEC;') && inData) break;
  if (!inData) { headerLines.push(line); continue; }
  const m = line.match(idRe);
  if (m) entityById.set(Number(m[1]), line);
}

console.log(`Parsed ${entityById.size} entities from data section.`);

function refsOf(line) {
  const refs = new Set();
  const re = /#(\d+)/g;
  let m;
  while ((m = re.exec(line))) refs.add(Number(m[1]));
  return refs;
}

// Find the target entity by GUID.
let targetId = null;
for (const [id, line] of entityById) {
  if (line.includes(`'${targetGuid}'`)) { targetId = id; break; }
}
if (!targetId) { console.error('Target GUID not found:', targetGuid); process.exit(1); }
console.log(`Target entity: #${targetId} = ${entityById.get(targetId).slice(0, 100)}...`);

// BFS closure of everything the target (transitively) references.
const closure = new Set();
const queue = [targetId];
while (queue.length) {
  const id = queue.shift();
  if (closure.has(id)) continue;
  const line = entityById.get(id);
  if (!line) continue;
  closure.add(id);
  for (const ref of refsOf(line)) {
    if (!closure.has(ref)) queue.push(ref);
  }
}
console.log(`Closure of target entity: ${closure.size} entities.`);

// Pull in a minimal, single-chain spatial hierarchy so this opens as a
// well-formed project, not a floating product -- deliberately walking only
// direct parents (not sibling related-objects lists), to keep the MRE tiny.
//
// IfcRelContainedInSpatialStructure: (guid,hist,name,desc,RelatedElements,RelatingStructure)
// -- RelatingStructure is the single trailing reference.
// IfcRelAggregates: (guid,hist,name,desc,RelatingObject,RelatedObjects)
// -- RelatingObject is the single reference immediately before the list.
function addEntity(id) {
  if (closure.has(id)) return;
  const line = entityById.get(id);
  if (!line) return;
  closure.add(id);
  for (const ref of refsOf(line)) queue.push(ref);
}

let containingStructureId = null;
for (const [id, line] of entityById) {
  if (!/=\s*IFCRELCONTAINEDINSPATIALSTRUCTURE\(/.test(line)) continue;
  if (!refsOf(line).has(targetId)) continue;
  const trailingRefMatch = line.match(/#(\d+)\)\s*;?\s*$/);
  if (trailingRefMatch) {
    containingStructureId = Number(trailingRefMatch[1]);
    addEntity(id); // the relationship entity itself
    addEntity(containingStructureId);
  }
  break;
}

// Walk RelatingObject up the aggregation chain (storey -> building -> site -> project).
let current = containingStructureId;
while (current !== null) {
  let parentId = null;
  let relId = null;
  for (const [id, line] of entityById) {
    if (!/=\s*IFCRELAGGREGATES\(/.test(line)) continue;
    // RelatingObject is the ref right before the related-objects list opens.
    const m = line.match(/,\s*#(\d+)\s*,\s*\(([^)]*)\)\s*\)\s*;?\s*$/);
    if (!m) continue;
    const relatingObj = Number(m[1]);
    const relatedIds = m[2].split(',').map(s => Number(s.trim().replace('#', ''))).filter(Boolean);
    if (relatedIds.includes(current)) { parentId = relatingObj; relId = id; break; }
  }
  if (parentId === null) break;
  addEntity(relId);
  addEntity(parentId);
  current = parentId;
}

// Also make sure IFCPROJECT itself (and anything it directly references --
// units, representation contexts) is included even if the aggregation walk
// above didn't reach it for some reason.
for (const [id, line] of entityById) {
  if (/=\s*IFCPROJECT\(/.test(line)) { addEntity(id); break; }
}

while (queue.length) {
  const id = queue.shift();
  addEntity(id);
}

console.log(`Final closure: ${closure.size} entities.`);

const sortedIds = [...closure].sort((a, b) => a - b);
const outLines = [];
outLines.push('ISO-10303-21;');
outLines.push('HEADER;');
outLines.push("FILE_DESCRIPTION((''),'2;1');");
outLines.push("FILE_NAME('mre.ifc','',(''),(''),'','','');");
outLines.push(schemaLine || "FILE_SCHEMA(('IFC4'));");
outLines.push('ENDSEC;');
outLines.push('DATA;');
for (const id of sortedIds) outLines.push(entityById.get(id));
outLines.push('ENDSEC;');
outLines.push('END-ISO-10303-21;');

fs.writeFileSync(outputPath, outLines.join('\n'));
console.log(`Wrote ${outputPath}: ${sortedIds.length} entities, ${fs.statSync(outputPath).size} bytes.`);
