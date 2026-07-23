import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const IMAGE_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function unwrapCloudResponse(response) {
  for (const candidate of [response?.result, response?.data, response]) {
    if (typeof candidate === 'string') {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // Continue to the next response shape.
      }
    }
    if (candidate && typeof candidate === 'object' && ('ok' in candidate || 'data' in candidate || 'code' in candidate)) {
      return candidate;
    }
  }
  return response || {};
}

const directory = path.resolve(argument('--image-dir'));
const baseUrl = argument('--base-url', 'http://127.0.0.1:4173');
const outputPath = argument('--output');
const purpose = argument('--purpose', 'item');
if (!argument('--image-dir')) throw new Error('Usage: node scripts/classify-directory.mjs --image-dir <directory> [--output result.json]');

const images = (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && IMAGE_TYPES.has(path.extname(entry.name).toLowerCase()))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));
if (!images.length) throw new Error(`No supported images found in ${directory}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
const results = [];

try {
  for (const name of images) {
    const extension = path.extname(name).toLowerCase();
    const buffer = await readFile(path.join(directory, name));
    const response = await page.evaluate(async ({ imageBase64, mimeType, purpose }) => {
      const { cloudbaseFunctionName, getCloudbaseApp } = await import('/src/cloudbaseClient.js');
      const app = await getCloudbaseApp();
      return app.callFunction({
        name: cloudbaseFunctionName,
        parse: true,
        data: {
          action: 'classifyImage',
          imageBase64,
          mimeType,
          itemType: 'found',
          purpose,
          hint: purpose === 'locationDetail'
            ? '来自 QQ 群的失物招领图片。只描述画面中确定可见的方位线索；看不出具体建筑或房间时必须明确说无法确定，不要猜测。'
            : '来自 QQ 群的失物招领图片。请识别画面中最可能被捡到的完整实体；只有图片中存在明确校园标志时才描述地点，不要根据普通背景猜测建筑。'
        }
      });
    }, {
      imageBase64: buffer.toString('base64'),
      mimeType: IMAGE_TYPES.get(extension),
      purpose
    });
    const body = unwrapCloudResponse(response);
    results.push({
      name,
      bytes: buffer.length,
      ok: body.ok !== false,
      code: body.code || '',
      message: body.message || '',
      data: body.data || null
    });
  }
} finally {
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  purpose,
  imageCount: images.length,
  successCount: results.filter((entry) => entry.ok).length,
  results
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const resolvedOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, json, 'utf8');
}
process.stdout.write(json);
if (report.successCount !== report.imageCount) process.exitCode = 2;
