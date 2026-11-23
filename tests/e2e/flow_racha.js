const { chromium } = require('playwright');
const fs = require('fs');
const sp = process.argv[2];
require('fs').mkdirSync(sp + '/out', { recursive: true });
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };
const MOCK = () => {
  window.__files = [];
  window.claude = { use: async (n) => {
    if (n === 'downloads') return { save: async ({ filename, data }) => {
      const buf = new Uint8Array(await data.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      window.__files.push({ name: filename, b64: btoa(s) }); return {}; } };
    return null; } };
};
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto('file://' + sp + '/garagem-pixel.html');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  const info = () => page.textContent('#info');
  const files = () => page.evaluate(() => window.__files.map(f => f.name));

  ok('starts in free mode', (await page.evaluate(() => document.getElementById('rail').classList.contains('is-game'))) === false);
  const opts = await page.$$eval('#carSel option', o => o.map(x => x.value));
  ok('select lists free + 19 cars', opts.length === 20 && opts[0] === 'livre' && opts.indexOf('10') < 0 && opts.indexOf('11') < 0, opts.join(','));

  await page.selectOption('#carSel', '08');
  await page.waitForTimeout(400);
  ok('game mode on', await page.evaluate(() => document.getElementById('rail').classList.contains('is-game')));
  ok('info shows the table size', /124 × 48 px/.test(await info()), await info());
  ok('animation step is hidden', await page.evaluate(() => { const d = [...document.querySelectorAll('details.step')].find(x => /Animação/.test(x.textContent.slice(0, 20))); return getComputedStyle(d).display === 'none'; }));
  ok('wheel style controls hidden', await page.evaluate(() => getComputedStyle(document.querySelector('[data-group=wheelStyle]').closest('.field')).display === 'none'));
  ok('game tools visible', await page.isVisible('#gameTools'));
  ok('guide canvas visible and drawn', await page.evaluate(() => { const g = document.getElementById('guide'); if (g.hidden) return false; const d = g.getContext('2d').getImageData(0, 0, g.width, g.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 500; }));
  const checks = await page.$$eval('#gameChecks li', l => l.map(x => x.className + ':' + x.textContent));
  ok('checklist has entries and no warnings', checks.length >= 6 && !checks.some(c => /^warn/.test(c)), checks.join(' | '));
  ok('file name field filled', (await page.inputValue('#gname')) === 'carro-08-fusca-turbo.png');
  await page.click('[data-group=scale][data-value="1"]');
  await page.waitForTimeout(200);
  ok('export info says 124 x 48 at 1x', /124 × 48 px \(1× de 124 × 48\)/.test(await page.textContent('#gameExportInfo')), await page.textContent('#gameExportInfo'));
  await page.screenshot({ path: sp + '/r_game_08.png' });

  // hover pixel readout
  const box = await page.locator('#scene').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  ok('pixel readout works', /Pixel \d+, \d+|Fora/.test(await page.textContent('#pxInfo')), await page.textContent('#pxInfo'));

  // export
  await page.click('#exportGame');
  await page.waitForFunction(() => window.__files.length >= 1, null, { timeout: 8000 });
  ok('exported with the game file name', (await files())[0] === 'carro-08-fusca-turbo.png', (await files()).join());
  fs.writeFileSync(sp + '/out/export_08.png', Buffer.from(await page.evaluate(() => window.__files[0].b64), 'base64'));

  // 2x export keeps the name and doubles the size
  await page.click('[data-group=scale][data-value="2"]');
  await page.click('#exportGame');
  await page.waitForFunction(() => window.__files.length >= 2, null, { timeout: 8000 });
  fs.writeFileSync(sp + '/out/export_08_2x.png', Buffer.from(await page.evaluate(() => window.__files[1].b64), 'base64'));
  ok('2x export keeps the same file name', (await files())[1] === 'carro-08-fusca-turbo.png');

  // raise the body
  await page.click('[data-group=scale][data-value="1"]');
  const before = await page.evaluate(() => document.querySelector('[data-k=bodyDY]').value);
  await page.click('#dyUp'); await page.waitForTimeout(250);
  ok('nudge up moves the slider by 1', (await page.evaluate(() => document.querySelector('[data-k=bodyDY]').value)) === String(Number(before) + 1));
  await page.click('#dyDown'); await page.click('#dyDown'); await page.waitForTimeout(250);
  ok('nudge down works', (await page.evaluate(() => document.querySelector('[data-k=bodyDY]').value)) === String(Number(before) - 1));
  ok('output label shows px', /px/.test(await page.textContent('[data-o=bodyDY]')), await page.textContent('[data-o=bodyDY]'));

  // warning flow: lift far above the frame
  await page.fill('[data-k=bodyDY]', '10'); await page.dispatchEvent('[data-k=bodyDY]', 'input'); await page.waitForTimeout(300);
  const warn = await page.$$eval('#gameChecks li.warn', l => l.map(x => x.textContent));
  ok('too much lift produces a warning', warn.length >= 1, warn.join(' | '));
  const n0 = (await files()).length;
  await page.click('#exportGame'); await page.waitForTimeout(500);
  ok('first click with warnings does not export', (await files()).length === n0 && /mesmo assim/.test(await page.textContent('#exportGame')));
  await page.click('#exportGame');
  await page.waitForFunction((n) => window.__files.length > n, n0, { timeout: 8000 });
  ok('second click exports anyway', (await files()).length === n0 + 1);
  ok('button label resets', /Exportar para o Racha de Rua/.test(await page.textContent('#exportGame')));

  // zoom
  await page.click('[data-group=bg][data-value="clear"]');
  await page.click('[data-group=zoom][data-value="8"]'); await page.waitForTimeout(250);
  const zw = await page.evaluate(() => ({ css: parseFloat(document.getElementById('scene').style.width), w: document.getElementById('scene').width }));
  ok('zoom 8x applies', Math.round(zw.css / zw.w) === 8, JSON.stringify(zw));
  ok('info shows zoom', /zoom 8×/.test(await info()), await info());
  await page.screenshot({ path: sp + '/r_zoom8.png' });

  // guide off
  await page.uncheck('[data-k=guide]'); await page.waitForTimeout(200);
  ok('guide off hides the canvas', await page.evaluate(() => document.getElementById('guide').hidden));
  await page.check('[data-k=guide]');

  // custom name + sanitising
  await page.fill('#gname', 'meu/carro:08'); await page.dispatchEvent('#gname', 'input');
  ok('typing a name keeps the text', (await page.inputValue('#gname')) === 'meu/carro:08');
  await page.fill('[data-k=bodyDY]', '0'); await page.dispatchEvent('[data-k=bodyDY]', 'input'); await page.waitForTimeout(300);
  const m0 = (await files()).length;
  await page.click('#exportGame');
  await page.waitForFunction((n) => window.__files.length > n, m0, { timeout: 8000 });
  ok('file name is sanitised and ends in .png', (await files())[m0] === 'meu-carro-08.png', (await files())[m0]);

  // car 04 shows the ground note
  await page.selectOption('#carSel', '04'); await page.waitForTimeout(400);
  ok('car 04 shows the ground gap note', /2 px acima da última linha/.test(await page.textContent('#carInfo')), await page.textContent('#carInfo'));
  ok('name follows the car', (await page.inputValue('#gname')) === 'carro-04-vulcao-v8.png');

  // garage variants in game mode
  if (await page.isEnabled('#clearGarage')) await page.click('#clearGarage'); await page.click('#variants'); await page.waitForTimeout(800);
  const imgs = await page.$$eval('#garage img', i => i.map(x => x.naturalWidth + 'x' + x.naturalHeight));
  ok('6 colour variants of the game sprite', imgs.length === 6 && imgs.every(s => s === '112x36'), imgs.join(','));

  // hue changes the painted colour in game mode
  await page.fill('[data-k=hue]', '120'); await page.dispatchEvent('[data-k=hue]', 'input'); await page.waitForTimeout(300);
  ok('paint line reports a hue', /Lataria em um só matiz/.test((await page.$$eval('#gameChecks li', l => l.map(x => x.textContent))).join('|')));

  // back to free mode
  await page.selectOption('#carSel', 'livre'); await page.waitForTimeout(500);
  ok('free mode again', !(await page.evaluate(() => document.getElementById('rail').classList.contains('is-game'))) && /frames/.test(await info()), await info());
  ok('guide hidden in free mode', await page.evaluate(() => document.getElementById('guide').hidden));

  // narrow screen
  await page.setViewportSize({ width: 400, height: 800 });
  await page.selectOption('#carSel', '15'); await page.waitForTimeout(500);
  ok('no horizontal overflow at 400px in game mode', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth));
  await page.screenshot({ path: sp + '/r_phone.png', fullPage: false });

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all racha flow checks passed');
  process.exit(fails ? 1 : 0);
})();
