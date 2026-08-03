// Reconstructs the near-complete file (all entities, like prefix maxId=max)
// but ALSO explicitly pulls in every property/material/classification
// relationship that points AT any included entity (reverse references the
// forward-closure approach misses), plus their own closures.
const fs = require('fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

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

console.log(`Total entities in source: ${entityById.size}`);

function refsOf(line) {
  const refs = new Set();
  const re = /#(\d+)/g;
  let m;
  while ((m = re.exec(line))) refs.add(Number(m[1]));
  return refs;
}

// Include literally everything (this is the "100%, plus reverse refs"
// bracket) -- the point of this test is just to confirm reverse-referenced
// property/material/classification content is now present, matching the
// true original file exactly. If this reproduces the bug, we know
// property/material data was never the differentiator either, and the
// true original file IS exactly reproducible by full inclusion (as
// expected) -- if it does NOT reproduce, something else is going on
// (see notes below).
const allIds = [...entityById.keys()];

const outLines = [];
outLines.push('ISO-10303-21;');
outLines.push('HEADER;');
outLines.push("FILE_DESCRIPTION((''),'2;1');");
outLines.push("FILE_NAME('full_with_props.ifc','',(''),(''),'','','');");
outLines.push(schemaLine || "FILE_SCHEMA(('IFC4'));");
outLines.push('ENDSEC;');
outLines.push('DATA;');
for (const id of allIds.sort((a, b) => a - b)) outLines.push(entityById.get(id));
outLines.push('ENDSEC;');
outLines.push('END-ISO-10303-21;');

fs.writeFileSync(outputPath, outLines.join('\n'));
console.log(`Wrote ${outputPath}: ${allIds.length} entities, ${fs.statSync(outputPath).size} bytes.`);
