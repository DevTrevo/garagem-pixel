// Testes do modo Racha de Rua. Uso: node test_racha.js <pasta_saida>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = require('./src/pipeline.js');
const R = require('./src/racha.js');
const outDir = process.argv[2] || '.';
let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}
// ---- synthetic photo: soft sky gradient, grey road, red hatchback in side view ----
const W = 480, H = 220;
const src = P.makeImage(W, H);
function put(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4; src.data[i] = r; src.data[i + 1] = g; src.data[i + 2] = b; src.data[i + 3] = 255;
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (y < 175) put(x, y, 185 + y * 0.15, 205 + y * 0.1, 228 - y * 0.05);
  else put(x, y, 118, 120, 126);
}
function inEllipse(x, y, cx, cy, rx, ry) { return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1; }
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const shade = 1 - (y - 70) / 300;
  // lower body
  if (x > 40 && x < 440 && y > 120 && y < 178) put(x, y, 190 * shade, 28 * shade, 36 * shade);
  // cabin (trapezoid)
  const top = 78, bot = 120;
  if (y >= top && y <= bot) {
    const t = (y - top) / (bot - top);
    const xl = 130 - t * 40, xr = 330 + t * 60;
    if (x > xl && x < xr) put(x, y, 190 * shade, 28 * shade, 36 * shade);
    // window
    const wl = 140 - t * 36, wr = 322 + t * 52;
    if (y > 88 && y < 116 && x > wl && x < wr) put(x, y, 36 + x * 0.03, 48 + x * 0.03, 70);
  }
}
// wheels
[[110, 172], [370, 172]].forEach(([cx, cy]) => {
  for (let y = cy - 34; y <= cy + 34; y++) for (let x = cx - 34; x <= cx + 34; x++) {
    if (inEllipse(x, y, cx, cy, 33, 33)) put(x, y, 25, 25, 28);
    if (inEllipse(x, y, cx, cy, 20, 20)) put(x, y, 200, 204, 210);
  }
});

// ---- tiny PNG writer so the result can be looked at ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(img, scale, bg) {
  const w = img.w * scale, h = img.h * scale;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const si = (Math.floor(y / scale) * img.w + Math.floor(x / scale)) * 4, di = y * (w * 4 + 1) + 1 + x * 4;
      const a = img.data[si + 3] / 255;
      raw[di] = img.data[si] * a + bg[0] * (1 - a);
      raw[di + 1] = img.data[si + 1] * a + bg[1] * (1 - a);
      raw[di + 2] = img.data[si + 2] * a + bg[2] * (1 - a);
      raw[di + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}


const prepared = P.prepare(src, { tol: 40 });
const det = P.detectWheelsFromPrepared(prepared, 128);
const opts = det ? { rearX: det.rearX, frontX: det.frontX, wheelR: det.r } : {};
check('wheels detected in the synthetic photo', !!det);

// ---- tabela e nomes de arquivo ----
check('19 cars in the table', R.CARS.length === 19);
check('kart and bike (10, 11) are not there', !R.carById('10') && !R.carById('11'));
const names = { '08': 'carro-08-fusca-turbo.png', '15': 'carro-15-civico-si.png', '03': 'carro-03-cobra-coupe.png', '06': 'carro-06-fenix-rs.png', '12': 'carro-12-ponei-gt.png', '04': 'carro-04-vulcao-v8.png', '05': 'carro-05-trovao-4x4.png', '14': 'carro-14-bavaria-325.png', '00': 'carro-00-pocket-1-0.png' };
Object.keys(names).forEach(id => check('file name ' + names[id], R.carById(id).file === names[id], R.carById(id).file));
R.CARS.forEach(c => check('ground: wheel base at or above the last row for car ' + c.id, c.ground === c.rear[1] + R.WHEEL_R && c.rear[1] === c.front[1] && c.ground <= c.h, 'gap=' + c.groundGap));
console.log('cars with the wheel base above the last row: ' + R.CARS.filter(c => c.groundGap).map(c => c.id + ' (' + c.groundGap + ' px)').join(', '));

// ---- cada carro ----
const sheet = [];
R.CARS.forEach(car => {
  const t0 = Date.now();
  const res = R.render(prepared, car, opts), img = res.img, d = img.data;
  const tag = 'car ' + car.id;
  check(tag + ' size', img.w === car.w && img.h === car.h, img.w + 'x' + img.h);
  let semi = 0, inside = 0, ringDark = 0, ringOpaque = 0, lowest = -1, opaque = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * 4, a = d[i + 3];
    if (a > 0 && a < 255) semi++;
    if (!a) continue;
    opaque++;
    for (const wh of [car.rear, car.front]) {
      const dd = Math.hypot(x + 0.5 - wh[0], y + 0.5 - wh[1]);
      if (dd < 11.6) inside++;
      else if (dd <= 13) { ringOpaque++; if (d[i] === 11 && d[i + 1] === 10 && d[i + 2] === 20) ringDark++; }
    }
    if (x > car.rear[0] + 13 && x < car.front[0] - 13) lowest = Math.max(lowest, y);
  }
  check(tag + ' alpha binary', semi === 0);
  check(tag + ' nothing opaque inside r<11.6', inside === 0, 'inside=' + inside);
  check(tag + ' well ring is #0b0a14', ringOpaque > 20 && ringDark === ringOpaque, ringDark + '/' + ringOpaque);
  check(tag + ' 7px clearance between wheels', lowest <= car.ground - 8, 'lowest row=' + lowest);
  check(tag + ' corners transparent', [0, img.w - 1].every(x => d[(0 * img.w + x) * 4 + 3] === 0));
  check(tag + ' has a body', opaque > car.w * car.h * 0.25, 'opaque=' + opaque);
  check(tag + ' checks have no warnings', res.checks.every(c => c.level !== 'warn'), res.checks.filter(c => c.level === 'warn').map(c => c.text).join(' | '));
  check(tag + ' fast', Date.now() - t0 < 1500, (Date.now() - t0) + 'ms');
  sheet.push(res);
});

// ---- lataria em um só matiz ----
const base = R.render(prepared, R.carById('08'), opts);
const rep = base.paint;
check('paint hue found (red car)', rep.hue != null && (rep.hue < 25 || rep.hue > 335), 'hue=' + (rep.hue && rep.hue.toFixed(1)));
check('paint has several tones of one hue', rep.tones >= 3 && rep.maxDev <= 8, 'tones=' + rep.tones + ' dev=' + rep.maxDev.toFixed(1));
check('no non-paint pixel sits on the paint hue', rep.offenders === 0, 'offenders=' + rep.offenders);
const blue = R.render(prepared, R.carById('08'), Object.assign({}, opts, { hue: 200 }));
check('hue slider moves the paint hue', blue.paint.hue != null && blue.paint.hue > 170 && blue.paint.hue < 240, 'hue=' + (blue.paint.hue && blue.paint.hue.toFixed(1)));
check('glass stays a different hue from the blue paint', blue.paint.offenders === 0, 'offenders=' + blue.paint.offenders);

// ---- outline: borda escurecida, nao preta ----
(function () {
  const im = base.img; let ok = 0, pure = 0, n = 0;
  for (let y = 1; y < im.h - 1; y++) for (let x = 1; x < im.w - 1; x++) {
    const i = (y * im.w + x) * 4;
    if (!im.data[i + 3]) continue;
    const up = im.data[((y - 1) * im.w + x) * 4 + 3];
    if (!up) { n++; if (im.data[i] < 120 && im.data[i + 1] < 90) ok++; if (im.data[i] + im.data[i + 1] + im.data[i + 2] === 0) pure++; }
  }
  check('top edge is a dark outline', n > 20 && ok / n > 0.8, ok + '/' + n);
  check('outline is never pure black', pure === 0);
})();

// ---- altura do corpo ----
const up = R.render(prepared, R.carById('08'), Object.assign({}, opts, { bodyDY: 2 }));
const topRow = im => { for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.data[(y * im.w + x) * 4 + 3]) return y; return -1; };
check('raising the body 2 px moves the roof up 2 px', topRow(up.img) === topRow(base.img) - 2 || up.clip.top > 0, topRow(base.img) + ' -> ' + topRow(up.img));
const down = R.render(prepared, R.carById('08'), Object.assign({}, opts, { bodyDY: -3 }));
check('lowering past the ground raises a warning', down.checks.some(c => c.id === 'floor' && c.level === 'warn') || down.clip.bottom === 0);
const tall = R.render(prepared, R.carById('08'), Object.assign({}, opts, { bodyDY: 8 }));
check('raising too far warns about the frame', tall.checks.some(c => c.id === 'frame' && c.level === 'warn'), 'clip top=' + tall.clip.top);
const flat = R.render(prepared, R.carById('08'), Object.assign({}, opts, { bodyScaleY: 80 }));
check('shorter car is shorter', topRow(flat.img) > topRow(base.img));

// ---- subir a carroceria nao leva pedacos de roda junto ----
function greyNearWheels(res) {
  const im = res.img, car = res.car; let n = 0;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const i = (y * im.w + x) * 4; if (!im.data[i + 3]) continue;
    const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2];
    const grey = Math.max(r, g, b) - Math.min(r, g, b) < 40 && (r + g + b) / 3 > 130;
    if (!grey) continue;
    for (const wh of [car.rear, car.front]) if (Math.hypot(x + 0.5 - wh[0], y + 0.5 - wh[1]) < 18) { n++; break; }
  }
  return n;
}
check('no rim/tyre bits near the wheels (lift 0)', greyNearWheels(base) === 0, 'n=' + greyNearWheels(base));
[3, 6].forEach(l => {
  const r = R.render(prepared, R.carById('08'), Object.assign({}, opts, { bodyDY: l }));
  check('no rim/tyre bits near the wheels (lift ' + l + ')', greyNearWheels(r) === 0, 'n=' + greyNearWheels(r));
  check('lift ' + l + ' keeps wells empty', r.checks.find(c => c.id === 'wells').level === 'ok');
});

// ---- sem foto detectada: usa as posicoes padrao ----
const noDet = R.render(prepared, R.carById('00'), {});
check('works with default wheel positions', noDet.img.w === 132 && noDet.img.h === 40);

// ---- conferencia detecta problemas ----
const broken = { img: P.makeImage(10, 10), car: R.carById('00'), clip: { top: 0, bottom: 3, left: 0, right: 0 }, trimmed: 0, paint: { hue: null } };
broken.img.data.fill(255);
const bc = R.check(broken);
check('check flags wrong size', bc.find(c => c.id === 'size').level === 'warn');
check('check flags opaque background', bc.find(c => c.id === 'bg').level === 'warn');
check('check flags body past last row', bc.find(c => c.id === 'floor').level === 'warn');
const semiImg = R.render(prepared, R.carById('00'), opts); semiImg.img.data[3] = 120; semiImg.img.data[7] = 255;
check('check flags semi transparent pixels', R.check(semiImg).find(c => c.id === 'bg').level === 'warn');
const dirty = R.render(prepared, R.carById('00'), opts); dirty.img.data[((20 * 132) + 25) * 4 + 3] = 255;
check('check flags opaque pixel inside a wheel circle', R.check(dirty).find(c => c.id === 'wells').level === 'warn');

// ---- imagens para olhar ----
fs.mkdirSync(outDir, { recursive: true });
function guideOn(res, k) {
  const car = res.car, w = car.w * k, h = car.h * k, big = P.makeImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y / k | 0) * car.w + (x / k | 0)) * 4, di = (y * w + x) * 4;
    const chk = (((x / (k * 2)) | 0) + ((y / (k * 2)) | 0)) % 2 ? 58 : 72;
    big.data[di] = chk; big.data[di + 1] = chk; big.data[di + 2] = chk + 14; big.data[di + 3] = 255;
    if (res.img.data[s + 3]) { big.data[di] = res.img.data[s]; big.data[di + 1] = res.img.data[s + 1]; big.data[di + 2] = res.img.data[s + 2]; }
    for (const wh of [car.rear, car.front]) {
      const dd = Math.hypot((x + 0.5) / k - wh[0], (y + 0.5) / k - wh[1]);
      if (Math.abs(dd - 11) < 0.35 / 1) { big.data[di] = 60; big.data[di + 1] = 230; big.data[di + 2] = 255; }
      if (Math.abs(dd - 13) < 0.3) { big.data[di] = 255; big.data[di + 1] = 170; big.data[di + 2] = 60; }
    }
    if (y === h - 1) { big.data[di] = 120; big.data[di + 1] = 255; big.data[di + 2] = 120; }
  }
  return big;
}
fs.writeFileSync(path.join(outDir, 'racha_08_guide.png'), png(guideOn(base, 6), 1, [0, 0, 0]));
fs.writeFileSync(path.join(outDir, 'racha_08_lift6.png'), png(guideOn(R.render(prepared, R.carById('08'), Object.assign({}, opts, { bodyDY: 6 })), 6), 1, [0, 0, 0]));
[ '00', '03', '05', '09', '15', '19' ].forEach(id => {
  const r = R.render(prepared, R.carById(id), opts);
  fs.writeFileSync(path.join(outDir, 'racha_' + id + '.png'), png(r.img, 4, [60, 60, 74]));
});
console.log(failures ? failures + ' FAILURES' : 'ALL PASS');
process.exit(failures ? 1 : 0);
