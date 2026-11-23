// Aba Editor de sprites. Uso: node tests/e2e/sprite_editor.js <pasta com garagem-pixel.html>
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
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + sp + '/garagem-pixel.html'); await page.waitForTimeout(900);
  ok('editor hidden at start', await page.isHidden('#edView'));
  await page.click('#tabEd'); await page.waitForTimeout(200);
  ok('editor visible, generator hidden', (await page.isVisible('#edView')) && (await page.isHidden('#genView')));

  await page.fill('#edW', '16'); await page.fill('#edH', '12'); await page.click('#edResize');
  const box = await page.locator('#edCanvas').boundingBox();
  const cell = box.width / 16;
  const at = (x, y) => [box.x + (x + 0.5) * cell, box.y + (y + 0.5) * cell];
  const px = (x, y) => page.evaluate(([x, y]) => { const c = document.getElementById('edCanvas'); const z = c.width / 16; const d = c.getContext('2d').getImageData(x * z + 1, y * z + 1, 1, 1).data; return Array.from(d); }, [x, y]);
  const setColor = (hx) => page.locator('#edColor').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, hx);
  ok('canvas size', Math.abs(box.width - 128) < 1 && Math.abs(box.height - 96) < 1, box.width + 'x' + box.height);

  await setColor('#ff0000');
  let [x0, y0] = at(2, 2), [x1, y1] = at(6, 2);
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 8 }); await page.mouse.up();
  ok('pencil painted start', (await px(2, 2)).join() === '255,0,0,255');
  ok('pencil painted end and between', (await px(6, 2)).join() === '255,0,0,255' && (await px(4, 2)).join() === '255,0,0,255');
  ok('untouched stays empty', (await px(8, 8))[3] === 0);
  ok('undo enabled', !(await page.isDisabled('#spUndo')));
  await page.click('#spUndo');
  ok('one undo removes whole stroke', (await px(2, 2))[3] === 0 && (await px(6, 2))[3] === 0);
  await page.click('#spRedo');
  ok('redo restores stroke', (await px(4, 2)).join() === '255,0,0,255');

  await page.mouse.move(...at(4, 2)); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  ok('right click erases with pencil', (await px(4, 2))[3] === 0 && (await px(3, 2))[3] === 255);

  await page.click('[data-etool=rect]'); await page.check('#edFill');
  await setColor('#0000ff');
  await page.mouse.move(...at(9, 4)); await page.mouse.down(); await page.mouse.move(...at(12, 7), { steps: 5 }); await page.mouse.up();
  ok('filled rect interior', (await px(10, 5)).join() === '0,0,255,255' && (await px(12, 7)).join() === '0,0,255,255');
  ok('outside rect empty', (await px(13, 8))[3] === 0);

  await page.click('[data-etool=bucket]');
  await setColor('#00ff00');
  await page.mouse.click(...at(10, 5));
  ok('bucket recolors region', (await px(9, 4)).join() === '0,255,0,255' && (await px(12, 7)).join() === '0,255,0,255');
  ok('bucket does not leak', (await px(8, 4))[3] === 0);

  await page.click('[data-etool=picker]'); await page.mouse.click(...at(3, 2));
  ok('picker took red', (await page.inputValue('#edColor')) === '#ff0000');

  await page.click('[data-etool=pencil]'); await page.check('#edMirror');
  await page.mouse.click(...at(0, 10));
  ok('mirror paints opposite side', (await px(0, 10))[3] === 255 && (await px(15, 10))[3] === 255);
  await page.uncheck('#edMirror');

  await page.keyboard.press('e');
  ok('shortcut E selects eraser', (await page.getAttribute('[data-etool=eraser]', 'aria-pressed')) === 'true');

  await page.click('#edFlipH');
  ok('flip kept far-side pixel', (await px(15, 10))[3] === 255);
  await page.click('#spUndo');

  await page.click('[data-escale="2"]');
  await page.fill('#edName', 'teste sprite'); await page.click('#edSave'); await page.waitForTimeout(500);
  const files = await page.evaluate(() => window.__files);
  ok('png exported with clean name', files.length === 1 && files[0].name === 'teste-sprite-2x.png', files.map(f => f.name).join());
  if (files[0]) fs.writeFileSync(sp + '/out/sprite_export.png', Buffer.from(files[0].b64, 'base64'));

  await page.click('#edToGarage'); await page.waitForTimeout(200);
  ok('garage thumb appears in editor', (await page.locator('#edGarage button').count()) === 1);

  await page.click('#edFromCar'); ok('first click asks for confirmation', (await page.textContent('#edFromCar')).includes('de novo'));
  await page.click('#edFromCar'); await page.waitForTimeout(300);
  const dims = await page.evaluate(() => [+document.getElementById('edW').value, +document.getElementById('edH').value]);
  ok('generator car opened with its own size', dims[0] > 16 && dims[1] > 8, dims.join('x'));

  await page.waitForTimeout(700);
  await page.reload(); await page.waitForTimeout(700);
  await page.click('#tabEd'); await page.waitForTimeout(500);
  const dims2 = await page.evaluate(() => [+document.getElementById('edW').value, +document.getElementById('edH').value]);
  ok('drawing restored after reload', dims2.join() === dims.join(), dims2.join('x'));
  await page.screenshot({ path: sp + '/out/sprite_editor.png' });

  await page.setViewportSize({ width: 400, height: 900 }); await page.waitForTimeout(300);
  ok('no horizontal overflow at 400px', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await page.click('#tabGen'); await page.waitForTimeout(200);
  ok('back to generator', await page.isVisible('#genView'));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FALHAS' : 'tudo certo'); process.exit(fails ? 1 : 0);
})();
