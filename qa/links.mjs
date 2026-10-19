// Dev-only: name links, filtered org tree stays indented, phone detail link.
import { chromium } from '/home/paperclip/node_modules/playwright/index.mjs';
const out = new URL('./shots/', import.meta.url).pathname;
const base = 'http://127.0.0.1:3101/QAT/agent-ledger';
const b = await chromium.launch({ headless: true, executablePath: '/home/paperclip/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
const p = await b.newPage({ viewport: { width: 1500, height: 700 } }); const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(base); await p.waitForSelector('.ou table', { timeout: 20000 }); await p.waitForTimeout(1500);
console.log('name hrefs:', await p.locator('a.nlink').evaluateAll((a) => a.map((x) => x.getAttribute('href'))));
await p.getByLabel('Activity').selectOption('live'); await p.waitForTimeout(400);
console.log('live filter rows+indent:', await p.locator('.ou tbody tr').evaluateAll((r) => r.map((x) => (x.querySelector('td span')?.style.paddingLeft || '0') + ' ' + x.querySelector('strong')?.textContent)));
await p.screenshot({ path: out + 'filter-tree.png' });
await p.locator('a.nlink').nth(1).click(); await p.waitForTimeout(1500); console.log('after click url:', p.url());
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(base); await m.waitForSelector('.mlist', { timeout: 20000 }); await m.waitForTimeout(1500);
await m.locator('.mmain').nth(1).click(); await m.waitForTimeout(300);
console.log('phone link:', await m.locator('a.alink').first().getAttribute('href'), '| box h:', (await m.locator('a.alink').first().boundingBox()).height);
await m.screenshot({ path: out + 'm-link.png' });
console.log('errors', errors); await b.close();
