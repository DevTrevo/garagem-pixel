/* Editor de sprites: lógica pura sobre { w, h, data: Uint8ClampedArray(RGBA) }.
   Roda no navegador e no Node (test_sprite.js). Sem DOM. */
(function (root) {
  'use strict';

  function create(w, h) {
    w = Math.max(1, Math.min(256, w | 0)); h = Math.max(1, Math.min(256, h | 0));
    return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  function clone(d) { return { w: d.w, h: d.h, data: new Uint8ClampedArray(d.data) }; }
  function fromImage(im) {
    var d = create(im.w, im.h);
    // imagens maiores que 256 não cabem: recorta no canto superior esquerdo
    for (var y = 0; y < d.h; y++) for (var x = 0; x < d.w; x++) {
      var si = (y * im.w + x) * 4, di = (y * d.w + x) * 4;
      d.data[di] = im.data[si]; d.data[di + 1] = im.data[si + 1]; d.data[di + 2] = im.data[si + 2]; d.data[di + 3] = im.data[si + 3];
    }
    return d;
  }
  function inside(d, x, y) { return x >= 0 && y >= 0 && x < d.w && y < d.h; }
  function get(d, x, y) {
    if (!inside(d, x, y)) return null;
    var i = (y * d.w + x) * 4;
    return [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]];
  }
  function set(d, x, y, c) {
    if (!inside(d, x, y)) return false;
    var i = (y * d.w + x) * 4, a = c.length > 3 ? c[3] : 255;
    d.data[i] = c[0]; d.data[i + 1] = c[1]; d.data[i + 2] = c[2]; d.data[i + 3] = a;
    if (a === 0) { d.data[i] = 0; d.data[i + 1] = 0; d.data[i + 2] = 0; }
    return true;
  }
  function same(a, b) {
    if (!a || !b) return false;
    if (a[3] === 0 && b[3] === 0) return true;
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  }

  // ---- formas (chamam cb(x, y) para cada pixel) ----
  function line(x0, y0, x1, y1, cb) {
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (;;) {
      cb(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function rect(x0, y0, x1, y1, fill, cb) {
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1), x, y;
    for (y = ay; y <= by; y++) for (x = ax; x <= bx; x++) {
      if (fill || x === ax || x === bx || y === ay || y === by) cb(x, y);
    }
  }
  // Elipse inscrita na caixa (x0,y0)-(x1,y1). Teste de pertinência por pixel, simples e sem buracos.
  function ellipse(x0, y0, x1, y1, fill, cb) {
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    var cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax + 1) / 2, ry = (by - ay + 1) / 2;
    function inE(x, y) { var u = (x - cx) / rx, v = (y - cy) / ry; return u * u + v * v <= 1; }
    for (var y = ay; y <= by; y++) for (var x = ax; x <= bx; x++) {
      if (!inE(x, y)) continue;
      if (fill || !inE(x - 1, y) || !inE(x + 1, y) || !inE(x, y - 1) || !inE(x, y + 1)) cb(x, y);
    }
  }
  // Balde: preenche a região contígua (4 vizinhos) com a mesma cor do pixel clicado.
  function flood(d, x, y, cb) {
    if (!inside(d, x, y)) return 0;
    var target = get(d, x, y), seen = new Uint8Array(d.w * d.h), stack = [y * d.w + x], n = 0;
    seen[stack[0]] = 1;
    while (stack.length) {
      var p = stack.pop(), px = p % d.w, py = (p / d.w) | 0;
      cb(px, py); n++;
      var nb = [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]];
      for (var k = 0; k < 4; k++) {
        var nx = nb[k][0], ny = nb[k][1];
        if (!inside(d, nx, ny)) continue;
        var q = ny * d.w + nx;
        if (seen[q]) continue;
        seen[q] = 1;
        if (same(get(d, nx, ny), target)) stack.push(q);
      }
    }
    return n;
  }

  // ---- transformações do desenho inteiro ----
  function flipH(d) {
    var o = create(d.w, d.h);
    for (var y = 0; y < d.h; y++) for (var x = 0; x < d.w; x++) set(o, d.w - 1 - x, y, get(d, x, y));
    return o;
  }
  function flipV(d) {
    var o = create(d.w, d.h);
    for (var y = 0; y < d.h; y++) for (var x = 0; x < d.w; x++) set(o, x, d.h - 1 - y, get(d, x, y));
    return o;
  }
  // Move o desenho dx, dy pixels (o que sai pela borda some, o que entra é transparente).
  function shift(d, dx, dy) {
    var o = create(d.w, d.h);
    for (var y = 0; y < d.h; y++) for (var x = 0; x < d.w; x++) {
      var c = get(d, x, y);
      if (c[3]) set(o, x + dx, y + dy, c);
    }
    return o;
  }
  // Muda o tamanho da tela mantendo o desenho no canto superior esquerdo.
  function resize(d, w, h) {
    var o = create(w, h);
    for (var y = 0; y < Math.min(h, d.h); y++) for (var x = 0; x < Math.min(w, d.w); x++) set(o, x, y, get(d, x, y));
    return o;
  }

  // ---- histórico por diferença: cada traço guarda só os pixels que mudaram ----
  function diff(before, after) {
    var idx = [], n = before.data.length;
    for (var i = 0; i < n; i += 4) {
      if (before.data[i] !== after.data[i] || before.data[i + 1] !== after.data[i + 1] ||
        before.data[i + 2] !== after.data[i + 2] || before.data[i + 3] !== after.data[i + 3]) idx.push(i);
    }
    if (!idx.length) return null;
    var e = { w: after.w, h: after.h, idx: new Int32Array(idx), old: new Uint8ClampedArray(idx.length * 4), nw: new Uint8ClampedArray(idx.length * 4) };
    for (var k = 0; k < idx.length; k++) for (var c = 0; c < 4; c++) { e.old[k * 4 + c] = before.data[idx[k] + c]; e.nw[k * 4 + c] = after.data[idx[k] + c]; }
    return e;
  }
  function applyEntry(d, e, useOld) {
    if (e.w !== d.w || e.h !== d.h) return false;
    var src = useOld ? e.old : e.nw;
    for (var k = 0; k < e.idx.length; k++) for (var c = 0; c < 4; c++) d.data[e.idx[k] + c] = src[k * 4 + c];
    return true;
  }
  function history(limit) {
    var h = { undo: [], redo: [], limit: limit || 100 };
    h.push = function (e) { if (!e) return; h.undo.push(e); h.redo.length = 0; while (h.undo.length > h.limit) h.undo.shift(); };
    h.back = function (d) { var e = h.undo.pop(); if (!e) return false; if (!applyEntry(d, e, true)) return false; h.redo.push(e); return true; };
    h.forward = function (d) { var e = h.redo.pop(); if (!e) return false; if (!applyEntry(d, e, false)) return false; h.undo.push(e); return true; };
    h.clear = function () { h.undo.length = 0; h.redo.length = 0; };
    return h;
  }

  // ---- cores ----
  function toHex(c) { return '#' + [c[0], c[1], c[2]].map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }
  function parseHex(s) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(s || '').trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Cores opacas usadas no desenho, das mais frequentes para as menos.
  function usedColors(d, max) {
    var count = new Map();
    for (var i = 0; i < d.data.length; i += 4) {
      if (d.data[i + 3] === 0) continue;
      var k = (d.data[i] << 16) | (d.data[i + 1] << 8) | d.data[i + 2];
      count.set(k, (count.get(k) || 0) + 1);
    }
    return Array.from(count.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, max || 32)
      .map(function (e) { return [(e[0] >> 16) & 255, (e[0] >> 8) & 255, e[0] & 255]; });
  }
  var SWEETIE = ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
    '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'];

  var api = {
    create: create, clone: clone, fromImage: fromImage, inside: inside, get: get, set: set, same: same,
    line: line, rect: rect, ellipse: ellipse, flood: flood, flipH: flipH, flipV: flipV, shift: shift, resize: resize,
    diff: diff, applyEntry: applyEntry, history: history, toHex: toHex, parseHex: parseHex, usedColors: usedColors, SWEETIE: SWEETIE
  };
  root.PixelSprite = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
