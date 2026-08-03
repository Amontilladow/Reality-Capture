// Builds an IFC subset = {all entities with id <= K} UNION {target's full
// closure} UNION {minimal spatial chain}, guaranteeing validity regardless
// of K while varying how much of the file's later content is present.
// Usage: node extract_prefix_subset.cjs <input.ifc> <output.ifc> <targetGuid> <maxId>
const fs = require('fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const targetGuid = process.argv[4];
const maxId = Number(process.argv[5]);

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
function drain() { while (queue.length) addEntity(queue.shift()); }

let targetId = null;
for (const [id, line] of entityById) {
  if (line.includes(`'${targetGuid}'`)) { targetId = id; break; }
}
if (!targetId) { console.error('Target GUID not found:', targetGuid); process.exit(1); }
queue.push(targetId);
drain();

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

const requiredClosureSize = closure.size;

// Now add the prefix: every entity with id <= maxId, plus the closure of
// EACH of those (so the file stays internally valid -- if a prefix entity
// references something above maxId, pull that in too).
for (const [id] of entityById) {
  if (id <= maxId) queue.push(id);
}
drain();

console.log(`target+spatial closure alone: ${requiredClosureSize} entities`);
console.log(`maxId cutoff: ${maxId}`);
console.log(`final closure: ${closure.size} entities`);

const sortedIds = [...closure].sort((a, b) => a - b);
const outLines = [];
outLines.push('ISO-10303-21;');
outLines.push('HEADER;');
outLines.push("FILE_DESCRIPTION((''),'2;1');");
outLines.push("FILE_NAME('prefix.ifc','',(''),(''),'','','');");
outLines.push(schemaLine || "FILE_SCHEMA(('IFC4'));");
outLines.push('ENDSEC;');
outLines.push('DATA;');
for (const id of sortedIds) outLines.push(entityById.get(id));
outLines.push('ENDSEC;');
outLines.push('END-ISO-10303-21;');

fs.writeFileSync(outputPath, outLines.join('\n'));
console.log(`Wrote ${outputPath}: ${sortedIds.length} entities, ${fs.statSync(outputPath).size} bytes.`);
