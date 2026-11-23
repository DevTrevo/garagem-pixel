// Ajustes por carro, arquivo de projeto e teclado. Uso: node tests/e2e/project.js <pasta com garagem-pixel.html>
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
  async function open() {
    await page.goto('file://' + sp + '/garagem-pixel.html'); await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  }
  const val = k => page.inputValue('[data-k=' + k + ']');
  const set = async (k, v) => { await page.fill('[data-k=' + k + ']', String(v)); await page.dispatchEvent('[data-k=' + k + ']', 'input'); await page.waitForTimeout(150); };
  await open();

  // per-car memory in the session
  await page.selectOption('#carSel', '15'); await page.waitForTimeout(300);
  await set('bodyDY', 2); await set('hue', 60);
  await page.selectOption('#carSel', '08'); await page.waitForTimeout(300);
  ok('a new car starts from the current values', (await val('bodyDY')) === '2');
  await set('bodyDY', -1); await set('hue', -40);
  await page.selectOption('#carSel', '15'); await page.waitForTimeout(300);
  ok('car 15 gets its own height back', (await val('bodyDY')) === '2', await val('bodyDY'));
  ok('car 15 gets its own hue back', (await val('hue')) === '60', await val('hue'));
  await page.selectOption('#carSel', '08'); await page.waitForTimeout(300);
  ok('car 08 keeps its own height', (await val('bodyDY')) === '-1', await val('bodyDY'));

  // arrows on the stage
  await page.selectOption('#carSel', '15'); await page.waitForTimeout(300);
  await page.focus('#sceneWrap');
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(150);
  ok('ArrowUp on the stage raises the body', (await val('bodyDY')) === '3', await val('bodyDY'));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
  ok('ArrowDown lowers it', (await val('bodyDY')) === '1', await val('bodyDY'));
  await page.focus('#gname'); await page.keyboard.press('ArrowUp');
  ok('arrows in a text field do not move the car', (await val('bodyDY')) === '1');

  // paint a pixel for car 15 and save the project
  await page.fill('#brushColor', '#20dd30');
  await page.click('[data-group=bg][data-value="clear"]'); await page.click('[data-group=zoom][data-value="8"]'); await page.waitForTimeout(250);
  const box = await page.locator('#scene').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4); await page.mouse.down(); await page.mouse.up();
  const painted = await page.textContent('#editInfo');
  ok('one pixel painted before saving', /1 pixel\(s\)/.test(painted), painted);
  await page.click('#projSave');
  await page.waitForFunction(() => window.__files.length >= 1, null, { timeout: 8000 });
  const saved = await page.evaluate(() => ({ name: window.__files[0].name, json: JSON.parse(atob(window.__files[0].b64)) }));
  ok('project file has the right name', saved.name === 'garagem-pixel-ajustes.json', saved.name);
  ok('project holds both cars', saved.json.perCar['15'] && saved.json.perCar['08'] && saved.json.perCar['08'].bodyDY === -1, JSON.stringify(Object.keys(saved.json.perCar)));
  ok('project holds the edit', saved.json.edits['15'] && saved.json.edits['15'].length === 1 && saved.json.edits['15'][0][2] === 32);
  ok('project has no photo data', JSON.stringify(saved.json).length < 5000, JSON.stringify(saved.json).length);
  fs.writeFileSync(sp + '/out/projeto.json', JSON.stringify(saved.json));

  // reload and import
  await open();
  ok('fresh page starts at defaults', (await val('bodyDY')) === '0');
  await page.setInputFiles('#projFile', sp + '/out/projeto.json'); await page.waitForTimeout(700);
  ok('import restores the car', (await page.inputValue('#carSel')) === '15');
  ok('import restores the height', (await val('bodyDY')) === '1', await val('bodyDY'));
  ok('import restores the hue', (await val('hue')) === '60');
  ok('import restores the edit', /1 pixel\(s\)/.test(await page.textContent('#editInfo')), await page.textContent('#editInfo'));
  ok('status confirms', /Ajustes carregados/.test(await page.textContent('#gameStatus')), await page.textContent('#gameStatus'));
  await page.selectOption('#carSel', '08'); await page.waitForTimeout(300);
  ok('import restores the other car', (await val('bodyDY')) === '-1', await val('bodyDY'));

  // hostile / broken files
  const bad = {
    app: 'garagem-pixel', version: 1, car: 'zz',
    state: { car: '99', bodyDY: 999, bodyScaleY: 'abc', hue: -9999, scale: 3, tool: 'hack', bg: 'scene', colors: 1000, outline: 'yes', gname: 'a\u0001b'.repeat(80) },
    perCar: { '15': { bodyDY: 77 }, 'xx': { bodyDY: 1 } },
    edits: { '15': [[0, 0, 1, 2, 3, 255], [999, 0, 1, 2, 3, 255], [1.5, 2, 1, 2, 3, 255], 'x', [3, 3, 999, -5, 7, 255]], '77': [[0, 0, 1, 1, 1, 255]] }
  };
  fs.writeFileSync(sp + '/out/ruim.json', JSON.stringify(bad));
  await page.setInputFiles('#projFile', sp + '/out/ruim.json'); await page.waitForTimeout(700);
  ok('bad car id is ignored', (await page.inputValue('#carSel')) === '08' || (await page.inputValue('#carSel')) === 'livre', await page.inputValue('#carSel'));
  ok('numbers are clamped to the slider range', Number(await val('bodyDY')) <= 10 && Number(await val('hue')) >= -180 && Number(await val('colors')) <= 24, [await val('bodyDY'), await val('hue'), await val('colors')].join(','));
  ok('an invalid size button value is refused', (await page.getAttribute('[data-group=scale][data-value="4"]', 'aria-pressed')) === 'true');
  ok('an unknown tool is refused (one valid tool stays selected)', (await page.$$eval('[data-group=tool][aria-pressed=true]', b => b.length)) === 1);
  ok('skipped items are reported', /ignorados/.test(await page.textContent('#gameStatus')), await page.textContent('#gameStatus'));
  await page.selectOption('#carSel', '15'); await page.waitForTimeout(300);
  ok('only valid edits were kept (2 of 5)', /2 pixel\(s\)/.test(await page.textContent('#editInfo')), await page.textContent('#editInfo'));
  ok('per-car height is clamped', Number(await val('bodyDY')) === 10, await val('bodyDY'));

  fs.writeFileSync(sp + '/out/lixo.json', 'isto nao e json');
  await page.setInputFiles('#projFile', sp + '/out/lixo.json'); await page.waitForTimeout(500);
  ok('garbage file gives a friendly message', /Não consegui ler/.test(await page.textContent('#gameStatus')), await page.textContent('#gameStatus'));
  fs.writeFileSync(sp + '/out/outro.json', JSON.stringify({ app: 'outra-coisa' }));
  await page.setInputFiles('#projFile', sp + '/out/outro.json'); await page.waitForTimeout(500);
  ok('a json from another app is refused', /Não consegui ler/.test(await page.textContent('#gameStatus')));
  ok('page still works afterwards', await page.isVisible('#exportGame'));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all project checks passed');
  process.exit(fails ? 1 : 0);
})();
