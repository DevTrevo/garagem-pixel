// Runs the pipeline on a synthetic "photo" of a car and checks the result.
// Usage: node test_pipeline.js <out_dir>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = require('./src/pipeline.js');

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

// ---- run ----
const t0 = Date.now();
const prepared = P.prepare(src, { tol: 40 });
check('background removed (not failed)', !prepared.failed);
check('border colour detected near the sky', prepared.bg[2] > 180, 'bg=' + prepared.bg.join(','));
check('crop matches the car box', prepared.img.w > 380 && prepared.img.w < 420 && prepared.img.h > 100 && prepared.img.h < 140,
  prepared.img.w + 'x' + prepared.img.h);
check('road/sky mostly gone', P.countOpaque(prepared.img) < prepared.img.w * prepared.img.h * 0.95);

const res = P.render(prepared, { width: 128, colors: 10, dither: 0.5, shine: true });
const img = res.img;
check('output width is requested width plus outline', img.w === 130, 'w=' + img.w);
check('palette has at most 10 colours', res.palette.length <= 10 && res.palette.length > 3, 'n=' + res.palette.length);

// wheels at the expected spot: tyre colour near the bottom
function px(x, y) { const i = (y * img.w + x) * 4; return Array.from(img.data.slice(i, i + 4)); }
const r = Math.round(128 * 0.075);
const wy = 1 + (img.h - 2 - 2) - r;            // wheel centre row inside the outline + shadow padding
const rearX = 1 + Math.round(128 * 0.22);
const rim = px(rearX, wy - Math.round(r * 0.75));
check('rear wheel rim drawn', rim[3] === 255 && rim[0] > 150, 'rim=' + rim.join(','));
const tyre = px(rearX, wy + r - 1);
check('rear wheel tyre drawn', tyre[3] === 255 && tyre[0] < 60, 'tyre=' + tyre.join(','));

// outline: first opaque pixel of any row must be the outline colour
let outlineOk = false;
for (let y = 0; y < img.h && !outlineOk; y++) for (let x = 0; x < img.w; x++) {
  const p = px(x, y); if (p[3] === 255) { outlineOk = p[0] === 20 && p[1] === 18 && p[2] === 30; break; }
}
check('outline is the first opaque pixel found', outlineOk);

// shadow: bottom row is semi transparent
let shadowCount = 0;
for (let x = 0; x < img.w; x++) { const p = px(x, img.h - 1); if (p[3] > 0 && p[3] < 255) shadowCount++; }
check('ground shadow in the last rows', shadowCount > 20, 'px=' + shadowCount);

// alpha is binary everywhere except the shadow rows
let bad = 0;
for (let y = 0; y < img.h - 2; y++) for (let x = 0; x < img.w; x++) { const a = px(x, y)[3]; if (a !== 0 && a !== 255) bad++; }
check('alpha is 0 or 255 above the shadow', bad === 0, 'bad=' + bad);

// flip
const flipped = P.render(P.prepare(src, { tol: 40, flip: true }), { width: 96 });
check('flip + other width works', flipped.img.w === 98, 'w=' + flipped.img.w);

// failure fallback: tolerance high enough to eat the whole image
const eaten = P.prepare(src, { tol: 2000 });
check('over-high tolerance falls back instead of an empty image', eaten.failed && P.countOpaque(eaten.img) > 0);

// edge cases
const tiny = P.render(P.prepare(P.makeImage(4, 4), {}), { width: 8 });
check('empty input does not throw', !!tiny.img);

check('runs fast enough', Date.now() - t0 < 3000, (Date.now() - t0) + 'ms');

// ---- new features ----
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) n++; return n; };

// hue shift moves a blue pixel and leaves grey and near-black alone
const hs = P.makeImage(3, 1);
hs.data.set([40, 70, 200, 255, 128, 128, 128, 255, 20, 20, 24, 255]);
const hsOut = P.hueShift(hs, 120);
check('hue shift changes a painted (blue) pixel', hsOut.data[0] !== 40 || hsOut.data[1] !== 70 || hsOut.data[2] !== 200,
  Array.from(hsOut.data.slice(0, 3)).join(','));
check('hue shift keeps a grey pixel', hsOut.data[4] === 128 && hsOut.data[5] === 128 && hsOut.data[6] === 128);
check('hue shift keeps a near-black pixel', hsOut.data[8] === 20 && hsOut.data[10] === 24);
check('hue 0 is identity', diff(P.hueShift(hs, 0), hs) === 0);
const redShift = P.render(prepared, { width: 128, colors: 10, hue: 140, wheels: false });
const redBase = P.render(prepared, { width: 128, colors: 10, hue: 0, wheels: false });
check('render with a hue shift changes the palette', redShift.palette.join('|') !== redBase.palette.join('|'));

// wheel styles and rim colours
const wBase = P.render(prepared, { width: 128, colors: 10 }).img;
const wMesh = P.render(prepared, { width: 128, colors: 10, wheelStyle: 'mesh' }).img;
const wDisc = P.render(prepared, { width: 128, colors: 10, wheelStyle: 'disc' }).img;
const wGold = P.render(prepared, { width: 128, colors: 10, rimColor: 'gold' }).img;
check('mesh wheel differs from five-spoke', diff(wBase, wMesh) > 20, 'px=' + diff(wBase, wMesh));
check('disc wheel differs from five-spoke', diff(wBase, wDisc) > 20, 'px=' + diff(wBase, wDisc));
check('gold rim differs from silver', diff(wBase, wGold) > 20, 'px=' + diff(wBase, wGold));
let goldPx = 0;
for (let i = 0; i < wGold.data.length; i += 4) if (wGold.data[i + 3] === 255 && wGold.data[i] > 230 && wGold.data[i + 1] > 200 && wGold.data[i + 2] < 150) goldPx++;
check('gold rim has yellow pixels', goldPx > 5, 'px=' + goldPx);
const sizes = ['five', 'mesh', 'disc'].map(s => P.render(prepared, { width: 128, wheelStyle: s }).img.w);
check('wheel style does not change output size', sizes.every(v => v === sizes[0]));

// tinted outline follows the body colour instead of a fixed colour
const tinted = P.render(prepared, { width: 128, colors: 10, outlineMode: 'tint', wheels: false, shadow: false }).img;
let tintOk = false, tintCol = null;
for (let y = 0; y < tinted.h && !tintOk; y++) for (let x = 0; x < tinted.w; x++) {
  const i = (y * tinted.w + x) * 4;
  if (tinted.data[i + 3] === 255) { tintCol = [tinted.data[i], tinted.data[i + 1], tinted.data[i + 2]]; tintOk = !(tintCol[0] === 20 && tintCol[1] === 18 && tintCol[2] === 30) && tintCol[0] < 90; break; }
}
check('tinted outline is dark but not the fixed colour', tintOk, 'col=' + (tintCol || []).join(','));

// wheel detection on the synthetic photo (wheels at ~17.5% and ~82.5%, r ~ 8%)
const det = P.detectWheelsFromPrepared(prepared, 128);
check('wheels detected', !!det);
if (det) {
  check('rear wheel x close to expected', Math.abs(det.rearX - 0.175) < 0.05, 'x=' + det.rearX.toFixed(3));
  check('front wheel x close to expected', Math.abs(det.frontX - 0.825) < 0.05, 'x=' + det.frontX.toFixed(3));
  check('wheel radius close to expected', Math.abs(det.r - 0.0825) < 0.025, 'r=' + det.r.toFixed(3));
}
check('detection returns null on an empty image', P.detectWheels(P.makeImage(32, 16)) === null);

// ---- v3: pixel art polish ----
const uniq = (im) => { const m = new Set(); for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 3] === 255) m.add(im.data[i] + ',' + im.data[i + 1] + ',' + im.data[i + 2]); return m; };
const bare = { width: 128, colors: 10, wheelMode: 'keep', outline: false, shadow: false, shine: false, rimlight: 0 };

// sharpen
const flat = P.makeImage(5, 5); for (let i = 0; i < 25; i++) flat.data.set([100, 100, 100, 255], i * 4);
flat.data.set([160, 160, 160, 255], 12 * 4);
check('sharpen amount 0 is identity', diff(P.sharpen(flat, 0), flat) === 0);
const shp = P.sharpen(flat, 0.8);
check('sharpen raises the contrast of a bright centre', shp.data[12 * 4] > 160, 'v=' + shp.data[12 * 4]);

// clean pixels
const noisy = P.makeImage(5, 5); for (let i = 0; i < 25; i++) noisy.data.set([40, 80, 200, 255], i * 4);
noisy.data.set([220, 30, 30, 255], 12 * 4);
const cl = P.cleanPixels(noisy, 1);
check('clean removes an isolated odd pixel', cl.data[12 * 4] === 40 && cl.data[12 * 4 + 2] === 200);
const line = P.makeImage(5, 5); for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) line.data.set([40, 80, 200, 255], (y * 5 + x) * 4);
line.data.set([200, 200, 200, 255], (0 * 5 + 2) * 4);
check('clean level 1 keeps a silhouette spur', P.cleanPixels(line, 1).data[(0 * 5 + 2) * 4 + 3] === 255);
check('clean level 2 drops a silhouette spur', P.cleanPixels(line, 2).data[(0 * 5 + 2) * 4 + 3] === 0);
check('clean level 0 is identity', diff(P.cleanPixels(noisy, 0), noisy) === 0);

// fixed palettes
const hexSet = (k) => new Set(P.PALETTES[k].map(c => c.join(',')));
['pico8', 'sweetie', 'gameboy'].forEach((k) => {
  const r = P.render(prepared, Object.assign({}, bare, { palette: k }));
  const u = uniq(r.img), allowed = hexSet(k);
  let inside = true; u.forEach(c => { if (!allowed.has(c)) inside = false; });
  check('palette ' + k + ' only uses its own colours', inside && u.size >= 2, 'n=' + u.size);
});
check('game boy palette has at most 4 colours', uniq(P.render(prepared, Object.assign({}, bare, { palette: 'gameboy' })).img).size <= 4);
check('auto palette honours the colour count', uniq(P.render(prepared, bare).img).size <= 10);

// rim light and glass shine stay inside the palette
const rl = P.render(prepared, Object.assign({}, bare, { rimlight: 0.8, shine: true, clean: 1, sharpen: 0.4 }));
check('rim light + shine + clean keep the colour count', uniq(rl.img).size <= 10, 'n=' + uniq(rl.img).size);
check('rim light changes some pixels', diff(rl.img, P.render(prepared, Object.assign({}, bare, { sharpen: 0.4, clean: 1, shine: true })).img) > 10);

// wheel modes
const keep = P.render(prepared, { width: 128, colors: 10, wheelMode: 'keep' });
const stamp = P.render(prepared, { width: 128, colors: 10, wheelMode: 'stamp' });
const none = P.render(prepared, { width: 128, colors: 10, wheelMode: 'none' });
check('stamp differs from keep', diff(keep.img, stamp.img) > 100);
const wg = none.geom.wheels[0], at = (im, x, y) => im.data[(Math.round(y) * im.w + Math.round(x)) * 4 + 3];
check('wheel-less body has a transparent well', at(none.img, wg.cx, wg.cy) === 0 && at(stamp.img, wg.cx, wg.cy) === 255);
check('geometry reports two wheels with a radius', none.geom.wheels.length === 2 && wg.r >= 3);

// frames
const body = P.prepareBody(prepared, { width: 128, colors: 10, shine: true, rimlight: 0.5 });
const f0 = P.frame(body, {}, 0, { spin: 1 }), f1 = P.frame(body, {}, 0.1, { spin: 1 }), fEnd = P.frame(body, {}, 1, { spin: 1 });
check('wheels turn between frames', diff(f0.img, f1.img) > 20, 'px=' + diff(f0.img, f1.img));
check('the loop closes (t=1 equals t=0)', diff(f0.img, fEnd.img) <= 8, 'px=' + diff(f0.img, fEnd.img));
const mesh0 = P.frame(body, { wheelStyle: 'mesh' }, 0, { spin: 1 }), mesh1 = P.frame(body, { wheelStyle: 'mesh' }, 1, { spin: 1 });
check('mesh wheel loop closes too', diff(mesh0.img, mesh1.img) <= 8, 'px=' + diff(mesh0.img, mesh1.img));
check('spin 0 freezes the wheels', diff(P.frame(body, {}, 0, { spin: 0 }).img, P.frame(body, {}, 0.3, { spin: 0 }).img) === 0);
const bobA = P.frame(body, {}, 0, { bob: true, spin: 0 }), bobB = P.frame(body, {}, 0.125, { bob: true, spin: 0 });
check('bob moves the body by one pixel', diff(bobA.img, bobB.img) > 40, 'px=' + diff(bobA.img, bobB.img));
check('frames keep one size across the loop', [0, 0.25, 0.5, 0.75].every(t => { const g = P.frame(body, {}, t, { bob: true, exhaust: true, beam: true, neon: true }).geom; return g.w === P.frame(body, {}, 0, { bob: true, exhaust: true, beam: true, neon: true }).geom.w; }));
const plain = P.frame(body, {}, 0, null), fxAll = P.frame(body, {}, 0.3, { exhaust: true, speed: true, beam: true, neon: true, dust: true, neonColor: 'cyan' });
check('effects add padding around the car', fxAll.img.w > plain.img.w && fxAll.geom.padL > 0 && fxAll.geom.padR > 0 && fxAll.img.h === plain.img.h + 2,
  plain.img.w + '→' + fxAll.img.w);
check('effects draw pixels outside the car', P.countOpaque(fxAll.img) > P.countOpaque(plain.img) + 20);
['exhaust', 'speed', 'beam', 'neon', 'dust'].forEach((k) => {
  const o = {}; o[k] = true;
  const a = P.frame(body, {}, 0.3, o), b = P.frame(body, {}, 0.3, null);
  const extra = P.countOpaque(a.img) - P.countOpaque(b.img);
  check('effect ' + k + ' draws something', diff(a.img, a.img) === 0 && (a.img.w !== b.img.w || a.img.h !== b.img.h || extra !== 0), 'extra=' + extra);
});
check('effects stay animated (exhaust differs between frames)', diff(P.frame(body, {}, 0.1, { exhaust: true }).img, P.frame(body, {}, 0.5, { exhaust: true }).img) > 5);
const wf = P.wheelFrames(body, {}, 6, 1);
check('wheel strip has the right frames and size', wf.length === 6 && wf[0].w === body.wheels[0].r * 2 + 2 && wf[0].w === wf[0].h);
check('wheel frames differ from each other', diff(wf[0], wf[2]) > 5);

// ---- encoders ----
const E = require('./src/encoders.js');
fs.mkdirSync(outDir, { recursive: true });
const gifFrames = []; for (let i = 0; i < 6; i++) gifFrames.push(P.frame(body, {}, i / 6, { spin: 1, bob: true, exhaust: true, neon: true }).img);
const gifT = E.encodeGif(gifFrames, { delay: 8, transparent: true });
fs.writeFileSync(path.join(outDir, 'test_t.gif'), Buffer.from(gifT));
check('gif starts with GIF89a and ends with a trailer', Buffer.from(gifT.slice(0, 6)).toString() === 'GIF89a' && gifT[gifT.length - 1] === 0x3b, gifT.length + ' bytes');
const gifO = E.encodeGif(gifFrames, { delay: 8, transparent: false });
fs.writeFileSync(path.join(outDir, 'test_o.gif'), Buffer.from(gifO));
// a busy image that needs colour reduction
const busy = P.makeImage(64, 64); for (let i = 0; i < 64 * 64; i++) busy.data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4);
const gifB = E.encodeGif([busy, busy], { delay: 5, transparent: false });
fs.writeFileSync(path.join(outDir, 'test_busy.gif'), Buffer.from(gifB));
check('gif with more than 256 colours still encodes', gifB.length > 100);
const zip = E.zipStore([{ name: 'a.txt', data: E.utf8('olá mundo') }, { name: 'pasta/b.bin', data: Uint8Array.from([1, 2, 3, 4, 5]) }]);
fs.writeFileSync(path.join(outDir, 'test.zip'), Buffer.from(zip));
check('crc32 of "123456789" is cbf43926', E.crc32(E.utf8('123456789')).toString(16) === 'cbf43926');
check('zip has the local header signature', zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 3 && zip[3] === 4);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'test_styles.png'), png(P.render(prepared, { width: 128, colors: 10, wheelStyle: 'mesh', rimColor: 'gold', outlineMode: 'tint', hue: 150 }).img, 6, [112, 96, 128]));
fs.writeFileSync(path.join(outDir, 'test_source.png'), png(src, 1, [0, 0, 0]));
fs.writeFileSync(path.join(outDir, 'test_result.png'), png(img, 6, [112, 96, 128]));
fs.writeFileSync(path.join(outDir, 'test_result_dither0.png'), png(P.render(prepared, { width: 128, colors: 10, wheels: false, shine: false }).img, 6, [112, 96, 128]));
console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
