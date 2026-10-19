// Dev-only: Activity column, filter, sort and muted disabled names (desktop light/dark, phone).
import { chromium } from '/home/paperclip/node_modules/playwright/index.mjs';
const out = new URL('./shots/', import.meta.url).pathname;
const base = 'http://127.0.0.1:3101/QAT/agent-ledger';
const b = await chromium.launch({ headless: true, executablePath: '/home/paperclip/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
const errors = [];
for (const [name, vp, scheme] of [['act-light', { width: 1500, height: 700 }, 'light'], ['act-dark', { width: 1500, height: 700 }, 'dark'], ['act-phone', { width: 390, height: 844 }, 'light']]) {
  const p = await b.newPage({ viewport: vp, colorScheme: scheme });
  p.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await p.goto(base); await p.waitForSelector(vp.width < 600 ? '.mlist' : '.ou table', { timeout: 20000 }); await p.waitForTimeout(1500);
  if (vp.width > 600) {
    console.log(name, 'header has Activity:', await p.locator('th', { hasText: 'Activity' }).count());
    console.log(await p.locator('.ou tbody tr').allInnerTexts());
    console.log('paused name color:', await p.locator('strong.off').first().evaluate((e) => getComputedStyle(e).color), '| normal:', await p.locator('tbody strong:not(.off)').first().evaluate((e) => getComputedStyle(e).color));
    await p.getByLabel('Activity').selectOption('paused'); await p.waitForTimeout(300);
    console.log('paused filter rows:', await p.locator('.ou tbody tr').count());
    await p.getByLabel('Activity').selectOption('live'); await p.waitForTimeout(300);
    console.log('live filter rows:', await p.locator('.ou tbody tr').count());
    await p.getByLabel('Activity').selectOption(''); await p.locator('th', { hasText: 'Activity' }).click(); await p.waitForTimeout(300);
  } else {
    await p.getByRole('button', { name: /Filters/ }).click(); await p.waitForTimeout(300);
    console.log('phone has Activity filter:', await p.getByLabel('Activity').count());
    await p.getByLabel('Activity').selectOption('paused'); await p.waitForTimeout(300);
    console.log('phone paused rows:', await p.locator('.mrow').count());
    await p.getByLabel('Activity').selectOption('');
  }
  await p.screenshot({ path: out + name + '.png' });
  console.log(name, 'overflow:', await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1));
  await p.close();
}
console.log('errors', errors); await b.close();
