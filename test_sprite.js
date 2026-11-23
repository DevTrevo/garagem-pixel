// Testes da lógica do editor de sprites. Uso: node test_sprite.js
const S = require('./src/sprite.js');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };
const R = [255, 0, 0, 255], B = [0, 0, 255, 255];

let d = S.create(10, 8);
ok('create size', d.w === 10 && d.h === 8 && d.data.length === 320);
ok('clamp size', S.create(999, 0).w === 256 && S.create(999, 0).h === 1);
ok('set/get', S.set(d, 3, 2, R) && S.same(S.get(d, 3, 2), R));
ok('out of range', !S.set(d, 10, 0, R) && S.get(d, -1, 0) === null);

// linha: diagonal sem buracos, inclui extremos
let pts = []; S.line(0, 0, 9, 7, (x, y) => pts.push([x, y]));
ok('line endpoints', pts[0].join() === '0,0' && pts[pts.length - 1].join() === '9,7');
ok('line connected', pts.every((p, i) => i === 0 || (Math.abs(p[0] - pts[i - 1][0]) <= 1 && Math.abs(p[1] - pts[i - 1][1]) <= 1)));
pts = []; S.line(5, 5, 5, 5, (x, y) => pts.push([x, y])); ok('line single point', pts.length === 1);

// retângulo
let n = 0; S.rect(1, 1, 4, 3, true, () => n++); ok('rect fill count', n === 12);
n = 0; S.rect(4, 3, 1, 1, false, () => n++); ok('rect outline count (reversed corners)', n === 10);

// elipse: preenchida contém contorno; contorno tem centro vazio
let fillSet = new Set(), outSet = new Set();
S.ellipse(0, 0, 8, 6, true, (x, y) => fillSet.add(x + ',' + y));
S.ellipse(0, 0, 8, 6, false, (x, y) => outSet.add(x + ',' + y));
ok('ellipse outline ⊂ fill', [...outSet].every(k => fillSet.has(k)));
ok('ellipse outline hollow', !outSet.has('4,3') && fillSet.has('4,3'));

// balde: contíguo, não vaza por cima de parede
d = S.create(6, 6);
for (let y = 0; y < 6; y++) S.set(d, 3, y, B); // parede vertical
let filled = []; S.flood(d, 0, 0, (x, y) => filled.push([x, y]));
ok('flood stays left of wall', filled.length === 18 && filled.every(p => p[0] < 3), filled.length);
filled = []; S.flood(d, 3, 2, (x, y) => filled.push([x, y]));
ok('flood on wall fills wall only', filled.length === 6);
ok('flood out of range', S.flood(d, 9, 9, () => { throw new Error('x'); }) === 0);

// histórico por diferença
d = S.create(8, 8); const h = S.history(5), before = S.clone(d);
S.rect(0, 0, 3, 3, true, (x, y) => S.set(d, x, y, R));
const e = S.diff(before, d);
ok('diff counts changed pixels', e.idx.length === 16);
ok('diff of identical = null', S.diff(d, S.clone(d)) === null);
h.push(e);
ok('undo restores', h.back(d) && S.get(d, 1, 1)[3] === 0);
ok('redo reapplies', h.forward(d) && S.same(S.get(d, 1, 1), R));
h.back(d); S.set(d, 7, 7, B); h.push(S.diff(S.create(8, 8), d));
ok('new stroke clears redo', h.redo.length === 0);
for (let i = 0; i < 9; i++) { const b = S.clone(d); S.set(d, i % 8, 0, [i * 20, 1, 1, 255]); h.push(S.diff(b, d)); }
ok('history limit', h.undo.length === 5);
ok('undo on wrong size is refused', !S.applyEntry(S.create(4, 4), e, true));

// transformações
d = S.create(4, 2); S.set(d, 0, 0, R);
ok('flipH', S.same(S.get(S.flipH(d), 3, 0), R) && S.get(S.flipH(d), 0, 0)[3] === 0);
ok('flipV', S.same(S.get(S.flipV(d), 0, 1), R));
ok('shift', S.same(S.get(S.shift(d, 2, 1), 2, 1), R) && S.get(S.shift(d, 9, 0), 0, 0)[3] === 0);
const rs = S.resize(d, 6, 3); ok('resize keeps top-left', rs.w === 6 && rs.h === 3 && S.same(S.get(rs, 0, 0), R));
ok('resize crops', S.resize(d, 2, 1).w === 2);

// cores
ok('hex roundtrip', S.toHex(S.parseHex('#ef7d57')) === '#ef7d57');
ok('bad hex', S.parseHex('zz') === null && S.parseHex('#12345') === null);
d = S.create(3, 1); S.set(d, 0, 0, R); S.set(d, 1, 0, R); S.set(d, 2, 0, B);
const uc = S.usedColors(d); ok('usedColors by frequency', uc.length === 2 && uc[0].join() === '255,0,0');
ok('transparent write zeroes rgb', (() => { const t = S.create(1, 1); S.set(t, 0, 0, [9, 9, 9, 0]); return t.data.join() === '0,0,0,0'; })());
ok('fromImage crops big input', S.fromImage({ w: 300, h: 10, data: new Uint8ClampedArray(300 * 10 * 4) }).w === 256);
ok('palette is valid', S.SWEETIE.length === 16 && S.SWEETIE.every(c => S.parseHex(c)));
console.log(fails ? fails + ' FALHAS' : 'tudo certo'); process.exit(fails ? 1 : 0);
