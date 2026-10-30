// Render scene.json to a PNG with three.js in headless Chromium (SwiftShader WebGL2).
// usage: node render.js <scene.json> <out.png>
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [sceneFile, outFile] = process.argv.slice(2);
const root = __dirname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/scene.json' ? path.resolve(sceneFile)
    : url === '/' ? path.join(root, 'page.html') : path.join(root, url);
  if (!file.startsWith(root) && file !== path.resolve(sceneFile)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const scene = JSON.parse(fs.readFileSync(sceneFile, 'utf8'));
  const [W, H] = scene.px;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 600000 });
  const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  fs.writeFileSync(outFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const glb = await page.evaluate(() => window.__glb || null);
  if (glb) fs.writeFileSync(outFile.replace(/\.png$/, '.glb'), Buffer.from(glb, 'base64'));
  await browser.close();
  server.close();
  console.log('rendered', W, 'x', H, '->', outFile);
})().catch((e) => { console.error(e); process.exit(1); });
