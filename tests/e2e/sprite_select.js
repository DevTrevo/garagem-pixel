// Seleção: mover, copiar, recortar, colar, espelhar, setas. Uso: node tests/e2e/sprite_select.js <pasta com garagem-pixel.html>
const { chromium } = require('playwright');
const sp = process.argv[2];
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1100 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + sp + '/garagem-pixel.html'); await page.waitForTimeout(800);
  await page.click('#tabEd');
  await page.fill('#edW', '20'); await page.fill('#edH', '12'); await page.click('#edResize');
  await page.click('[data-ezoom="16"]');
  const box = await page.locator('#edCanvas').boundingBox(), cell = box.width / 20;
  const at = (x, y) => [box.x + (x + 0.5) * cell, box.y + (y + 0.5) * cell];
  const px = (x, y) => page.evaluate(([x, y]) => { const c = document.getElementById('edCanvas'); const z = c.width / 20; return Array.from(c.getContext('2d').getImageData(x * z + 2, y * z + 2, 1, 1).data); }, [x, y]);
  const RED = '255,0,0,255';
  const drag = async (a, b, mods) => { if (mods) await page.keyboard.down(mods); await page.mouse.move(...at(...a)); await page.mouse.down(); await page.mouse.move(...at(...b), { steps: 6 }); await page.mouse.up(); if (mods) await page.keyboard.up(mods); };
  await page.locator('#edColor').evaluate(el => { el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  // vermelho 2x2 em (2,2)-(3,3) e um pixel azul em (3,2)
  await page.click('[data-etool=rect]'); await page.check('#edFill'); await drag([2, 2], [3, 3]); await page.uncheck('#edFill');
  await page.locator('#edColor').evaluate(el => { el.value = '#0000ff'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-etool=pencil]'); await page.mouse.click(...at(3, 2));
  ok('buttons disabled without selection', (await page.isDisabled('#selCopy')) && (await page.isDisabled('#selPaste')));

  await page.keyboard.press('m');
  ok('M selects the tool', (await page.getAttribute('[data-etool=select]', 'aria-pressed')) === 'true');
  await drag([2, 2], [3, 3]);
  ok('selection made, copy enabled', !(await page.isDisabled('#selCopy')));
  ok('selecting does not change pixels', (await px(2, 2)).join() === RED && (await px(3, 2)).join() === '0,0,255,255');
  ok('selection size is shown', (await page.textContent('#edPos')).includes('2 × 2'));

  // mover arrastando de (2,2) para (8,6)
  await drag([2, 2], [8, 6]);
  ok('moved: new place has pixels', (await px(8, 6)).join() === RED && (await px(9, 6)).join() === '0,0,255,255' && (await px(8, 7)).join() === RED);
  ok('moved: old place is empty', (await px(2, 2))[3] === 0 && (await px(3, 3))[3] === 0);
  await page.click('#spUndo');
  ok('one undo restores the move', (await px(2, 2)).join() === RED && (await px(8, 6))[3] === 0);
  await page.click('#spRedo');
  await drag([8, 6], [9, 7]);

  // Alt+arrastar copia (a seleção agora está em 8,6)
  await drag([8, 6], [14, 2], 'Alt');
  ok('alt-drag copies and keeps the original', (await px(14, 2)).join() === RED && (await px(8, 6)).join() === RED);

  // copiar e colar em outro frame
  await page.click('#selCopy');
  ok('paste enabled after copy', !(await page.isDisabled('#selPaste')));
  await page.click('#frNew'); await page.waitForTimeout(100);
  ok('new frame is empty', (await px(14, 2))[3] === 0);
  await page.keyboard.press('Control+v'); await page.waitForTimeout(100);
  ok('paste without a selection lands at the top-left corner', (await px(0, 0)).join() === RED && (await px(1, 0)).join() === '0,0,255,255');
  ok('pasted area stays selected', !(await page.isDisabled('#selDel')));

  // setas movem a área; Shift move 8
  await page.keyboard.press('ArrowRight');
  ok('arrow moves the selection 1px', (await px(1, 0)).join() === RED && (await px(0, 0))[3] === 0 && (await px(2, 0)).join() === '0,0,255,255');
  await page.keyboard.press('Shift+ArrowRight');
  ok('shift+arrow moves 8px', (await px(9, 0)).join() === RED && (await px(10, 0)).join() === '0,0,255,255');
  await page.click('#spUndo');
  ok('undo of the 8px move', (await px(1, 0)).join() === RED);
  ok('undo drops the selection', await page.isDisabled('#selCopy'));
  await drag([1, 0], [2, 1]);

  // espelhar a área (selecionada em x 1..2)
  await page.click('#selFlipH');
  ok('flip area mirrors inside the selection', (await px(1, 0)).join() === '0,0,255,255' && (await px(2, 0)).join() === RED);
  await page.click('#spUndo');
  await drag([1, 0], [2, 1]);

  // recortar e apagar
  await page.click('#selCut');
  ok('cut removes the area', (await px(2, 1))[3] === 0 && (await px(1, 1))[3] === 0);
  await page.click('#spUndo');
  ok('undo cut', (await px(2, 1)).join() === RED);
  await drag([1, 0], [2, 1]);
  await page.keyboard.press('Delete');
  ok('delete clears the area', (await px(2, 1))[3] === 0);
  await page.click('#spUndo');

  // Esc desmarca; clique fora desmarca
  await page.keyboard.press('Escape'); ok('esc deselects', await page.isDisabled('#selCopy'));
  await drag([0, 0], [1, 1]); await page.mouse.click(...at(18, 10)); ok('click outside deselects', await page.isDisabled('#selCopy'));
  await page.keyboard.press('Escape');
  await page.click('[data-etool=pencil]');
  await page.keyboard.press('ArrowDown');
  ok('arrows without selection move the whole layer', (await px(1, 0))[3] === 0 && (await px(1, 1)).join() === RED && (await px(2, 2)).join() === RED);
  await page.click('#spUndo');
  // Ctrl+A e setas sem seleção movem a camada inteira
  await page.keyboard.press('Control+a'); ok('ctrl+A selects everything', (await page.textContent('#edPos')).includes('20 × 12'));
  // setas em controle deslizante não mexem no desenho
  await page.focus('#edFps'); const before = await px(1, 0); await page.keyboard.press('ArrowRight'); ok('slider keeps its arrow keys', (await px(1, 0)).join() === before.join());
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FALHAS' : 'tudo certo'); process.exit(fails ? 1 : 0);
})();
