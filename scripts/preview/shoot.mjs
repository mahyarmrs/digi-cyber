// node scripts/preview/shoot.mjs <playwright module> <out.png> [query] [action] — the built window
// (dist/renderer) in Chrome with the demo bridge, as one screenshot.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [, , pw, out, query = '', action = ''] = process.argv;
const { chromium } = await import(pw);
const root = path.resolve('dist/renderer');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 780 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.addInitScript({ path: path.resolve('scripts/preview/mock-dc.js') });
await page.goto(`http://127.0.0.1:${port}/index.html?${query}`);
await page.waitForTimeout(700);
for (const step of action.split(';').filter(Boolean)) {
  const [kind, arg] = step.split('=');
  if (kind === 'click') await page.getByText(arg, { exact: true }).first().click();
  if (kind === 'css') await page.locator(arg).first().click();
  if (kind === 'size') { const [w, h] = arg.split('x').map(Number); await page.setViewportSize({ width: w, height: h }); }
  await page.waitForTimeout(400);
}
await page.screenshot({ path: out });
await browser.close();
server.close();
