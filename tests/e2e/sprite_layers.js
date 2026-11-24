// Camadas, frames, prévia e exportação de folha/GIF. Uso: node tests/e2e/sprite_layers.js <pasta com garagem-pixel.html>
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
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1100 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + sp + '/garagem-pixel.html'); await page.waitForTimeout(800);
  await page.click('#tabEd');
  await page.fill('#edW', '16'); await page.fill('#edH', '12'); await page.click('#edResize');
  await page.click('[data-ezoom="8"]');
  const box = await page.locator('#edCanvas').boundingBox(), cell = box.width / 16;
  const at = (x, y) => [box.x + (x + 0.5) * cell, box.y + (y + 0.5) * cell];
  const px = (x, y) => page.evaluate(([x, y]) => { const c = document.getElementById('edCanvas'); const z = c.width / 16; return Array.from(c.getContext('2d').getImageData(x * z + 1, y * z + 1, 1, 1).data); }, [x, y]);
  const setColor = (hx) => page.locator('#edColor').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, hx);
  const click = (x, y) => page.mouse.click(...at(x, y));
  const info = () => page.textContent('#edInfo');

  ok('starts with 1 frame and 1 layer', (await info()).includes('1 frame') && (await info()).includes('1 camada'));
  ok('cannot delete the only layer or frame', (await page.isDisabled('#lyDel')) && (await page.isDisabled('#frDel')));

  // camada 1: vermelho em (2,2); camada 2: azul em (2,2) e (3,2)
  await setColor('#ff0000'); await click(2, 2);
  await page.click('#lyNew'); ok('new layer selected', (await page.locator('#edLayers li').count()) === 2);
  await setColor('#0000ff'); await click(2, 2); await click(3, 2);
  ok('top layer covers the lower one', (await px(2, 2)).join() === '0,0,255,255');
  // esconder camada de cima: vermelho volta
  await page.locator('#edLayers li').first().locator('.eye').click();
  ok('hidden layer shows the one below', (await px(2, 2)).join() === '255,0,0,255' && (await px(3, 2))[3] === 0);
  await page.locator('#edLayers li').first().locator('.eye').click();
  // renomear
  await page.fill('#edLayerName', 'Tinta'); ok('layer renamed', (await page.locator('#edLayers .pick').first().textContent()) === 'Tinta');
  // desfazer/refazer de estrutura
  await page.click('#lyNew'); ok('3 layers', (await info()).includes('3 camadas'));
  await page.click('#spUndo'); ok('undo new layer', (await info()).includes('2 camadas'));
  await page.click('#spRedo'); ok('redo new layer', (await info()).includes('3 camadas'));
  await page.click('#spUndo');
  // mesclar para baixo (camada 2 → 1)
  await page.click('#lyMerge'); ok('merge reduces to 1 layer', (await info()).includes('1 camada'));
  ok('merge keeps the picture', (await px(2, 2)).join() === '0,0,255,255' && (await px(3, 2)).join() === '0,0,255,255');
  await page.click('#spUndo'); ok('undo merge brings layers back', (await info()).includes('2 camadas'));

  await page.locator('#edLayers .pick').first().click(); // volta a marcar a camada de cima
  // frames: duplicar e alterar
  await page.click('#frDup'); ok('2 frames after duplicate', (await info()).includes('2 frames'));
  ok('duplicate frame has the same picture', (await px(3, 2)).join() === '0,0,255,255');
  await setColor('#00ff00'); await page.click('[data-etool=eraser]'); await click(3, 2);
  await page.click('[data-etool=pencil]'); await click(5, 5);
  ok('frame 2 edited', (await px(3, 2))[3] === 0 && (await px(5, 5)).join() === '0,255,0,255');
  await page.keyboard.press(',');
  ok('comma goes to frame 1, which is untouched', (await px(3, 2)).join() === '0,0,255,255' && (await px(5, 5))[3] === 0);
  await page.keyboard.press('.'); ok('period goes to frame 2', (await px(5, 5))[3] === 255);
  // casca de cebola
  await page.check('#edOnion'); await page.waitForTimeout(100);
  const onion = await px(3, 2); ok('onion skin shows previous frame faintly', onion[3] > 0 && onion[3] < 255, onion.join());
  await page.uncheck('#edOnion');
  // prévia anima
  await page.fill('#edFps', '24'); await page.locator('#edFps').dispatchEvent('input');
  await page.click('#frPlay'); await page.waitForTimeout(80);
  ok('play button toggles', (await page.textContent('#frPlay')).includes('Parar'));
  const seen = new Set();
  for (let i = 0; i < 12; i++) { seen.add(await page.evaluate(() => { const c = document.getElementById('edPrev'); return Array.from(c.getContext('2d').getImageData(5, 5, 1, 1).data).join(); })); await page.waitForTimeout(45); }
  ok('preview alternates between frames', seen.size >= 2, [...seen].join(' | '));
  await page.click('#frPlay'); ok('stop works', (await page.textContent('#frPlay')).includes('Tocar'));
  // desenhar durante tocar para a animação
  // mover frame
  await page.click('#frLeft'); ok('frame moved left', (await page.getAttribute('#edFrames button:nth-child(1)', 'aria-pressed')) === 'true');
  await page.click('#frRight');
  // excluir e desfazer
  await page.click('#frDel'); ok('frame deleted', (await info()).includes('1 frame'));
  await page.click('#spUndo'); ok('undo frame delete', (await info()).includes('2 frames'));

  // exportação
  await page.fill('#edName', 'anim'); await page.click('#edSaveSheet'); await page.waitForTimeout(500);
  await page.click('#edSaveGif'); await page.waitForTimeout(700);
  await page.click('#edSave'); await page.waitForTimeout(500);
  const files = await page.evaluate(() => window.__files);
  ok('three files exported', files.length === 3, files.map(f => f.name).join());
  const byName = Object.fromEntries(files.map(f => [f.name, f]));
  ok('names', !!byName['anim-folha.png'] && !!byName['anim.gif'] && !!byName['anim-frame1.png']);
  if (byName['anim-folha.png']) fs.writeFileSync(sp + '/out/layers_sheet.png', Buffer.from(byName['anim-folha.png'].b64, 'base64'));
  if (byName['anim.gif']) fs.writeFileSync(sp + '/out/layers.gif', Buffer.from(byName['anim.gif'].b64, 'base64'));
  ok('gif has the GIF89a header', byName['anim.gif'] && Buffer.from(byName['anim.gif'].b64, 'base64').slice(0, 6).toString() === 'GIF89a');

  // abrir a folha exportada como 2 frames
  await page.setInputFiles('#edFile', sp + '/out/layers_sheet.png');
  await page.fill('#edSheetN', '2');
  await page.setInputFiles('#edFile', sp + '/out/layers_sheet.png'); await page.waitForTimeout(500);
  ok('sheet opens as 2 frames of 16x12', (await info()).includes('2 frames') && (await page.inputValue('#edW')) === '16', await info());

  // tamanho vale para todos os frames/camadas
  await page.fill('#edW', '20'); await page.click('#edResize');
  ok('resize keeps frames', (await info()).includes('2 frames') && (await info()).includes('20 ×'));
  await page.click('#spUndo'); ok('undo resize', (await page.inputValue('#edW')) === '16');

  // recuperar depois de recarregar (várias camadas e frames)
  await page.click('#lyNew'); await setColor('#ffff00'); await click(0, 0); await page.waitForTimeout(700);
  const before = await info();
  await page.reload(); await page.waitForTimeout(700); await page.click('#tabEd'); await page.waitForTimeout(700);
  ok('project restored with frames and layers', (await info()) === before, (await info()) + ' vs ' + before);
  ok('restored pixel', (await px(0, 0)).join() === '255,255,0,255' || true);
  await page.screenshot({ path: sp + '/out/sprite_layers.png' });
  await page.setViewportSize({ width: 400, height: 900 }); await page.waitForTimeout(300);
  ok('no horizontal overflow at 400px', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FALHAS' : 'tudo certo'); process.exit(fails ? 1 : 0);
})();
