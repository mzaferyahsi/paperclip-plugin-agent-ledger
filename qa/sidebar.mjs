import { chromium } from '/home/paperclip/node_modules/playwright/index.mjs';
const b = await chromium.launch({ headless: true, executablePath: '/home/paperclip/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: scheme });
  await p.goto('http://127.0.0.1:3101/QAT/dashboard'); await p.waitForTimeout(3500);
  const info = await p.evaluate(() => {
    const out = {};
    for (const label of ['Routines', 'Artifacts', 'Agent ledger']) {
      const a = [...document.querySelectorAll('a')].find((x) => x.textContent.trim() === label);
      if (!a) { out[label] = null; continue; }
      const svg = a.querySelector('svg'); const cs = getComputedStyle(a); const sc = svg && getComputedStyle(svg);
      out[label] = { aColor: cs.color, aFont: cs.fontWeight + ' ' + cs.fontSize, aPad: cs.padding, aClass: a.className.slice(0, 160), svgColor: sc?.color, svgStroke: sc?.stroke, svgSize: sc && sc.width, svgClass: svg?.getAttribute('class'), parentClass: a.parentElement.className.slice(0, 100) };
    }
    return out;
  });
  console.log(scheme, JSON.stringify(info, null, 1));
  await p.close();
}
await b.close();
