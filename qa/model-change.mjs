// Dev-only: opens the Change model dialog on the disposable instance, checks the preview, applies, and checks the table.
import { chromium } from '/home/paperclip/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:3101/QAT';
const browser = await chromium.launch({ headless: true, executablePath: '/home/paperclip/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${base}/agent-ledger`); await page.waitForSelector('.ou table'); await page.waitForTimeout(1500);
// Settings button
const sbtn = page.getByRole('link', { name: 'Settings' }); console.log('settings button present:', await sbtn.count());
// Custom range auto-select
await page.locator('input[type=date]').first().fill('2026-10-01'); await page.locator('input[type=date]').nth(1).fill('2026-10-10'); await page.waitForTimeout(1200);
console.log('Custom pressed after both dates:', await page.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed'));
await page.getByRole('button', { name: '7d' }).first().click().catch(() => {});
// show every agent (the default filter hides idle ones)
await page.getByLabel('Activity').selectOption(''); await page.waitForTimeout(800);
// Model column
console.log('Model column header:', await page.locator('th', { hasText: /^Change model$/ }).count());
const btns = page.getByRole('button', { name: 'Change', exact: true }); console.log('Change buttons:', await btns.count());
await page.screenshot({ path: new URL('./shots/model-change-table.png', import.meta.url).pathname });
await btns.first().click(); await page.waitForSelector('[role=dialog]'); await page.waitForTimeout(1500);
const dlg = page.getByRole('dialog');
console.log('dialog text:', (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 300));
const prov = dlg.getByLabel('Provider'); console.log('providers:', await prov.locator('option').allInnerTexts());
const cur = await prov.inputValue();
const other = (await prov.locator('option').evaluateAll((o) => o.map((x) => x.value))).find((v) => v !== cur);
await prov.selectOption(other); await page.waitForTimeout(1500);
const mi = dlg.getByLabel('Model'); const opts = await dlg.locator('datalist option').evaluateAll((o) => o.map((x) => x.value)); console.log('models listed:', opts.length, opts.slice(0, 4));
await mi.fill(opts[0] ?? 'qa-model-1'); await page.waitForTimeout(500);
console.log('preview:', (await dlg.locator('ul').innerText()).replace(/\s+/g, ' '));
await page.screenshot({ path: new URL('./shots/model-change-dialog.png', import.meta.url).pathname });
await dlg.getByRole('button', { name: 'Apply' }).click(); await page.waitForTimeout(2500);
console.log('dialog closed:', (await page.getByRole('dialog').count()) === 0, '| status:', await page.getByRole('status').allInnerTexts());
console.log('errors', errors);
await browser.close();
