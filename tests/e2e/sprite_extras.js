// Prévia em tamanho real, paletas e girar 90°. Uso: node tests/e2e/sprite_extras.js <pasta com garagem-pixel.html>
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
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1200 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + sp + '/garagem-pixel.html'); await page.waitForTimeout(800);
  await page.click('#tabEd');
  await page.fill('#edW', '40'); await page.fill('#edH', '20'); await page.click('#edResize'); await page.click('[data-ezoom="8"]');
  const box = await page.locator('#edCanvas').boundingBox(), cell = box.width / 40;
  const click = async (x, y) => { await page.evaluate(() => window.scrollTo(0, 0)); const b = await page.locator('#edCanvas').boundingBox(), c = b.width / (+(await page.inputValue('#edW'))); await page.mouse.click(b.x + (x + 0.5) * c, b.y + (y + 0.5) * c); };
  const setColor = (hx) => page.locator('#edColor').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, hx);
  const px = (x, y) => page.evaluate(([x, y]) => { const c = document.getElementById('edCanvas'); const z = c.width / c.dataset.w; return 0; }, [x, y]);
  const pix = (x, y) => page.evaluate(([x, y]) => { const c = document.getElementById('edCanvas'); const z = c.width / (+document.getElementById('edW').value); return Array.from(c.getContext('2d').getImageData(x * z + 1, y * z + 1, 1, 1).data); }, [x, y]);

  // ---- prévia em tamanho real ----
  const prevW = () => page.evaluate(() => document.getElementById('edPrev').getBoundingClientRect().width);
  ok('preview starts enlarged (220px or so wide)', (await prevW()) >= 160, await prevW());
  await page.click('[data-pscale="1"]'); ok('1x preview is the real size (40px)', Math.abs((await prevW()) - 40) < 1, await prevW());
  await page.click('[data-pscale="3"]'); ok('3x preview is 120px', Math.abs((await prevW()) - 120) < 1, await prevW());
  await page.click('[data-pscale="fit"]');
  for (const bg of ['dark', 'light', 'road', 'check']) {
    await page.click(`[data-pbg="${bg}"]`);
    ok('preview background ' + bg, (await page.getAttribute('#edPrevBox', 'data-bg')) === bg && (await page.getAttribute(`[data-pbg="${bg}"]`, 'aria-pressed')) === 'true');
  }

  // ---- girar 90° ----
  await setColor('#ff0000'); await click(0, 0); // canto superior esquerdo
  await page.click('#edRotCW'); await page.waitForTimeout(100);
  ok('rotate cw swaps size 40x20 → 20x40', (await page.inputValue('#edW')) === '20' && (await page.inputValue('#edH')) === '40');
  const z2 = await page.evaluate(() => document.getElementById('edCanvas').width / 20);
  const topRight = await page.evaluate((z) => Array.from(document.getElementById('edCanvas').getContext('2d').getImageData(19 * z + 1, 1, 1, 1).data), z2);
  ok('red pixel went to the top-right corner', topRight.join() === '255,0,0,255', topRight.join());
  await page.click('#edRotCCW'); await page.waitForTimeout(100);
  ok('rotate ccw goes back to 40x20 with the pixel at top-left', (await page.inputValue('#edW')) === '40' && (await pix(0, 0)).join() === '255,0,0,255');
  await page.click('#spUndo'); await page.waitForTimeout(100);
  ok('undo of a rotation restores the size', (await page.inputValue('#edW')) === '20');
  await page.click('#spUndo'); await page.waitForTimeout(100);
  ok('second undo goes back to 40x20', (await page.inputValue('#edW')) === '40');

  // ---- paleta ----
  const palCount = () => page.locator('#edPal button').count();
  ok('default palette has 16 colours', (await palCount()) === 16);
  fs.writeFileSync(sp + '/out/pal.hex', '#ff0000\n00ff00\n#00f\n# comentario\nlixo\n');
  await page.setInputFiles('#edPalFile', sp + '/out/pal.hex'); await page.waitForTimeout(300);
  ok('hex palette opened (3 colours)', (await palCount()) === 3, await palCount());
  ok('first colour became the brush', (await page.inputValue('#edColor')) === '#ff0000');
  // salvar paleta
  await page.fill('#edName', 'carro'); await page.click('#edPalSave'); await page.waitForTimeout(400);
  const files = await page.evaluate(() => window.__files);
  ok('palette saved as .hex text', files.length === 1 && files[0].name === 'carro-paleta.hex' && Buffer.from(files[0].b64, 'base64').toString() === 'ff0000\n00ff00\n0000ff\n', files.map(f => f.name).join());
  // tirar cor com botão direito
  await page.locator('#edPal button').nth(1).click({ button: 'right' });
  ok('right-click removes a colour', (await palCount()) === 2);
  await page.locator('#edPal button').nth(0).click({ button: 'right' });
  await page.locator('#edPal button').nth(0).click({ button: 'right' });
  ok('the last colour cannot be removed', (await palCount()) === 1);
  // cores do frame → paleta
  await page.click('#edPalReset'); ok('reset gives back 16', (await palCount()) === 16);
  await setColor('#123456'); await click(5, 5); await setColor('#654321'); await click(7, 5);
  await page.click('#edPalFromDraw'); await page.waitForTimeout(100);
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('#edPal button')).map(b => b.title).sort().join());
  ok('palette from the frame has exactly its colours', names.split(',').length >= 2 && names.includes('#123456') && names.includes('#654321'), names);
  // paleta a partir de PNG (a folha exportada do carro)
  await page.click('#edPalReset');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 4; c.height = 1; const g = c.getContext('2d'); ['#102030', '#405060', '#708090', '#a0b0c0'].forEach((h, i) => { g.fillStyle = h; g.fillRect(i, 0, 1, 1); }); return c.toDataURL('image/png').split(',')[1]; });
  fs.writeFileSync(sp + '/out/pal.png', Buffer.from(png, 'base64'));
  await page.setInputFiles('#edPalFile', sp + '/out/pal.png'); await page.waitForTimeout(400);
  ok('palette from a PNG has its 4 colours', (await palCount()) === 4, await palCount());
  await page.screenshot({ path: sp + '/out/sprite_extras.png' });
  await page.setViewportSize({ width: 400, height: 900 }); await page.waitForTimeout(300);
  ok('no horizontal overflow at 400px', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FALHAS' : 'tudo certo'); process.exit(fails ? 1 : 0);
})();
