/* Modo "Racha de Rua": sprite de carro sem rodas, em tamanho fixo, para o jogo.
   Depende de PixelCar (pipeline.js). Roda no navegador e no Node. */
(function (root) {
  'use strict';
  var P = root.PixelCar || (typeof require !== 'undefined' ? require('./pipeline.js') : null);

  var WHEEL_R = 11, WELL_IN = 11.6, WELL_OUT = 13, CLEAR = 7, SHADOW_ROWS = 3;
  var WELL_COLOR = [11, 10, 20];

  // id, nome no jogo, inspiração, tamanho, [x,y] roda traseira, [x,y] roda dianteira
  var TABLE = [
    [0, 'Pocket 1.0', 'hatch popular 1.0 (Gol/Uno/Celta)', 132, 40, 25, 29, 103, 29],
    [1, 'Tigre Turbo', 'hatch esportivo (Gol GTI/Golf GTI)', 92, 48, 19, 37, 73, 37],
    [2, 'Zeta Sedan', 'sedan executivo (Omega/Vectra)', 108, 38, 21, 27, 87, 27],
    [3, 'Cobra Coupé', 'cupê RWD 6 cil. (Nissan 350Z)', 104, 34, 21, 23, 83, 23],
    [4, 'Vulcão V8', 'muscle car (Charger/Opala V8)', 112, 36, 23, 23, 91, 23],
    [5, 'Trovão 4x4', 'picape V8 (F-250/Silverado)', 120, 44, 23, 31, 99, 31],
    [6, 'Fênix RS', 'esportivo leve (Porsche 911 GT3)', 108, 40, 23, 29, 87, 29],
    [7, 'Lince GT', 'supercarro AWD (Audi R8)', 112, 40, 23, 29, 91, 29],
    [8, 'Fusca Turbo', 'VW Fusca', 124, 48, 25, 37, 97, 37],
    [9, 'Kombi 1.6', 'VW Kombi', 100, 42, 19, 31, 81, 31],
    [12, 'Pônei GT', 'Ford Mustang', 112, 36, 21, 25, 91, 25],
    [13, 'Rotor RX', 'Mazda RX-7', 96, 44, 19, 33, 77, 33],
    [14, 'Bavária 325', 'BMW 325i', 130, 42, 29, 31, 103, 31],
    [15, 'Civico Si', 'Honda Civic Si', 132, 40, 25, 29, 103, 29],
    [16, 'Civico RR', 'Honda Civic Type R', 130, 46, 25, 35, 103, 35],
    [17, 'Sombra GTI', 'VW Golf GTI/R preto', 130, 46, 25, 35, 103, 35],
    [18, 'Suprema RZ', 'Toyota Supra RZ', 130, 42, 29, 31, 103, 31],
    [19, 'Horizonte GTR', 'Nissan Skyline GT-R', 130, 42, 29, 31, 103, 31],
    [20, 'Noturno Coupé', 'cupê V6 (Mitsubishi Eclipse V6)', 130, 42, 29, 31, 103, 31]
  ];

  function slug(name) {
    return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  var CARS = TABLE.map(function (r) {
    var id = (r[0] < 10 ? '0' : '') + r[0];
    var ground = Math.min(r[4], Math.max(r[6], r[8]) + WHEEL_R);
    return {
      ground: ground, groundGap: r[4] - ground,
      num: r[0], id: id, name: r[1], ref: r[2], w: r[3], h: r[4], rear: [r[5], r[6]], front: [r[7], r[8]],
      file: 'carro-' + id + '-' + slug(r[1]) + '.png'
    };
  });
  function carById(id) {
    for (var i = 0; i < CARS.length; i++) if (CARS[i].id === String(id)) return CARS[i];
    return null;
  }

  var DEFAULTS = {
    colors: 14, sat: 1.15, contrast: 1.1, hue: 0, sharpen: 0.25, clean: 1, rimlight: 0.7, shine: true,
    rearX: 0.22, frontX: 0.79, wheelR: 0.075, bodyDY: 0, bodyScaleY: 100, outline: true
  };

  function opaqueAt(img, x, y) { return x >= 0 && y >= 0 && x < img.w && y < img.h && img.data[(y * img.w + x) * 4 + 3] > 0; }
  function colsOf(img, x0, x1) {
    x0 = Math.max(0, Math.min(img.w - 1, x0)); x1 = Math.max(x0 + 1, Math.min(img.w, x1));
    var w = x1 - x0, out = P.makeImage(w, img.h);
    for (var y = 0; y < img.h; y++) out.data.set(img.data.subarray((y * img.w + x0) * 4, (y * img.w + x1) * 4), y * w * 4);
    return out;
  }

  // Redimensiona a foto em três faixas: atrás da roda traseira, entre as rodas, na frente da roda dianteira.
  // Assim as rodas da foto caem exatamente nos centros da tabela e o carro inteiro cabe na largura.
  // Devolve a imagem W x H e quantos pixels opacos ficaram fora do quadro.
  function place(src, car, o) {
    var W = car.w, H = car.h, out = P.makeImage(W, H), clip = { top: 0, bottom: 0, left: 0, right: 0 };
    var sw = src.w, sh = src.h;
    var rp = Math.round(o.rearX * sw), fp = Math.round(o.frontX * sw);
    rp = Math.max(1, Math.min(sw - 3, rp)); fp = Math.max(rp + 1, Math.min(sw - 1, fp));
    var rt = car.rear[0], ft = car.front[0];
    var G = car.ground, destH = Math.max(2, Math.min(G, Math.round((G - 1) * (o.bodyScaleY / 100))));
    var lift = Math.round(o.bodyDY || 0);
    var segs = [[0, rp, 0, rt], [rp, fp, rt, ft], [fp, sw, ft, W]];
    segs.forEach(function (s) {
      var dw = s[3] - s[2];
      if (dw < 1 || s[1] - s[0] < 1) return;
      var part = P.resizeArea(colsOf(src, s[0], s[1]), dw, destH);
      var top = G - destH - lift;
      for (var y = 0; y < part.h; y++) for (var x = 0; x < part.w; x++) {
        var i = (y * part.w + x) * 4;
        if (part.data[i + 3] === 0) continue;
        var dy = top + y;
        if (dy < 0) { clip.top++; continue; }
        if (dy >= H) { clip.bottom++; continue; }
        var j = (dy * W + s[2] + x) * 4;
        out.data[j] = part.data[i]; out.data[j + 1] = part.data[i + 1]; out.data[j + 2] = part.data[i + 2]; out.data[j + 3] = 255;
      }
    });
    return { img: out, clip: clip, top: G - destH - lift, destH: destH };
  }

  // Estimativa do raio real da roda na foto: o corte da silhueta abaixo da linha do assoalho é uma corda do círculo.
  function photoWheels(src, o) {
    var w = src.w, h = src.h, d = src.data, bottom = new Int32Array(w).fill(-1), x, y, mids = [];
    for (x = 0; x < w; x++) for (y = h - 1; y >= 0; y--) if (d[(y * w + x) * 4 + 3] > 0) { bottom[x] = y; break; }
    var a = Math.round(o.rearX * w), b = Math.round(o.frontX * w);
    for (x = Math.round(a + (b - a) * 0.3); x <= Math.round(a + (b - a) * 0.7); x++) if (x >= 0 && x < w && bottom[x] >= 0) mids.push(bottom[x]);
    mids.sort(function (p, q) { return p - q; });
    var yb = mids.length ? mids[mids.length >> 1] : h * 0.8, hd = Math.max(1, h - 1 - yb), c = o.wheelR * w;
    var r = (c * c + hd * hd) / (2 * hd);
    return { r: Math.max(0.055 * w, Math.min(0.095 * w, r)), yb: yb };
  }

  var D2 = Math.PI / 180;
  function hueDelta(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }
  function isPaintHsl(c, dom) { return c[1] >= 0.22 && c[2] >= 0.06 && c[2] <= 0.93 && hueDelta(c[0], dom) <= 35; }

  // Lataria em um só matiz: acha a cor dominante da pintura, fixa o matiz e a saturação e deixa só a luminosidade variar.
  // O resto (vidro, cromado, borracha, farol) fica em matiz diferente ou pouco saturado.
  function separatePaint(img) {
    var d = img.data, bins = new Float64Array(36), i, c;
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      c = P.rgb2hsl(d[i], d[i + 1], d[i + 2]);
      if (c[1] < 0.28 || c[2] < 0.12 || c[2] > 0.88) continue;
      bins[Math.floor(c[0] / 10) % 36] += c[1] * (1 - Math.abs(2 * c[2] - 1));
    }
    var best = 0, bv = -1;
    for (var b = 0; b < 36; b++) {
      var v = bins[b] + 0.5 * (bins[(b + 35) % 36] + bins[(b + 1) % 36]);
      if (v > bv) { bv = v; best = b; }
    }
    var out = P.cloneImage(img), o = out.data;
    if (bv < 3) return { img: out, hue: null, sat: 0 };
    var dom = best * 10 + 5, sSum = 0, n = 0;
    // refina o matiz com a média circular dos pixels de pintura
    var sx = 0, sy = 0;
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      c = P.rgb2hsl(d[i], d[i + 1], d[i + 2]);
      if (!isPaintHsl(c, dom)) continue;
      sx += Math.cos(c[0] * D2) * c[1]; sy += Math.sin(c[0] * D2) * c[1]; sSum += c[1]; n++;
    }
    if (n) dom = (Math.atan2(sy, sx) / D2 + 360) % 360;
    var sat = Math.max(0.5, Math.min(0.92, n ? sSum / n : 0.6));
    var glassHue = hueDelta(215, dom) > 50 ? 215 : -1;
    for (i = 0; i < o.length; i += 4) {
      if (o[i + 3] === 0) continue;
      c = P.rgb2hsl(o[i], o[i + 1], o[i + 2]);
      var rgb;
      if (isPaintHsl(c, dom)) {
        rgb = P.hsl2rgb(dom, sat, c[2]);
      } else if (c[1] > 0.18 && hueDelta(c[0], dom) <= 55) {
        rgb = P.hsl2rgb(c[0], Math.min(c[1], 0.12), c[2]);
      } else if (c[2] < 0.32 && glassHue >= 0) {
        rgb = P.hsl2rgb(glassHue, Math.max(c[1], 0.3), c[2]);
      } else continue;
      o[i] = Math.round(rgb[0]); o[i + 1] = Math.round(rgb[1]); o[i + 2] = Math.round(rgb[2]);
    }
    return { img: out, hue: dom, sat: sat };
  }

  function paintReport(img, hue) {
    var d = img.data, tones = {}, other = {}, maxDev = 0, i, c, nTone = 0, nOther = 0, offenders = 0;
    if (hue == null) return { hue: null, tones: 0, other: 0, maxDev: 0, offenders: 0 };
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      c = P.rgb2hsl(d[i], d[i + 1], d[i + 2]);
      var key = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
      if (isPaintHsl(c, hue)) {
        if (!tones[key]) { tones[key] = 1; nTone++; }
        if (c[2] >= 0.1) maxDev = Math.max(maxDev, hueDelta(c[0], hue));
      } else {
        if (!other[key]) { other[key] = 1; nOther++; }
        if (c[1] > 0.25 && c[2] > 0.12 && hueDelta(c[0], hue) <= 35) offenders++;
      }
    }
    return { hue: hue, tones: nTone, other: nOther, maxDev: maxDev, offenders: offenders };
  }

  function uniqueColors(img) {
    var seen = {}, list = [], d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
      if (!seen[k]) { seen[k] = 1; list.push([d[i], d[i + 1], d[i + 2]]); }
    }
    list.sort(function (a, b) { return P.luma(a[0], a[1], a[2]) - P.luma(b[0], b[1], b[2]); });
    return list;
  }

  // Contorno de 1 px dentro da silhueta: o pixel da borda vira uma versão escurecida da própria cor (nunca preto puro).
  function outlineInside(img) {
    var out = P.cloneImage(img), d = img.data, o = out.data, w = img.w, h = img.h, cache = {};
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      var edge = !opaqueAt(img, x - 1, y) || !opaqueAt(img, x + 1, y) || !opaqueAt(img, x, y - 1) || (y < h - 1 && !opaqueAt(img, x, y + 1));
      if (!edge) continue;
      var k = d[i] + ',' + d[i + 1] + ',' + d[i + 2], c = cache[k];
      if (!c) {
        var hs = P.rgb2hsl(d[i], d[i + 1], d[i + 2]), rgb = P.hsl2rgb(hs[0], hs[1], Math.max(0.07, hs[2] * 0.42));
        c = [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])];
        cache[k] = c;
      }
      o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2];
    }
    return out;
  }

  // Faz o sprite do jogo a partir da foto já sem fundo (resultado de PixelCar.prepare).
  function render(prepared, car, opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (opts || {})) if (opts[k] !== undefined) o[k] = opts[k];
    var W = car.w, H = car.h, wheels = [car.rear, car.front];
    var src = prepared.img;
    // rodas da foto: dentro do círculo da roda, a parte que sai abaixo do assoalho some e o resto vira sombra da caixa de roda
    // (isso é feito na foto, antes de encaixar, para que subir ou descer a carroceria não leve pedaços de roda junto)
    var pw = photoWheels(src, o), rE = pw.r;
    var work = P.cloneImage(src), mask = P.cloneImage(src), x, y, i;
    for (i = 0; i < mask.data.length; i += 4) { mask.data[i] = 0; mask.data[i + 1] = 0; mask.data[i + 2] = 0; }
    [o.rearX, o.frontX].forEach(function (frac) {
      var cx = frac * src.w, cy = src.h - rE;
      for (y = Math.max(0, Math.floor(cy - rE - 1)); y < src.h; y++) for (x = Math.max(0, Math.floor(cx - rE - 1)); x < Math.min(src.w, Math.ceil(cx + rE + 1)); x++) {
        var j = (y * src.w + x) * 4;
        if (work.data[j + 3] === 0 || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rE * 1.03) continue;
        if (y > pw.yb) { work.data[j + 3] = 0; mask.data[j + 3] = 0; continue; }
        work.data[j] = WELL_COLOR[0]; work.data[j + 1] = WELL_COLOR[1]; work.data[j + 2] = WELL_COLOR[2];
        mask.data[j] = 255; mask.data[j + 1] = 255; mask.data[j + 2] = 255;
      }
    });
    var pl = place(work, car, o), img = pl.img, d = img.data, pm = place(mask, car, o).img;
    var fixed = new Uint8Array(W * H);
    wheels.forEach(function (wh) {
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        var p = y * W + x;
        if (d[p * 4 + 3] === 0) continue;
        var dd = Math.hypot(x + 0.5 - wh[0], y + 0.5 - wh[1]);
        if (dd < WELL_IN) { d[p * 4 + 3] = 0; continue; }
        if (dd > WELL_OUT && pm.data[p * 4] > 127) fixed[p] = 1;
      }
    });
    // folga mínima do assoalho entre as rodas
    var from = wheels[0][0] + WELL_OUT, to = wheels[1][0] - WELL_OUT, trimmed = 0;
    for (y = car.ground - CLEAR; y < H; y++) for (x = Math.ceil(from); x < to; x++) {
      if (d[(y * W + x) * 4 + 3] > 0) { d[(y * W + x) * 4 + 3] = 0; trimmed++; }
    }
    // sombra de contato: nas últimas linhas, fora das rodas, a foto costuma trazer uma faixa escura do chão colada nos para-choques
    for (y = Math.max(0, car.ground - SHADOW_ROWS); y < H; y++) for (x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] === 0) continue;
      var nearWheel = wheels.some(function (wh) { return Math.hypot(x + 0.5 - wh[0], y + 0.5 - wh[1]) <= WELL_OUT; });
      if (!nearWheel) { d[(y * W + x) * 4 + 3] = 0; trimmed++; }
    }
    // cor: ajustes, matiz único da lataria, brilhos, luz de cima
    var tuned = P.hueShift(P.adjustColors(img, o.sat, o.contrast), o.hue);
    if (o.sharpen) tuned = P.sharpen(tuned, o.sharpen);
    var q = P.quantize(tuned, o.colors, 0), cur = q.img;
    if (o.clean) cur = P.cleanPixels(cur, o.clean);
    var sp = separatePaint(cur);
    cur = sp.img;
    var pal = uniqueColors(cur);
    if (o.shine) {
      // reflexo só em tons de vidro: nunca na cor da pintura
      var glassPal = pal.filter(function (c) { return sp.hue == null || !isPaintHsl(P.rgb2hsl(c[0], c[1], c[2]), sp.hue); });
      glassPal.push([104, 132, 176], [150, 180, 216]);
      cur = P.addGlassShine(cur, glassPal);
    }
    if (o.rimlight) cur = P.addRimLight(cur, pal, o.rimlight);
    if (o.outline) cur = outlineInside(cur);
    // caixas de roda: anel escuro entre 11,6 e 13 px, vazio por dentro
    d = cur.data;
    wheels.forEach(function (wh) {
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        var p = y * W + x, dd = Math.hypot(x + 0.5 - wh[0], y + 0.5 - wh[1]);
        if (dd < WELL_IN) { d[p * 4 + 3] = 0; continue; }
        if (d[p * 4 + 3] > 0 && (dd <= WELL_OUT || fixed[p])) { d[p * 4] = WELL_COLOR[0]; d[p * 4 + 1] = WELL_COLOR[1]; d[p * 4 + 2] = WELL_COLOR[2]; }
      }
    });
    var palette = uniqueColors(cur);
    var report = paintReport(cur, sp.hue);
    var res = { img: cur, car: car, palette: palette, clip: pl.clip, trimmed: trimmed, paint: report, opts: o };
    res.checks = check(res);
    return res;
  }

  // Conferência antes de exportar. Cada item: { id, level: 'ok' | 'warn' | 'info', text }.
  function check(res) {
    var img = res.img, car = res.car, list = [], W = img.w, H = img.h, d = img.data, x, y;
    var sizeOk = W === car.w && H === car.h;
    list.push({ id: 'size', level: sizeOk ? 'ok' : 'warn', text: sizeOk ? 'Tamanho ' + W + ' × ' + H + ' bate com a tabela.' : 'Tamanho ' + W + ' × ' + H + ' não bate com a tabela (' + car.w + ' × ' + car.h + ').' });
    var inside = 0;
    [car.rear, car.front].forEach(function (wh) {
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 0 && Math.hypot(x + 0.5 - wh[0], y + 0.5 - wh[1]) < WELL_IN) inside++;
      }
    });
    list.push({ id: 'wells', level: inside ? 'warn' : 'ok', text: inside ? inside + ' pixel(s) opacos dentro do círculo das rodas (raio 11,6).' : 'Caixas de roda vazias dentro do raio 11,6.' });
    var semi = 0, corners = [0, W - 1, (H - 1) * W, (H - 1) * W + W - 1], opaqueN = 0;
    for (var i = 0; i < W * H; i++) { var a = d[i * 4 + 3]; if (a > 0 && a < 255) semi++; if (a > 0) opaqueN++; }
    var cornerOpaque = corners.some(function (c) { return d[c * 4 + 3] > 0; });
    var bgOk = !semi && !cornerOpaque && opaqueN < W * H * 0.85;
    list.push({ id: 'bg', level: bgOk ? 'ok' : 'warn', text: bgOk ? 'Fundo 100% transparente, sem meio-transparência.' : 'O fundo não está 100% transparente (' + (semi ? semi + ' pixels semitransparentes' : 'cantos ocupados') + ').' });
    var out = res.clip.bottom, side = res.clip.top + res.clip.left + res.clip.right;
    if (out) list.push({ id: 'floor', level: 'warn', text: 'A carroceria passa da última linha (' + out + ' px cortados). Suba o carro.' });
    else list.push({ id: 'floor', level: 'ok', text: 'A carroceria não passa da última linha.' });
    if (side) list.push({ id: 'frame', level: 'warn', text: 'A carroceria sai do quadro por cima (' + side + ' px cortados). Reduza a altura do carro.' });
    var low = 0;
    for (y = car.ground - CLEAR; y < H; y++) for (x = Math.ceil(car.rear[0] + WELL_OUT); x < car.front[0] - WELL_OUT; x++) if (d[(y * W + x) * 4 + 3] > 0) low++;
    list.push({ id: 'clear', level: low ? 'warn' : 'ok', text: low ? 'A carroceria desce abaixo de 7 px do chão entre as rodas.' : 'Folga de 7 px do chão entre as rodas.' + (res.trimmed ? ' (' + res.trimmed + ' px do assoalho foram aparados.)' : '') });
    if (res.edited) list.push({ id: 'edits', level: 'info', text: res.edited + ' pixel(s) retocado(s) à mão.' });
    var pr = res.paint;
    if (pr.hue == null) list.push({ id: 'paint', level: 'info', text: 'Lataria neutra (cinza, preto ou branco): não há matiz para separar.' });
    else list.push({ id: 'paint', level: pr.offenders ? 'warn' : 'ok', text: 'Lataria em um só matiz (' + Math.round(pr.hue) + '°) com ' + pr.tones + ' tons.' + (pr.offenders ? ' ' + pr.offenders + ' pixels de outras partes têm matiz parecido.' : ' Vidros, cromados e luzes ficam fora desse matiz.') });
    return list;
  }

  // Retoques à mão: lista de [x, y, r, g, b, a]. a = 0 apaga o pixel. O último retoque de cada pixel vale.
  // Reavalia paleta, lataria e conferência, então pintar dentro da roda, por exemplo, aparece como aviso.
  function applyEdits(base, edits) {
    var img = P.cloneImage(base.img), n = 0;
    (edits || []).forEach(function (e) {
      var x = e[0], y = e[1];
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
      var i = (y * img.w + x) * 4;
      if (e[5] === 0) { img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3] = 0; }
      else { img.data[i] = e[2]; img.data[i + 1] = e[3]; img.data[i + 2] = e[4]; img.data[i + 3] = 255; }
      n++;
    });
    var res = { img: img, car: base.car, palette: uniqueColors(img), clip: base.clip, trimmed: base.trimmed,
      paint: paintReport(img, base.paint.hue), opts: base.opts, edited: n };
    res.checks = check(res);
    return res;
  }

  var api = { applyEdits: applyEdits, uniqueColors: uniqueColors, CARS: CARS, carById: carById, slug: slug, render: render, check: check, place: place, separatePaint: separatePaint,
    DEFAULTS: DEFAULTS, WHEEL_R: WHEEL_R, WELL_IN: WELL_IN, WELL_OUT: WELL_OUT, CLEAR: CLEAR, WELL_COLOR: WELL_COLOR };
  if (root.PixelCar) root.PixelCar.Racha = api;
  root.PixelRacha = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
