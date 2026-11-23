// Garagem no modo do jogo e pacote .zip. Uso: node tests/e2e/garage_game.js <pasta com garagem-pixel.html>
const { chromium } = require('playwright');
const fs = require('fs');
const sp = process.argv[2];
fs.mkdirSync(sp + '/out', { recursive: true });
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };
const MOCK = () => {
  window.__files = [];
  window.claude = { use: async (n) => n === 'downloads' ? { save: async ({ filename, data }) => {
    const buf = new Uint8Array(await data.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    window.__files.push({ name: filename, b64: btoa(s) }); return {}; } } : null };
};
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + sp + '/garagem-pixel.html'); await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  ok('zip button starts disabled', await page.isDisabled('#packGame'));
  await page.click('#addGarage'); await page.waitForTimeout(200);
  ok('free-mode car does not enable the game zip', await page.isDisabled('#packGame'));
  await page.selectOption('#carSel', '15'); await page.waitForTimeout(400);
  await page.click('#addGarage'); await page.waitForTimeout(200);
  ok('game car enables the zip', !(await page.isDisabled('#packGame')));
  await page.selectOption('#carSel', '08'); await page.waitForTimeout(400);
  await page.click('#addGarage'); await page.waitForTimeout(200);
  await page.selectOption('#carSel', '15'); await page.waitForTimeout(400);
  await page.fill('[data-k=hue]', '90'); await page.dispatchEvent('[data-k=hue]', 'input'); await page.waitForTimeout(300);
  await page.click('#addGarage'); await page.waitForTimeout(200);
  const items = await page.$$eval('#garage li', l => l.map(x => x.title || '-'));
  ok('adding car 15 again replaces it (3 items: free, 08, 15)', items.length === 3 && items.filter(t => t === 'carro-15-civico-si.png').length === 1, items.join(','));
  await page.click('#packGame');
  await page.waitForFunction(() => window.__files.length >= 1, null, { timeout: 8000 });
  const f = await page.evaluate(() => ({ name: window.__files[0].name, b64: window.__files[0].b64 }));
  ok('zip has the expected name', f.name === 'racha-de-rua-carros.zip', f.name);
  fs.writeFileSync(sp + '/out/pacote.zip', Buffer.from(f.b64, 'base64'));
  ok('status confirms 2 cars', /2 carro/.test(await page.textContent('#garageStatus')), await page.textContent('#garageStatus'));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all garage-game checks passed');
  process.exit(fails ? 1 : 0);
})();
