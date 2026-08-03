const crypto = require('crypto');
const fs = require('fs');
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  console.log(f.split(/[\\/]/).pop(), buf.length, hash);
}
