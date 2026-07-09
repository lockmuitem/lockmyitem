import { chromium } from '../web/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, 'concepts.html');
const outDir = resolve(here, 'concepts');

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 1660 },
  deviceScaleFactor: 2
});

await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });

for (const id of ['concept-1', 'concept-2', 'concept-3']) {
  const locator = page.locator(`#${id}`);
  await locator.screenshot({ path: resolve(outDir, `${id}.png`) });
}

await browser.close();

console.log(`Concepts: ${outDir}`);
