// Dev-only: screenshots of the simplified model cell and the "Models without a price" settings section.
import { chromium } from '/home/paperclip/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:3101/QAT';
const b = await chromium.launch({ headless: true, executablePath: '/home/paperclip/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
const p = await b.newPage({ viewport: { width: 1300, height: 1000 } });
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${base}/agent-ledger`); await p.waitForSelector('.ou table'); await p.waitForTimeout(1500);
console.log((await p.locator('.ou tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 110)).join('\n'));
await p.screenshot({ path: new URL('./shots/table2.png', import.meta.url).pathname });
await p.goto(`${base}/company/settings/agent-ledger-settings`); await p.waitForTimeout(3500);
await p.getByRole('heading', { name: 'Models without a price' }).scrollIntoViewIfNeeded();
await p.screenshot({ path: new URL('./shots/settings2.png', import.meta.url).pathname });
console.log((await p.locator('#ou-models').innerText()).slice(0, 500)); console.log('errors', errors);
await b.close();
