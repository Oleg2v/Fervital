// Render the rack fallback video frame by frame (deterministic timeline).
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
import fs from 'node:fs';
const [outDir, w = '720', h = '1280', frames = '180', q = 'high'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(`${process.env.BASE_URL ?? 'http://localhost:3000'}/?rack=webgl&capture=1&q=${q}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => typeof window.__captureAdvance === 'function', null, { timeout: 120000 });
await page.evaluate(() => { window.__captureDt = 1 / 30; });
// let textures stream in before the first frame
await page.waitForTimeout(12000);
for (let i = 0; i < 30; i++) await page.evaluate((t) => window.__captureAdvance(t), i * 33.333);
const N = +frames;
for (let i = 0; i < N; i++) {
  const t = i / 30;
  await page.evaluate(([t, i]) => {
    const r = window.__rack;
    if (Math.abs(t - 0.55) < 0.017) r.useRack.setState({ pullTarget: 1 });
    if (Math.abs(t - 4.3) < 0.017) r.useRack.setState({ pullTarget: 0 });
    window.__captureAdvance(1000 + i * 33.333);
  }, [t, i]);
  const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  fs.writeFileSync(`${outDir}/f${String(i).padStart(4, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
  if (i % 30 === 0) console.log('frame', i, new Date().toISOString());
}
await browser.close();
