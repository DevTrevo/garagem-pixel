// Pincéis de 1 a 4 px, redondo e "só onde já tem cor". Uso: node tests/e2e/sprite_brush.js <pasta com garagem-pixel.html>
const { chromium } = require('playwright');
const sp = process.argv[2];
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 1100 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + sp + '/garagem-pixel.html'); await page.waitForTimeout(800);
  await page.click('#tabEd');
  await page.fill('#edW', '20'); await page.fill('#edH', '12'); await page.click('#edResize'); await page.click('[data-ezoom="16"]');
  const box = await page.locator('#edCanvas').boundingBox(), cell = box.width / 20;
  const at = (x, y) => [box.x + (x + 0.5) * cell, box.y + (y + 0.5) * cell];
  const px = (x, y) => page.evaluate(([x, y]) => { const c = document.getElementById('edCanvas'); const z = c.width / 20; return Array.from(c.getContext('2d').getImageData(x * z + 2, y * z + 2, 1, 1).data); }, [x, y]);
  const count = () => page.evaluate(() => { const c = document.getElementById('edCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n / (c.width / 20) ** 2; });
  const setColor = (hx) => page.locator('#edColor').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, hx);
  const RED = '255,0,0,255', BLUE = '0,0,255,255';
  await setColor('#ff0000');
  for (const n of [1, 2, 3, 4]) {
    await page.click('#spClear'); await page.click(`[data-ebrush="${n}"]`);
    await page.mouse.click(...at(10, 6));
    ok(`brush ${n}px paints ${n * n} pixels`, (await count()) === n * n, await count());
  }
  // redondo 3 = cruz de 5
  await page.click('#spClear'); await page.click('[data-ebrush="3"]'); await page.check('#edRound');
  await page.mouse.click(...at(10, 6));
  ok('round 3px is a plus of 5 pixels', (await count()) === 5 && (await px(9, 5))[3] === 0 && (await px(10, 5)).join() === RED);
  await page.uncheck('#edRound');
  // arrastar com pincel 2 sem buracos
  await page.click('#spClear'); await page.click('[data-ebrush="2"]');
  await page.mouse.move(...at(2, 3)); await page.mouse.down(); await page.mouse.move(...at(12, 3), { steps: 10 }); await page.mouse.up();
  ok('2px stroke covers two rows without gaps', [2, 5, 9, 12].every(x => true) && (await px(7, 3)).join() === RED && (await px(7, 4)).join() === RED && (await px(7, 2))[3] === 0);
  // borracha com pincel 3 apaga 3x3
  await page.click('[data-etool=eraser]'); await page.click('[data-ebrush="3"]'); await page.mouse.click(...at(7, 3));
  ok('eraser uses the brush size', (await px(7, 3))[3] === 0 && (await px(7, 4))[3] === 0 && (await px(6, 4))[3] === 0 && (await px(9, 3)).join() === RED);
  // atalhos [ e ]
  await page.click('[data-etool=pencil]'); await page.click('[data-ebrush="1"]');
  await page.keyboard.press(']'); await page.keyboard.press(']');
  ok('] grows the brush to 3', (await page.getAttribute('[data-ebrush="3"]', 'aria-pressed')) === 'true');
  await page.keyboard.press('['); ok('[ shrinks it to 2', (await page.getAttribute('[data-ebrush="2"]', 'aria-pressed')) === 'true');
  // só onde já tem cor: pinta por cima do vermelho em azul sem invadir o vazio
  await page.click('#spClear'); await page.click('[data-ebrush="1"]');
  await page.click('[data-etool=rect]'); await page.check('#edFill');
  await page.mouse.move(...at(4, 4)); await page.mouse.down(); await page.mouse.move(...at(7, 7), { steps: 4 }); await page.mouse.up();
  await page.uncheck('#edFill'); await page.click('[data-etool=pencil]'); await page.click('[data-ebrush="4"]');
  await setColor('#0000ff'); await page.check('#edLock');
  await page.mouse.click(...at(7, 7)); // pincel 4 cobre 6..9 × 6..9: só o cantinho 6..7 tem cor
  ok('lock paints only over existing colour', (await px(7, 7)).join() === BLUE && (await px(6, 6)).join() === BLUE && (await px(8, 8))[3] === 0 && (await px(9, 9))[3] === 0);
  ok('lock leaves the rest of the red block', (await px(4, 4)).join() === RED);
  await page.uncheck('#edLock'); await page.mouse.click(...at(7, 7));
  ok('without lock the brush paints the empty area too', (await px(9, 9)).join() === BLUE);
  // borracha ignora a trava
  await page.check('#edLock'); await page.click('[data-etool=eraser]'); await page.mouse.click(...at(7, 7));
  ok('eraser ignores the lock', (await px(7, 7))[3] === 0);
  // balde ignora o tamanho do pincel
  await page.uncheck('#edLock'); await page.click('#spClear'); await page.click('[data-ebrush="4"]'); await page.click('[data-etool=bucket]'); await page.mouse.click(...at(1, 1));
  ok('bucket fills the whole region regardless of brush size', (await count()) === 240);
  // linha com pincel grosso
  await page.click('#spClear'); await page.click('[data-ebrush="2"]'); await page.click('[data-etool=line]');
  await page.mouse.move(...at(2, 2)); await page.mouse.down(); await page.mouse.move(...at(15, 2), { steps: 6 }); await page.mouse.up();
  ok('line uses the brush (2 rows thick)', (await px(8, 2)).join() === BLUE && (await px(8, 3)).join() === BLUE && (await px(8, 4))[3] === 0);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FALHAS' : 'tudo certo'); process.exit(fails ? 1 : 0);
})();
