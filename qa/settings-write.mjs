// Dev-only: adds a "free provider" rule through the real settings form, then checks the table reflects it.
import { chromium } from '/home/paperclip/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:3101/QAT';
const browser = await chromium.launch({ headless: true, executablePath: '/home/paperclip/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}/company/settings/agent-ledger-settings`); await page.waitForTimeout(2500);
const form = page.getByRole('form', { name: 'Add free provider' });
await form.getByLabel('Provider').fill('omniroute'); await form.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(1500);
console.log('settings lists rule:', (await page.locator('body').innerText()).includes('omniroute'));
await page.goto(`${base}/agent-ledger`); await page.waitForSelector('.ou table'); await page.waitForTimeout(1500);
await page.screenshot({ path: new URL('./shots/after-rule.png', import.meta.url).pathname });
const row = page.locator('tr', { hasText: 'Dabbid' });
console.log('Dabbid cost cell:', (await row.innerText()).replace(/\s+/g, ' '));
console.log('errors', errors);
await browser.close();
