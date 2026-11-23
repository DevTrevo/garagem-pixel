const { chromium } = require('playwright');
const fs = require('fs');
const sp = process.argv[2];
require('fs').mkdirSync(sp + '/out', { recursive: true });
require('fs').mkdirSync(sp + '/dl', { recursive: true });
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };
const MOCK = () => {
  window.__files = []; window.__prompts = [];
  window.__reply = (prompt) => prompt.indexOf('Imagem 1') >= 0 || prompt.indexOf('Você não recebeu imagens') >= 0
    ? { carro: 'Honda Civic EG (hatch)', vista_lateral: true, nota: 7.4, problemas: ['Contorno fraco', 'Rodas pequenas'], dicas: ['Aumente a nitidez'],
        ajustes: { width: 96, colors: 9999, sharpen: 0.6, palette: 'nope', hue: 'abc', evil: 1, neon: true, clean: 2, rimlight: -5, wheelStyle: 'mesh' } }
    : { resumo: 'Visual anos 90, colorido', ajustes: { hue: 120, sat: 1.5, rimColor: 'gold', beam: true } };
  window.claude = { use: async (n) => {
    if (n === 'downloads') return { save: async ({ filename, data }) => {
      const buf = new Uint8Array(await data.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      window.__files.push({ name: filename, b64: btoa(s) }); return {}; } };
    if (n === 'sample') {
      const fn = async () => ({ text: '{}' });
      fn.limits = async () => ({ maxPromptBytes: 100000, images: { maxCount: 3, maxInputBytes: 1e7, mediaTypes: ['image/png', 'image/jpeg'] } });
      fn.json = async (prompt, opts) => { window.__prompts.push({ prompt, n: opts && opts.images ? opts.images.length : 0, types: opts && opts.images ? opts.images.map(b => b.type) : [] }); return window.__reply(prompt); };
      return fn;
    }
    return null; } };
};
async function waitFiles(page, n) { await page.waitForFunction((n) => window.__files.length >= n, n, { timeout: 15000 }); }
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

  // ---- animation ----
  ok('starts animated with 8 frames', /8 frames/.test(await info()), await info());
  ok('play button says Pausar', (await page.textContent('#play')) === 'Pausar');
  const sig = async () => page.evaluate(() => { const c = document.getElementById('scene'); return c.toDataURL().length + ':' + c.toDataURL().slice(-60); });
  const a = await sig(); await page.waitForTimeout(700); const b = await sig();
  ok('preview canvas changes over time', a !== b);
  await page.click('#play'); await page.waitForTimeout(150);
  ok('pause turns the button into Animar', (await page.textContent('#play')) === 'Animar' && (await page.getAttribute('#play', 'aria-pressed')) === 'false');
  const q1 = await sig(); await page.waitForTimeout(500); const q2 = await sig();
  ok('paused preview stops changing', q1 === q2);
  await page.click('#play'); await page.waitForTimeout(150);
  ok('play resumes', (await page.textContent('#play')) === 'Pausar');

  // ---- presets and palettes ----
  await page.click('[data-preset=neon]'); await page.waitForTimeout(250);
  ok('neon preset turns neon on', await page.isChecked('[data-k=neon]') && (await page.getAttribute('[data-group=palette][data-value="sweetie"]', 'aria-pressed')) === 'true');
  ok('neon preset sets cyan', (await page.getAttribute('[data-group=neonColor][data-value="cyan"]', 'aria-pressed')) === 'true');
  await page.click('[data-preset=gb]'); await page.waitForTimeout(250);
  const gbInfo = await info(); const gbN = +(/(\d+) cores/.exec(gbInfo) || [0, 99])[1];
  ok('Game Boy preset uses at most 4 colours', gbN > 0 && gbN <= 4, gbInfo);
  await page.click('[data-preset=padrao]'); await page.click('[data-group=palette][data-value="auto"]'); await page.waitForTimeout(250);
  ok('back to the default look', /12 cores/.test(await info()), await info());

  // ---- AI assistant (mock) ----
  ok('AI buttons enabled when sample exists', !(await page.isDisabled('#aiAnalyze')) && !(await page.isDisabled('#aiStyle')));
  await page.click('#aiAnalyze'); await page.waitForSelector('#aiApply', { timeout: 8000 });
  const pr = await page.evaluate(() => window.__prompts[0]);
  ok('analysis sends photo + sprite', pr.n === 2 && pr.types[0] === 'image/jpeg' && pr.types[1] === 'image/png', JSON.stringify([pr.n, pr.types]));
  ok('prompt lists the allowed keys', /"palette"/.test(pr.prompt) && /"wheelStyle"/.test(pr.prompt) && !/"rearX"/.test(pr.prompt) && !/"scale"/.test(pr.prompt));
  ok('analysis shows car name and score', /Honda Civic/.test(await page.textContent('#aiOut')) && /7.4\/10/.test(await page.textContent('#aiOut')));
  ok('apply button counts only valid changes (7 of 10)', /Aplicar 7 ajustes/.test(await page.textContent('#aiApply')), await page.textContent('#aiApply'));
  await page.click('#aiApply'); await page.waitForTimeout(300);
  ok('width applied', (await page.inputValue('[data-k=width]')) === '96');
  ok('colors clamped to the slider max', (await page.inputValue('[data-k=colors]')) === '24');
  ok('negative rim light clamped to 0', (await page.inputValue('[data-k=rimlight]')) === '0');
  ok('invalid enum ignored (palette stays auto)', (await page.getAttribute('[data-group=palette][data-value="auto"]', 'aria-pressed')) === 'true');
  ok('invalid number ignored (hue stays 0)', (await page.inputValue('[data-k=hue]')) === '0');
  ok('mesh wheel + clean 2 applied', (await page.getAttribute('[data-group=wheelStyle][data-value="mesh"]', 'aria-pressed')) === 'true' && (await page.getAttribute('[data-group=clean][data-value="2"]', 'aria-pressed')) === 'true');
  await page.click('#aiUndo'); await page.waitForTimeout(250);
  ok('undo restores width and colours', (await page.inputValue('[data-k=width]')) === '128' && (await page.inputValue('[data-k=colors]')) === '12');
  ok('undo restores the wheel style', (await page.getAttribute('[data-group=wheelStyle][data-value="five"]', 'aria-pressed')) === 'true');
  ok('undo disabled afterwards', await page.isDisabled('#aiUndo'));
  await page.fill('#aiText', 'carro dos anos 90 "colorido" com rodas douradas'); await page.click('#aiStyle');
  await page.waitForFunction(() => /Estilo aplicado/.test(document.getElementById('aiStatus').textContent), null, { timeout: 8000 });
  ok('style request applied', (await page.inputValue('[data-k=hue]')) === '120' && (await page.getAttribute('[data-group=rimColor][data-value="gold"]', 'aria-pressed')) === 'true' && await page.isChecked('[data-k=beam]'));
  const sp2 = await page.evaluate(() => window.__prompts[1]);
  ok('style prompt carries the user text without raw double quotes', /colorido/.test(sp2.prompt) && sp2.prompt.indexOf('"colorido"') < 0 && sp2.n === 0);
  ok('style summary is shown', /anos 90/.test(await page.textContent('#aiOut')));
  await page.click('#aiUndo'); await page.waitForTimeout(250);
  ok('undo of style restores hue', (await page.inputValue('[data-k=hue]')) === '0');
  await page.fill('#aiText', ''); await page.click('#aiStyle');
  ok('empty style asks for a description', /Escreva o estilo/.test(await page.textContent('#aiStatus')));

  // ---- exports ----
  await page.fill('#fname', 'meu carro!!');
  await page.click('[data-group=scale][data-value="2"]');
  await page.click('[data-k=spinOn]'); await page.click('[data-k=spinOn]');   // keep spin on
  await page.click('#save'); await waitFiles(page, 1);
  await page.click('#saveSheet'); await waitFiles(page, 2);
  await page.click('#saveGif'); await waitFiles(page, 3);
  await page.click('#saveBody'); await waitFiles(page, 4);
  await page.click('#saveWheel'); await waitFiles(page, 5);
  await page.click('#savePack'); await waitFiles(page, 6);
  const files = await page.evaluate(() => window.__files);
  files.forEach(f => fs.writeFileSync(sp + '/dl/' + f.name, Buffer.from(f.b64, 'base64')));
  console.log('files:', files.map(f => f.name).join(', '));
  ok('png name keeps scale and cleans the name', files[0].name === 'meu-carro-2x.png');
  ok('sheet name', files[1].name === 'meu-carro-sheet-2x.png');
  ok('gif name', files[2].name === 'meu-carro-2x.gif');
  ok('body name', files[3].name === 'meu-carro-body-2x.png');
  ok('wheel name', files[4].name === 'meu-carro-wheel-sheet-2x.png');
  ok('pack name', files[5].name === 'meu-carro-pacote.zip');
  ok('status confirms the pack', /salvo/.test(await page.textContent('#status')), await page.textContent('#status'));
  ok('buttons are enabled again after exporting', !(await page.isDisabled('#savePack')) && !(await page.isDisabled('#save')));

  // static (no motion) behaviour
  for (const k of ['spinOn', 'bob']) await page.uncheck('[data-k=' + k + ']');
  await page.uncheck('[data-k=scroll]'); await page.waitForTimeout(250);
  ok('no motion means a single frame', !/frames/.test(await info()), await info());
  const before = (await page.evaluate(() => window.__files.length));
  await page.click('#saveSheet'); await page.waitForTimeout(300);
  ok('sheet without motion explains instead of saving', /Ligue alguma animação/.test(await page.textContent('#status')) && (await page.evaluate(() => window.__files.length)) === before);
  await page.check('[data-k=spinOn]'); await page.check('[data-k=bob]'); await page.check('[data-k=scroll]');

  // wheel-less body
  await page.click('[data-group=wheelMode][data-value="none"]'); await page.waitForTimeout(250);
  ok('wheel-less mode keeps rendering', /px/.test(await info()));
  await page.click('[data-group=wheelMode][data-value="stamp"]');

  // ---- garage ----
  await page.click('#variants'); await page.waitForTimeout(500);
  ok('6 colour variants land in the garage', (await page.locator('#garage li').count()) === 6);
  await page.click('#addGarage');
  ok('garage has 7 cars', (await page.locator('#garage li').count()) === 7 && /7 carros/.test(await page.textContent('#garageCount')));
  const n0 = await page.evaluate(() => window.__files.length);
  await page.click('#sheet'); await waitFiles(page, n0 + 1);
  const sheet = (await page.evaluate(() => window.__files))[n0];
  fs.writeFileSync(sp + '/dl/' + sheet.name, Buffer.from(sheet.b64, 'base64'));
  ok('garage sheet saved', sheet.name === 'garagem-pixel-2x.png', sheet.name);
  await page.reload(); await page.waitForTimeout(700);
  ok('garage survives a reload', (await page.locator('#garage li').count()) === 7);
  await page.click('#clearGarage');
  ok('garage clears', (await page.locator('#garage li').count()) === 0);

  // ---- layout ----
  await page.setViewportSize({ width: 400, height: 900 }); await page.waitForTimeout(300);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no horizontal overflow at 400px', over <= 0, 'overflow=' + over);
  ok('no page errors', errs.length === 0, errs.join(' | '));

  // ---- no capabilities at all ----
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const p2 = await ctx2.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.goto('file://' + sp + '/garagem-pixel.html'); await p2.waitForTimeout(800);
  await p2.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  ok('without capabilities the AI buttons stay disabled', await p2.isDisabled('#aiAnalyze') && /não está disponível/.test(await p2.textContent('#aiIntro')));
  await p2.click('#save'); await p2.waitForTimeout(800);
  ok('without downloads the image is shown for saving', !(await p2.evaluate(() => document.getElementById('fallback').hidden)));
  ok('no errors without capabilities', e2.length === 0, e2.join(' | '));

  // ---- reduced motion ----
  const ctx3 = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  const p3 = await ctx3.newPage(); await p3.goto('file://' + sp + '/garagem-pixel.html'); await p3.waitForTimeout(700);
  ok('reduced motion starts paused', (await p3.textContent('#play')) === 'Animar');

  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all flow checks passed');
  process.exit(fails ? 1 : 0);
})();
