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



  // ================= Seleção (retângulo): copiar, recortar, colar, mover =================
  function normRect(x0, y0, x1, y1) { return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) }; }
  function clipRect(d, r) {
    var o = { x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(d.w - 1, r.x1), y1: Math.min(d.h - 1, r.y1) };
    return o.x1 < o.x0 || o.y1 < o.y0 ? null : o;
  }
  // Copia a região (já cortada pelos limites do desenho) para uma imagem solta.
  function extract(d, r) {
    var c = clipRect(d, r);
    if (!c) return null;
    var w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1, out = create(w, h);
    for (var y = 0; y < h; y++) out.data.set(d.data.subarray(((c.y0 + y) * d.w + c.x0) * 4, ((c.y0 + y) * d.w + c.x0 + w) * 4), y * w * 4);
    return out;
  }
  function clearRect(d, r) {
    var c = clipRect(d, r);
    if (!c) return 0;
    for (var y = c.y0; y <= c.y1; y++) d.data.fill(0, (y * d.w + c.x0) * 4, (y * d.w + c.x1 + 1) * 4);
    return (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
  }
  // Cola a imagem solta em (x, y); pixels transparentes não apagam nada; o que passa da borda é cortado.
  function blit(d, clip, x, y) {
    var n = 0;
    for (var cy = 0; cy < clip.h; cy++) for (var cx = 0; cx < clip.w; cx++) {
      var si = (cy * clip.w + cx) * 4;
      if (!clip.data[si + 3]) continue;
      if (set(d, x + cx, y + cy, [clip.data[si], clip.data[si + 1], clip.data[si + 2], clip.data[si + 3]])) n++;
    }
    return n;
  }
  // Espelha a região no lugar (horizontal ou vertical), dentro dos limites do desenho.
  function flipRect(d, r, vertical) {
    var c = clipRect(d, r);
    if (!c) return false;
    var clip = extract(d, c), f = vertical ? flipV(clip) : flipH(clip);
    clearRect(d, c);
    for (var y = 0; y < f.h; y++) for (var x = 0; x < f.w; x++) {
      var i = (y * f.w + x) * 4;
      if (f.data[i + 3]) set(d, c.x0 + x, c.y0 + y, [f.data[i], f.data[i + 1], f.data[i + 2], f.data[i + 3]]);
    }
    return true;
  }


  // Pegada do pincel: lista de [dx, dy] relativa ao pixel clicado (tamanho 1 a 8; quadrado ou redondo).
  function brush(size, round) {
    size = Math.max(1, Math.min(8, size | 0));
    var lo = -Math.floor((size - 1) / 2), c = (size - 1) / 2, out = [];
    for (var j = 0; j < size; j++) for (var i = 0; i < size; i++) {
      if (round && size > 2) { var dx = i - c, dy = j - c; if (dx * dx + dy * dy > (size / 2) * (size / 2) - 0.5) continue; }
      out.push([lo + i, lo + j]);
    }
    return out;
  }

  // ================= Projeto: camadas × frames =================
  // Uma camada vale para todos os frames; cada frame tem uma "cel" (imagem) por camada.
  function project(w, h) {
    w = Math.max(1, Math.min(256, w | 0)); h = Math.max(1, Math.min(256, h | 0));
    return { w: w, h: h, fps: 8, layers: [{ name: 'Camada 1', visible: true }], frames: [{ cels: [create(w, h)] }] };
  }
  function projectFromDoc(d) {
    var p = project(d.w, d.h); p.frames[0].cels[0] = clone(d); return p;
  }
  function cloneProject(p) {
    return {
      w: p.w, h: p.h, fps: p.fps,
      layers: p.layers.map(function (l) { return { name: l.name, visible: l.visible }; }),
      frames: p.frames.map(function (f) { return { cels: f.cels.map(clone) }; })
    };
  }
  function setProject(dst, src) { dst.w = src.w; dst.h = src.h; dst.fps = src.fps; dst.layers = src.layers; dst.frames = src.frames; }
  // Junta as camadas visíveis do frame (a de cima vence; mistura alfa normal).
  function composite(p, f) {
    var out = create(p.w, p.h), o = out.data, fr = p.frames[f];
    for (var l = 0; l < p.layers.length; l++) {
      if (!p.layers[l].visible) continue;
      var s = fr.cels[l].data;
      for (var i = 0; i < s.length; i += 4) {
        var sa = s[i + 3];
        if (!sa) continue;
        var da = o[i + 3];
        if (sa === 255 || !da) { o[i] = s[i]; o[i + 1] = s[i + 1]; o[i + 2] = s[i + 2]; o[i + 3] = sa; continue; }
        var a = sa / 255, ba = da / 255, ra = a + ba * (1 - a);
        o[i] = (s[i] * a + o[i] * ba * (1 - a)) / ra; o[i + 1] = (s[i + 1] * a + o[i + 1] * ba * (1 - a)) / ra;
        o[i + 2] = (s[i + 2] * a + o[i + 2] * ba * (1 - a)) / ra; o[i + 3] = ra * 255;
      }
    }
    return out;
  }
  function addLayer(p, at, name) {
    at = Math.max(0, Math.min(p.layers.length, at == null ? p.layers.length : at));
    p.layers.splice(at, 0, { name: name || 'Camada ' + (p.layers.length + 1), visible: true });
    p.frames.forEach(function (f) { f.cels.splice(at, 0, create(p.w, p.h)); });
    return at;
  }
  function dupLayer(p, l) {
    var at = addLayer(p, l + 1, p.layers[l].name + ' cópia');
    p.frames.forEach(function (f) { f.cels[at] = clone(f.cels[l]); });
    return at;
  }
  function removeLayer(p, l) {
    if (p.layers.length < 2 || l < 0 || l >= p.layers.length) return false;
    p.layers.splice(l, 1); p.frames.forEach(function (f) { f.cels.splice(l, 1); });
    return true;
  }
  function moveLayer(p, l, dir) {
    var n = l + dir;
    if (l < 0 || n < 0 || l >= p.layers.length || n >= p.layers.length) return -1;
    var a = p.layers[l]; p.layers[l] = p.layers[n]; p.layers[n] = a;
    p.frames.forEach(function (f) { var c = f.cels[l]; f.cels[l] = f.cels[n]; f.cels[n] = c; });
    return n;
  }
  // Junta a camada l com a de baixo (l-1); o resultado fica na de baixo.
  function mergeDown(p, l) {
    if (l < 1 || l >= p.layers.length) return false;
    p.frames.forEach(function (f) {
      var top = f.cels[l], bot = f.cels[l - 1];
      for (var i = 0; i < top.data.length; i += 4) if (top.data[i + 3] === 255) {
        bot.data[i] = top.data[i]; bot.data[i + 1] = top.data[i + 1]; bot.data[i + 2] = top.data[i + 2]; bot.data[i + 3] = 255;
      }
    });
    return removeLayer(p, l);
  }
  function addFrame(p, at, dup) {
    at = Math.max(0, Math.min(p.frames.length, at == null ? p.frames.length : at));
    var src = dup != null ? p.frames[dup] : null;
    p.frames.splice(at, 0, { cels: p.layers.map(function (_, l) { return src ? clone(src.cels[l]) : create(p.w, p.h); }) });
    return at;
  }
  function removeFrame(p, f) {
    if (p.frames.length < 2 || f < 0 || f >= p.frames.length) return false;
    p.frames.splice(f, 1); return true;
  }
  function moveFrame(p, f, dir) {
    var n = f + dir;
    if (f < 0 || n < 0 || f >= p.frames.length || n >= p.frames.length) return -1;
    var a = p.frames[f]; p.frames[f] = p.frames[n]; p.frames[n] = a; return n;
  }
  // Aplica uma transformação de imagem a todas as cels (espelhar, mover, mudar tamanho).
  function mapCels(p, fn, w, h) {
    p.frames.forEach(function (f) { f.cels = f.cels.map(fn); });
    if (w) { p.w = w; p.h = h; }
  }
  function frameImages(p) { return p.frames.map(function (_, f) { return composite(p, f); }); }
  // folha de frames lado a lado (sem o limite de 256 do desenho)
  function sheetImage(p) {
    var n = p.frames.length, w = p.w * n, out = { w: w, h: p.h, data: new Uint8ClampedArray(w * p.h * 4) };
    for (var f = 0; f < n; f++) {
      var c = composite(p, f);
      for (var y = 0; y < p.h; y++) out.data.set(c.data.subarray(y * p.w * 4, (y + 1) * p.w * 4), (y * w + f * p.w) * 4);
    }
    return out;
  }

  // Histórico do projeto: "px" = pixels de uma cel; "proj" = foto inteira antes/depois (mudanças de estrutura).
  function projHistory(limit) {
    var h = { undo: [], redo: [], limit: limit || 100 };
    function trim() { while (h.undo.length > h.limit) h.undo.shift(); }
    h.pushPx = function (f, l, e) { if (!e) return; h.undo.push({ k: 'px', f: f, l: l, e: e }); h.redo.length = 0; trim(); };
    h.pushProj = function (before, after) { h.undo.push({ k: 'proj', before: before, after: after }); h.redo.length = 0; trim(); };
    function run(p, en, back) {
      if (en.k === 'px') {
        var f = p.frames[en.f], c = f && f.cels[en.l];
        return !!c && applyEntry(c, en.e, back);
      }
      setProject(p, cloneProject(back ? en.before : en.after)); return true;
    }
    h.back = function (p) { var en = h.undo.pop(); if (!en) return null; if (!run(p, en, true)) return null; h.redo.push(en); return en; };
    h.forward = function (p) { var en = h.redo.pop(); if (!en) return null; if (!run(p, en, false)) return null; h.undo.push(en); return en; };
    h.clear = function () { h.undo.length = 0; h.redo.length = 0; };
    return h;
  }

  var api = {
    brush: brush,
    normRect: normRect, clipRect: clipRect, extract: extract, clearRect: clearRect, blit: blit, flipRect: flipRect,
    create: create, clone: clone, fromImage: fromImage, inside: inside, get: get, set: set, same: same,
    line: line, rect: rect, ellipse: ellipse, flood: flood, flipH: flipH, flipV: flipV, shift: shift, resize: resize,
    diff: diff, applyEntry: applyEntry, project: project, projectFromDoc: projectFromDoc, cloneProject: cloneProject, setProject: setProject, composite: composite, addLayer: addLayer, dupLayer: dupLayer, removeLayer: removeLayer, moveLayer: moveLayer, mergeDown: mergeDown, addFrame: addFrame, removeFrame: removeFrame, moveFrame: moveFrame, mapCels: mapCels, frameImages: frameImages, sheetImage: sheetImage, projHistory: projHistory, history: history, toHex: toHex, parseHex: parseHex, usedColors: usedColors, SWEETIE: SWEETIE
  };
  root.PixelSprite = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
