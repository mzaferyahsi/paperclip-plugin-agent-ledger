// Dev-only browser check against a disposable Paperclip instance (not shipped).
import { chromium } from '/home/paperclip/node_modules/playwright/index.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:3101/QAT';
const out = new URL('./shots/', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true, executablePath: '/home/paperclip/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
const errors = [];
for (const [name, vp, scheme] of [['desktop-light', { width: 1500, height: 900 }, 'light'], ['desktop-dark', { width: 1500, height: 900 }, 'dark'], ['phone', { width: 390, height: 844 }, 'light']]) {
  const page = await browser.newPage({ viewport: vp, colorScheme: scheme });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`)); page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(`${base}/org-usage`); await page.waitForSelector('.ou table', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (name === 'desktop-light') {
    console.log((await page.locator('.ou').innerText()).slice(0, 1800));
    await page.screenshot({ path: out + 'table.png', fullPage: false });
    await page.getByRole('button', { name: 'Collapse Dalinar' }).click().catch(() => console.log('no collapse button'));
    console.log('rows after collapse', await page.locator('.ou tbody tr').count());
    await page.getByRole('button', { name: 'Expand all' }).click();
    await page.locator('th', { hasText: 'Total' }).click();
    console.log('aria-sort', await page.locator('th[aria-sort]').first().getAttribute('aria-sort'), 'rows', await page.locator('.ou tbody tr').count());
    await page.screenshot({ path: out + 'sorted.png' });
  } else await page.screenshot({ path: out + name + '.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  console.log(name, 'page horizontal overflow:', overflow);
  await page.close();
}
const p2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
p2.on('pageerror', (e) => errors.push(`settings: ${e}`));
await p2.goto(`${base}/company/settings/org-usage-settings`); await p2.waitForTimeout(3000);
console.log('SETTINGS', (await p2.locator('body').innerText()).slice(0, 900));
await p2.screenshot({ path: out + 'settings.png' });
console.log('ERRORS', errors);
await browser.close();
