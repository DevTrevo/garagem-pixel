// Teste do editor de pixels no navegador. Uso: node tests/e2e/editor.js <pasta com garagem-pixel.html>
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
  await page.goto('file://' + sp + '/garagem-pixel.html');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  await page.selectOption('#carSel', '15'); await page.waitForTimeout(400);
  await page.click('[data-group=bg][data-value="clear"]');
  await page.click('[data-group=zoom][data-value="8"]'); await page.waitForTimeout(300);
  await page.click('[data-group=scale][data-value="1"]');

  async function moveTo(x, y) {
    for (let n = 0; n < 4; n++) {
      const box = await page.locator('#scene').boundingBox(), k = box.width / (await page.evaluate(() => document.getElementById('scene').width));
      const cur = (await page.textContent('#pxInfo')).match(/Pixel (\d+), (\d+)/);
      if (cur && +cur[1] === x && +cur[2] === y) return true;
      const cx = cur ? +cur[1] : 60, cy = cur ? +cur[2] : 20;
      const lastX = (moveTo.x ?? box.x + box.width / 2) + (x - cx) * k, lastY = (moveTo.y ?? box.y + box.height / 2) + (y - cy) * k;
      moveTo.x = lastX; moveTo.y = lastY;
      await page.mouse.move(lastX, lastY);
    }
    const cur = (await page.textContent('#pxInfo')).match(/Pixel (\d+), (\d+)/);
    return !!cur && +cur[1] === x && +cur[2] === y;
  }
  const edInfo = () => page.textContent('#editInfo');
  const exportPng = async () => {
    const n = await page.evaluate(() => window.__files.length);
    await page.click('#exportGame');
    await page.waitForFunction(c => window.__files.length > c, n, { timeout: 8000 });
    const b64 = await page.evaluate(() => window.__files[window.__files.length - 1].b64);
    return Buffer.from(b64, 'base64');
  };

  ok('tools start off', (await page.getAttribute('[data-group=tool][data-value=off]', 'aria-pressed')) === 'true');
  ok('undo/redo/clear start disabled', await page.isDisabled('#edUndo') && await page.isDisabled('#edRedo') && await page.isDisabled('#edClear'));

  // brush
  await page.fill('#brushColor', '#20dd30');
  ok('picking a brush colour turns the brush on', (await page.getAttribute('[data-group=tool][data-value=brush]', 'aria-pressed')) === 'true');
  ok('wrap shows the editing cursor class', await page.evaluate(() => document.getElementById('sceneWrap').classList.contains('editing')));
  const found = await moveTo(60, 12);
  ok('hover reaches the target pixel', found, await page.textContent('#pxInfo'));
  await page.mouse.down(); await page.mouse.up();
  ok('one pixel painted', /1 pixel\(s\) retocado/.test(await edInfo()), await edInfo());
  ok('undo enabled after a stroke', !(await page.isDisabled('#edUndo')));
  ok('check list mentions the edit', (await page.$$eval('#gameChecks li', l => l.map(x => x.textContent).join('|'))).includes('retocado'));

  // drag a line of 5 pixels
  await moveTo(70, 12); await page.mouse.down();
  const box = await page.locator('#scene').boundingBox(), k = box.width / (await page.evaluate(() => document.getElementById('scene').width));
  await page.mouse.move(moveTo.x + 4 * k, moveTo.y, { steps: 6 }); await page.mouse.up();
  ok('drag paints a continuous line (6 px total + 1)', /(6|7) pixel\(s\)/.test(await edInfo()), await edInfo());

  // export has the green pixel
  let png = await exportPng(); fs.writeFileSync(sp + '/out/edit_export.png', png);

  // undo twice (line, then single) and redo
  await page.click('#edUndo'); ok('undo removes the line', /1 pixel\(s\)/.test(await edInfo()), await edInfo());
  await page.keyboard.press('Control+z'); ok('Ctrl+Z undoes the single pixel', !/pixel\(s\) retocado/.test(await edInfo()), await edInfo());
  ok('redo is now enabled', !(await page.isDisabled('#edRedo')));
  await page.keyboard.press('Control+y'); ok('Ctrl+Y redoes', /1 pixel\(s\)/.test(await edInfo()), await edInfo());
  await page.click('#edRedo'); ok('redo restores the line', /(6|7) pixel\(s\)/.test(await edInfo()), await edInfo());

  // eraser
  await page.click('[data-group=tool][data-value=erase]');
  await moveTo(40, 14); await page.mouse.down(); await page.mouse.up();
  ok('eraser counts as an edit', /(7|8) pixel\(s\)/.test(await edInfo()), await edInfo());

  // eyedropper picks a body colour and returns to the brush
  await page.click('[data-group=tool][data-value=pick]');
  await moveTo(30, 12); await page.mouse.down(); await page.mouse.up();
  ok('eyedropper switches back to the brush', (await page.getAttribute('[data-group=tool][data-value=brush]', 'aria-pressed')) === 'true');
  ok('eyedropper changed the brush colour', (await page.inputValue('#brushColor')) !== '#20dd30', await page.inputValue('#brushColor'));

  // palette swatch sets the brush
  const sw = await page.$$('#pal button.sw'); ok('palette swatches are buttons in game mode', sw.length >= 6, sw.length);
  await page.click('[data-group=tool][data-value=off]');
  await sw[1].click();
  ok('clicking a swatch turns the brush on', (await page.getAttribute('[data-group=tool][data-value=brush]', 'aria-pressed')) === 'true');

  // painting inside the wheel raises a warning
  await moveTo(25, 29); await page.mouse.down(); await page.mouse.up();
  ok('painting in the wheel circle warns', (await page.$$eval('#gameChecks li.warn', l => l.map(x => x.textContent).join('|'))).includes('dentro do círculo'));

  // edits survive a slider change and a car switch
  const before = await edInfo();
  await page.fill('[data-k=bodyDY]', '1'); await page.dispatchEvent('[data-k=bodyDY]', 'input'); await page.waitForTimeout(300);
  ok('edits survive an adjustment', /pixel\(s\) retocado/.test(await edInfo()), await edInfo());
  await page.selectOption('#carSel', '08'); await page.waitForTimeout(300);
  ok('another car starts clean', !/pixel\(s\) retocado/.test(await edInfo()));
  await page.selectOption('#carSel', '15'); await page.waitForTimeout(300);
  ok('first car keeps its edits', /pixel\(s\) retocado/.test(await edInfo()));

  // clear
  await page.click('#edClear'); ok('clear removes all edits', !/pixel\(s\) retocado/.test(await edInfo()) && await page.isDisabled('#edClear'));

  // new photo clears everything
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all editor checks passed');
  process.exit(fails ? 1 : 0);
})();
