import { chromium } from '../web/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, 'poster.html');
const outDir = resolve(here, 'out');
const pngPath = resolve(outDir, 'shanghaitech-lostfound-poster.png');
const pdfPath = resolve(outDir, 'shanghaitech-lostfound-poster-a3.pdf');

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1123, height: 1588 },
  deviceScaleFactor: 3
});

await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.screenshot({ path: pngPath, fullPage: false });
await page.pdf({
  path: pdfPath,
  format: 'A3',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' }
});

await browser.close();

console.log(`PNG: ${pngPath}`);
console.log(`PDF: ${pdfPath}`);
