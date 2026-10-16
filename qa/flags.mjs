// Dev-only: hover a flag and check the tooltip appears, with the help cursor.
import { chromium } from '/home/paperclip/node_modules/playwright/index.mjs';
const b = await chromium.launch({ headless: true, executablePath: '/home/paperclip/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:3101/QAT/agent-ledger'); await p.waitForSelector('.ou table'); await p.waitForTimeout(2000);
const f = p.locator('.ou .flag').first(); await f.scrollIntoViewIfNeeded();
console.log('cursor', await f.evaluate((e) => getComputedStyle(e).cursor), '| tooltip before hover', await p.locator('[role=tooltip]').count());
await f.hover(); await p.waitForTimeout(200);
console.log('tooltip after hover', await p.locator('[role=tooltip]').count(), '|', (await p.locator('[role=tooltip]').innerText()).replace(/\n+/g, ' / '));
await p.screenshot({ path: new URL('./shots/flag-tip.png', import.meta.url).pathname });
await p.mouse.move(5, 5); await p.waitForTimeout(100);
console.log('tooltip after leave', await p.locator('[role=tooltip]').count(), 'errors', errors);
await b.close();
