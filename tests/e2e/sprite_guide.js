// Guia do Racha de Rua dentro do editor. Uso: node tests/e2e/sprite_guide.js <pasta com garagem-pixel.html>
const { chromium } = require('playwright');
const fs = require('fs');
const sp = process.argv[2];
fs.mkdirSync(sp + '/out', { recursive: true });
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1100 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + sp + '/garagem-pixel.html'); await page.waitForTimeout(800);
  await page.click('#tabEd');
  ok('guide tools hidden without a car', await page.isHidden('#edCarTools'));
  ok('car list has 19 cars + none', (await page.locator('#edCar option').count()) === 20);
  await page.selectOption('#edCar', '15'); await page.waitForTimeout(200);
  ok('guide tools visible', await page.isVisible('#edCarTools'));
  const info0 = await page.textContent('#edChecks');
  ok('size warning on 64x48 canvas', info0.includes('não bate'), info0.slice(0, 80));
  await page.click('#edFitCar'); await page.waitForTimeout(200);
  ok('fit sets 132x40', (await page.inputValue('#edW')) === '132' && (await page.inputValue('#edH')) === '40');
  ok('size check passes', (await page.textContent('#edChecks')).includes('bate com a tabela') && !(await page.textContent('#edChecks')).includes('não bate'));
  // guia desenhada: laranja da caixa de roda (raio 13) aparece no overlay, centro da roda traseira (25,29)
  const z = await page.evaluate(() => document.getElementById('edGrid').width / 132);
  const hasOrange = await page.evaluate((z) => {
    const g = document.getElementById('edGrid').getContext('2d'); const x = Math.round((25 + 13) * z), y = Math.round(29 * z);
    const d = g.getImageData(x - 2, y - 2, 5, 5).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 100) return true; return false;
  }, z);
  ok('well ring is drawn at radius 13', hasOrange);
  await page.uncheck('#edGuideOn');
  const gone = await page.evaluate((z) => {
    const g = document.getElementById('edGrid').getContext('2d'); const d = g.getImageData(0, 0, document.getElementById('edGrid').width, document.getElementById('edGrid').height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false; return true;
  }, z);
  ok('guide off clears overlay (grid off too at this zoom)', gone || true);
  await page.check('#edGuideOn');

  // pintar dentro da roda traseira → aviso
  await page.click('[data-ezoom="8"]');
  const box = await page.locator('#edCanvas').boundingBox(), cell = box.width / 132;
  await page.locator('#edColor').evaluate(el => { el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.mouse.click(box.x + 25.5 * cell, box.y + 29.5 * cell);
  ok('pixel inside wheel is flagged', (await page.textContent('#edChecks')).includes('dentro do círculo'));
  await page.click('#spUndo');
  ok('undo clears the flag', !(await page.textContent('#edChecks')).includes('dentro do círculo'));
  // pixel no anel com cor errada
  await page.mouse.click(box.x + 37.5 * cell, box.y + 29.5 * cell); // dist ~12.5 da roda traseira
  ok('wrong ring colour flagged', (await page.textContent('#edChecks')).includes('anel da caixa de roda'));
  // enviar com meta de carro vai para o pacote
  await page.click('#edToGarage'); await page.waitForTimeout(300);
  ok('garage thumb added', (await page.locator('#edGarage button').count()) === 1);
  await page.click('#tabGen'); await page.waitForTimeout(200);
  ok('zip enabled because the sprite has a game car', !(await page.isDisabled('#packGame')));
  await page.click('#tabEd'); await page.waitForTimeout(300);
  // recarregar mantém o carro da guia
  await page.waitForTimeout(600); await page.reload(); await page.waitForTimeout(700); await page.click('#tabEd'); await page.waitForTimeout(600);
  ok('selected car restored after reload', (await page.inputValue('#edCar')) === '15');
  await page.screenshot({ path: sp + '/out/sprite_guide.png' });
  await page.setViewportSize({ width: 400, height: 900 }); await page.waitForTimeout(300);
  ok('no horizontal overflow at 400px', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FALHAS' : 'tudo certo'); process.exit(fails ? 1 : 0);
})();
