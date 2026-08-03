const fs = require('fs');
const path = require('path');

async function main() {
  const { IfcImporter } = require('@thatopen/fragments');
  const importer = new IfcImporter();
  const wasmDir = path.dirname(require.resolve('web-ifc/web-ifc-node.wasm'));
  importer.wasm = { path: `${wasmDir}/`, absolute: true };

  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  const bytes = new Uint8Array(fs.readFileSync(inputPath));

  console.log('Generating fragments for', inputPath, '...');
  const fragBytes = await importer.process({ bytes });
  fs.writeFileSync(outputPath, Buffer.from(fragBytes));
  console.log('Wrote', outputPath, fragBytes.byteLength, 'bytes');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
