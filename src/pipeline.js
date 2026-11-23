/* Pixel Car pipeline: pure functions on { w, h, data: Uint8ClampedArray(RGBA) }.
   Runs in the browser and in Node (used by test_pipeline.js). */
(function (root) {
  'use strict';

  function makeImage(w, h) { return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) }; }
  function cloneImage(img) { return { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) }; }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function luma(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  // "Redmean" colour distance, roughly 0..765. Close to what the eye sees.
  function dist(r1, g1, b1, r2, g2, b2) {
    var rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
  }

  function borderColor(img) {
    var w = img.w, h = img.h, d = img.data, rs = [], gs = [], bs = [];
    function push(x, y) {
      var i = (y * w + x) * 4;
      if (d[i + 3] > 0) { rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); }
    }
    var x, y;
    for (x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (y = 1; y < h - 1; y++) { push(0, y); push(w - 1, y); }
    function med(a) { a.sort(function (p, q) { return p - q; }); return a.length ? a[a.length >> 1] : 255; }
    return [med(rs), med(gs), med(bs)];
  }

  // Colours that stand for "background": the overall border median, plus the median of any
  // single side that is mostly one colour (e.g. sky on top, road along the bottom).
  function backgroundSeeds(img, tol) {
    var w = img.w, h = img.h, d = img.data;
    var seeds = [borderColor(img)];
    var sides = [[], [], [], []], x, y;
    for (x = 0; x < w; x++) { sides[0].push(x); sides[1].push((h - 1) * w + x); }
    for (y = 0; y < h; y++) { sides[2].push(y * w); sides[3].push(y * w + w - 1); }
    sides.forEach(function (idx) {
      var rs = [], gs = [], bs = [];
      idx.forEach(function (p) {
        var i = p * 4;
        if (d[i + 3] > 0) { rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); }
      });
      if (rs.length < 4) return;
      function med(a) { return a.slice().sort(function (p, q) { return p - q; })[a.length >> 1]; }
      var m = [med(rs), med(gs), med(bs)], near = 0;
      for (var k = 0; k < rs.length; k++) if (dist(rs[k], gs[k], bs[k], m[0], m[1], m[2]) <= tol * 1.5) near++;
      if (near / rs.length < 0.6) return;
      for (var s = 0; s < seeds.length; s++) {
        if (dist(m[0], m[1], m[2], seeds[s][0], seeds[s][1], seeds[s][2]) <= tol * 0.5) return;
      }
      seeds.push(m);
    });
    return seeds;
  }

  // Flood fill from the borders. A pixel joins the background when it is close to a
  // background seed, or close to the neighbour it was reached from (handles soft gradients).
  function removeBackground(img, opts) {
    opts = opts || {};
    var tol = opts.tol == null ? 40 : opts.tol;
    var seeds = opts.seed ? [opts.seed] : backgroundSeeds(img, tol);
    var bg = seeds[0];
    var w = img.w, h = img.h;
    var out = cloneImage(img), d = out.data;
    var removed = new Uint8Array(w * h);
    var queue = new Int32Array(w * h), qh = 0, qt = 0;
    var x, y;

    function bgDist(i) {
      var best = Infinity;
      for (var s = 0; s < seeds.length; s++) {
        var v = dist(d[i], d[i + 1], d[i + 2], seeds[s][0], seeds[s][1], seeds[s][2]);
        if (v < best) best = v;
      }
      return best;
    }
    function tryStart(p) {
      if (removed[p]) return;
      if (bgDist(p * 4) <= tol * 1.5) { removed[p] = 1; queue[qt++] = p; }
    }
    for (x = 0; x < w; x++) { tryStart(x); tryStart((h - 1) * w + x); }
    for (y = 0; y < h; y++) { tryStart(y * w); tryStart(y * w + w - 1); }

    var DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
    while (qh < qt) {
      var p = queue[qh++], px = p % w, py = (p / w) | 0, i = p * 4;
      for (var k = 0; k < 4; k++) {
        var nx = px + DX[k], ny = py + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var q = ny * w + nx;
        if (removed[q]) continue;
        var j = q * 4;
        var dbg = bgDist(j);
        var dn = dist(d[j], d[j + 1], d[j + 2], d[i], d[i + 1], d[i + 2]);
        if (dbg <= tol || (dn <= tol * 0.3 && dbg <= tol * 2)) { removed[q] = 1; queue[qt++] = q; }
      }
    }
    for (var m = 0; m < w * h; m++) if (removed[m]) d[m * 4 + 3] = 0;
    return { img: out, bg: bg };
  }

  function countOpaque(img) {
    var n = 0, d = img.data;
    for (var i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  }

  // Keeps only the biggest connected blob (8-neighbour). Removes specks and leftovers.
  function keepLargestComponent(img) {
    var w = img.w, h = img.h, d = img.data;
    var label = new Int32Array(w * h), stack = new Int32Array(w * h);
    var id = 0, best = 0, bestId = 0;
    for (var s = 0; s < w * h; s++) {
      if (d[s * 4 + 3] === 0 || label[s]) continue;
      id++;
      var sp = 0, count = 0;
      stack[sp++] = s; label[s] = id;
      while (sp > 0) {
        var p = stack[--sp], px = p % w, py = (p / w) | 0;
        count++;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var nx = px + dx, ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            var q = ny * w + nx;
            if (label[q] || d[q * 4 + 3] === 0) continue;
            label[q] = id; stack[sp++] = q;
          }
        }
      }
      if (count > best) { best = count; bestId = id; }
    }
    var out = cloneImage(img), o = out.data;
    for (var m = 0; m < w * h; m++) if (label[m] !== bestId) o[m * 4 + 3] = 0;
    return out;
  }

  function cropToContent(img) {
    var w = img.w, h = img.h, d = img.data;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return cloneImage(img);
    var cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = makeImage(cw, ch);
    for (var yy = 0; yy < ch; yy++) {
      for (var xx = 0; xx < cw; xx++) {
        var si = ((y0 + yy) * w + (x0 + xx)) * 4, di = (yy * cw + xx) * 4;
        out.data[di] = d[si]; out.data[di + 1] = d[si + 1]; out.data[di + 2] = d[si + 2]; out.data[di + 3] = d[si + 3];
      }
    }
    return out;
  }

  function flipH(img) {
    var w = img.w, h = img.h, out = makeImage(w, h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var si = (y * w + x) * 4, di = (y * w + (w - 1 - x)) * 4;
        out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1];
        out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = img.data[si + 3];
      }
    }
    return out;
  }

  // Area-average resize (alpha weighted). Alpha is thresholded to 0/255 afterwards.
  function resizeArea(img, outW, outH) {
    var w = img.w, h = img.h, d = img.data;
    outW = Math.max(1, Math.round(outW));
    outH = Math.max(1, Math.round(outH || (h * outW / w)));
    var out = makeImage(outW, outH), o = out.data;
    var sx = w / outW, sy = h / outH;
    for (var oy = 0; oy < outH; oy++) {
      var y0 = oy * sy, y1 = (oy + 1) * sy;
      for (var ox = 0; ox < outW; ox++) {
        var x0 = ox * sx, x1 = (ox + 1) * sx;
        var sr = 0, sg = 0, sb = 0, sa = 0, sw = 0;
        for (var yy = Math.floor(y0); yy < Math.ceil(y1) && yy < h; yy++) {
          var wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          for (var xx = Math.floor(x0); xx < Math.ceil(x1) && xx < w; xx++) {
            var wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
            var wgt = wx * wy, i = (yy * w + xx) * 4, a = d[i + 3] / 255;
            sw += wgt; sa += a * wgt * 1;
            sr += d[i] * a * wgt; sg += d[i + 1] * a * wgt; sb += d[i + 2] * a * wgt;
          }
        }
        var oi = (oy * outW + ox) * 4;
        if (sa > 0) { o[oi] = sr / sa; o[oi + 1] = sg / sa; o[oi + 2] = sb / sa; }
        o[oi + 3] = sw > 0 && sa / sw >= 0.5 ? 255 : 0;
      }
    }
    return out;
  }

  function adjustColors(img, sat, contrast) {
    var out = cloneImage(img), d = out.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2], l = luma(r, g, b);
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
      r = (r - 128) * contrast + 128; g = (g - 128) * contrast + 128; b = (b - 128) * contrast + 128;
      d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
    }
    return out;
  }

  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d > 0) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function f(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }

  // Rotates the hue of the paint only. The dominant saturated hue is taken as "the paint" and only
  // colours close to it move, so tinted glass, tyres, lights and greys stay as they are.
  function hueShift(img, deg) {
    var out = cloneImage(img), d = out.data, i, bins = new Float64Array(36);
    if (!deg) return out;
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var hsl = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      if (hsl[1] < 0.22 || hsl[2] < 0.1 || hsl[2] > 0.92) continue;
      bins[Math.floor(hsl[0] / 10) % 36] += hsl[1];
    }
    var bestBin = 0, bestVal = -1;
    for (var b = 0; b < 36; b++) {
      var v = bins[b] + 0.5 * (bins[(b + 35) % 36] + bins[(b + 1) % 36]);
      if (v > bestVal) { bestVal = v; bestBin = b; }
    }
    if (bestVal <= 0) return out;
    var dom = bestBin * 10 + 5;
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var c0 = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      if (c0[1] < 0.22 || c0[2] < 0.1 || c0[2] > 0.92) continue;
      var dh = Math.abs(((c0[0] - dom + 540) % 360) - 180);
      if (dh > 40) continue;
      var c = hsl2rgb(c0[0] + deg, c0[1], c0[2]);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    return out;
  }

  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // Weighted k-means over a 5-bit colour histogram, then nearest-colour mapping
  // (optionally with ordered Bayer dithering).
  function quantize(img, n, ditherStrength) {
    var w = img.w, h = img.h, d = img.data;
    var hist = new Map(), i, j;
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      var e = hist.get(key);
      if (!e) { e = { r: 0, g: 0, b: 0, c: 0 }; hist.set(key, e); }
      e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; e.c++;
    }
    var pts = [];
    hist.forEach(function (e) { pts.push({ r: e.r / e.c, g: e.g / e.c, b: e.b / e.c, c: e.c }); });
    if (!pts.length) return { img: cloneImage(img), palette: [] };

    var k = Math.max(1, Math.min(n, pts.length));
    var first = pts[0];
    for (j = 1; j < pts.length; j++) if (pts[j].c > first.c) first = pts[j];
    var cent = [[first.r, first.g, first.b]];
    var mind = new Float64Array(pts.length).fill(Infinity);
    while (cent.length < k) {
      var last = cent[cent.length - 1], bi = 0, bv = -1;
      for (j = 0; j < pts.length; j++) {
        var dr = pts[j].r - last[0], dg = pts[j].g - last[1], db = pts[j].b - last[2];
        var dd = dr * dr + dg * dg + db * db;
        if (dd < mind[j]) mind[j] = dd;
        var v = mind[j] * Math.sqrt(pts[j].c);
        if (v > bv) { bv = v; bi = j; }
      }
      cent.push([pts[bi].r, pts[bi].g, pts[bi].b]);
    }
    for (var iter = 0; iter < 12; iter++) {
      var sums = [];
      for (j = 0; j < k; j++) sums.push([0, 0, 0, 0]);
      for (j = 0; j < pts.length; j++) {
        var best = 0, bd = Infinity;
        for (var c = 0; c < k; c++) {
          var ar = pts[j].r - cent[c][0], ag = pts[j].g - cent[c][1], ab = pts[j].b - cent[c][2];
          var ad = ar * ar + ag * ag + ab * ab;
          if (ad < bd) { bd = ad; best = c; }
        }
        var s = sums[best], cw = pts[j].c;
        s[0] += pts[j].r * cw; s[1] += pts[j].g * cw; s[2] += pts[j].b * cw; s[3] += cw;
      }
      for (j = 0; j < k; j++) if (sums[j][3] > 0) cent[j] = [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]];
    }
    var palette = cent.map(function (c) { return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]; });
    palette.sort(function (a, b) { return luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]); });

    var out = cloneImage(img), o = out.data, ds = ditherStrength || 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = (y * w + x) * 4;
        if (o[p + 3] === 0) continue;
        var t = ds > 0 ? ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * ds * 64 : 0;
        var r = o[p] + t, g = o[p + 1] + t, b = o[p + 2] + t;
        var bestC = 0, bestD = Infinity;
        for (var q = 0; q < palette.length; q++) {
          var xr = r - palette[q][0], xg = g - palette[q][1], xb = b - palette[q][2];
          var xd = xr * xr + xg * xg + xb * xb;
          if (xd < bestD) { bestD = xd; bestC = q; }
        }
        o[p] = palette[bestC][0]; o[p + 1] = palette[bestC][1]; o[p + 2] = palette[bestC][2];
      }
    }
    return { img: out, palette: palette, full: palette };
  }

  function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  var PALETTE_DEFS = {
    pico8: { gray: false, list: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'] },
    sweetie: { gray: false, list: ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'] },
    gameboy: { gray: true, list: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] }
  };
  var PALETTES = {};
  Object.keys(PALETTE_DEFS).forEach(function (k) { PALETTES[k] = PALETTE_DEFS[k].list.map(hexToRgb); });

  // Maps every opaque pixel to a fixed palette. gray=true works on brightness only (Game Boy look).
  function mapToPalette(img, pal, dither, gray) {
    var w = img.w, h = img.h, out = cloneImage(img), o = out.data, used = {}, ds = dither || 0, x, y, q;
    var lo = 0, hi = 255, pl = pal.map(function (c) { return luma(c[0], c[1], c[2]); });
    var pMin = Math.min.apply(null, pl), pMax = Math.max.apply(null, pl);
    if (gray) {
      var ls = [];
      for (var i = 0; i < o.length; i += 4) if (o[i + 3] > 0) ls.push(luma(o[i], o[i + 1], o[i + 2]));
      if (ls.length) { ls.sort(function (a, b) { return a - b; }); lo = ls[Math.floor(ls.length * 0.02)]; hi = ls[Math.floor(ls.length * 0.98)]; if (hi - lo < 8) hi = lo + 8; }
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var p = (y * w + x) * 4;
      if (o[p + 3] === 0) continue;
      var t = ds > 0 ? ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * ds * 64 : 0;
      var best = 0, bd = Infinity;
      if (gray) {
        var l = (luma(o[p], o[p + 1], o[p + 2]) - lo) / (hi - lo);
        l = pMin + Math.max(0, Math.min(1, l)) * (pMax - pMin) + t * 0.5;
        for (q = 0; q < pal.length; q++) { var dl = Math.abs(pl[q] - l); if (dl < bd) { bd = dl; best = q; } }
      } else {
        var r = clamp255(o[p] + t), g = clamp255(o[p + 1] + t), b = clamp255(o[p + 2] + t);
        for (q = 0; q < pal.length; q++) {
          var dd = dist(r, g, b, pal[q][0], pal[q][1], pal[q][2]);
          if (dd < bd) { bd = dd; best = q; }
        }
      }
      o[p] = pal[best][0]; o[p + 1] = pal[best][1]; o[p + 2] = pal[best][2]; used[best] = 1;
    }
    var usedList = Object.keys(used).map(function (k) { return pal[+k].slice(); });
    usedList.sort(function (a, b) { return luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]); });
    return { img: out, palette: usedList, full: pal.map(function (c) { return c.slice(); }) };
  }

  // Picks the palette colour closest to `target` that is lighter (sign +1) or darker (sign -1) than c.
  function snapDir(c, target, pal, sign) {
    var lc = luma(c[0], c[1], c[2]), best = null, bd = Infinity;
    for (var q = 0; q < pal.length; q++) {
      var lp = luma(pal[q][0], pal[q][1], pal[q][2]);
      if (sign * (lp - lc) < 2) continue;
      var dd = dist(clamp255(target[0]), clamp255(target[1]), clamp255(target[2]), pal[q][0], pal[q][1], pal[q][2]);
      if (dd < bd) { bd = dd; best = pal[q]; }
    }
    return best || c;
  }

  // Unsharp mask on colour, so small details (grille, door line, lights) survive the downscale.
  function sharpen(img, amt) {
    var w = img.w, h = img.h, d = img.data, out = cloneImage(img), o = out.data;
    if (!amt) return out;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = (y * w + x) * 4;
      if (d[p + 3] === 0) continue;
      var sr = 0, sg = 0, sb = 0, n = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var q = (ny * w + nx) * 4;
        if (d[q + 3] === 0) continue;
        sr += d[q]; sg += d[q + 1]; sb += d[q + 2]; n++;
      }
      o[p] = clamp255(d[p] + (d[p] - sr / n) * amt * 1.6);
      o[p + 1] = clamp255(d[p + 1] + (d[p + 1] - sg / n) * amt * 1.6);
      o[p + 2] = clamp255(d[p + 2] + (d[p + 2] - sb / n) * amt * 1.6);
    }
    return out;
  }

  // Pixel clean-up on an already quantised image.
  // level 1: a pixel that shares no colour with its 4 neighbours takes the colour 3+ neighbours share.
  // level 2: also drops 1px spurs on the silhouette.
  function cleanPixels(img, level) {
    var w = img.w, h = img.h, cur = cloneImage(img);
    if (!level) return cur;
    for (var pass = 0; pass < Math.min(2, level); pass++) {
      var src = cloneImage(cur), d = src.data, o = cur.data;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var p = (y * w + x) * 4;
        if (d[p + 3] === 0) continue;
        var tally = {}, same = 0, opaque = 0, nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (var k = 0; k < 4; k++) {
          var nx = nb[k][0], ny = nb[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var q = (ny * w + nx) * 4;
          if (d[q + 3] === 0) continue;
          opaque++;
          var key = d[q] + ',' + d[q + 1] + ',' + d[q + 2];
          tally[key] = (tally[key] || 0) + 1;
          if (d[q] === d[p] && d[q + 1] === d[p + 1] && d[q + 2] === d[p + 2]) same++;
        }
        if (level >= 2 && pass === 1 && opaque <= 1) { o[p + 3] = 0; continue; }
        if (same === 0) {
          for (var kk in tally) if (tally[kk] >= 3) {
            var c = kk.split(',');
            o[p] = +c[0]; o[p + 1] = +c[1]; o[p + 2] = +c[2];
          }
        }
      }
    }
    return cur;
  }

  // Light on the top edges (roof, hood) and a darker lower edge, snapped to the palette so the colour count stays.
  function addRimLight(img, pal, amt) {
    var w = img.w, h = img.h, d = img.data, out = cloneImage(img), o = out.data;
    if (!amt || !pal || !pal.length) return out;
    function alphaAt(x, y) { return (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[(y * w + x) * 4 + 3]; }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = (y * w + x) * 4;
      if (d[p + 3] === 0) continue;
      var c = [d[p], d[p + 1], d[p + 2]], n = null;
      if (alphaAt(x, y - 1) === 0 && y < h * 0.62) n = snapDir(c, [c[0] + 70 * amt, c[1] + 70 * amt, c[2] + 70 * amt], pal, 1);
      else if (alphaAt(x, y + 1) === 0 && y >= h * 0.62) n = snapDir(c, [c[0] * (1 - 0.4 * amt), c[1] * (1 - 0.4 * amt), c[2] * (1 - 0.4 * amt)], pal, -1);
      if (n) { o[p] = n[0]; o[p + 1] = n[1]; o[p + 2] = n[2]; }
    }
    return out;
  }

  // Diagonal light streaks over the darkest pixels in the upper half (glass). Snaps to pal when given.
  function addGlassShine(img, pal) {
    var w = img.w, h = img.h, out = cloneImage(img), d = out.data;
    var lumas = [], limitY = Math.floor(h * 0.55), x, y;
    for (y = 0; y < limitY; y++) for (x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      if (d[i + 3] > 0) lumas.push(luma(d[i], d[i + 1], d[i + 2]));
    }
    if (!lumas.length) return out;
    lumas.sort(function (a, b) { return a - b; });
    var thr = lumas[Math.floor(lumas.length * 0.3)];
    for (y = 0; y < limitY; y++) for (x = 0; x < w; x++) {
      var j = (y * w + x) * 4;
      if (d[j + 3] === 0) continue;
      if (luma(d[j], d[j + 1], d[j + 2]) > thr) continue;
      var phase = (x * 2 + y * 3) % 18;
      if (phase < 3) {
        if (pal && pal.length) {
          var n = snapDir([d[j], d[j + 1], d[j + 2]], [d[j] + 40, d[j + 1] + 44, d[j + 2] + 54], pal, 1);
          d[j] = n[0]; d[j + 1] = n[1]; d[j + 2] = n[2];
        } else {
          d[j] = clamp255(d[j] + 38); d[j + 1] = clamp255(d[j + 1] + 42); d[j + 2] = clamp255(d[j + 2] + 52);
        }
      }
    }
    return out;
  }

  var TIRE = [22, 23, 29], TIRE_HI = [44, 46, 58], ARCH = [14, 14, 20];
  var RIMS = {
    silver: { light: [223, 227, 236], mid: [169, 175, 189], dark: [92, 98, 114], gap: [38, 40, 51], hub: [138, 144, 160] },
    gold:   { light: [250, 220, 130], mid: [208, 166, 68],  dark: [122, 88, 30],  gap: [52, 40, 22], hub: [180, 140, 56] },
    black:  { light: [104, 108, 124], mid: [72, 76, 92],    dark: [44, 46, 58],   gap: [24, 25, 32], hub: [78, 82, 98] },
    white:  { light: [247, 247, 252], mid: [208, 211, 223], dark: [140, 145, 160], gap: [54, 56, 68], hub: [192, 196, 208] }
  };
  var WHEEL_STYLES = { five: { n: 5, half: 0.12 }, mesh: { n: 10, half: 0.075 }, disc: { n: 0, half: 0 } };

  function setPx(img, x, y, c) {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    var i = (y * img.w + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }

  // Stamps a clean, identical pixel wheel on every position: dark arch, tyre, rim ring, spokes, hub.
  // style: five | mesh | disc.   rim: silver | gold | black | white.
  function drawWheels(img, wheels, style, rim, angle) {
    angle = angle || 0;
    var out = cloneImage(img);
    var st = WHEEL_STYLES[style] || WHEEL_STYLES.five, rc = RIMS[rim] || RIMS.silver;
    wheels.forEach(function (wh) {
      var cx = Math.round(wh.cx), cy = Math.round(wh.cy), r = wh.r;
      var x, y;
      // arch shadow only where the body already exists
      for (y = cy - r - 2; y <= cy + r + 1; y++) for (x = cx - r - 2; x <= cx + r + 1; x++) {
        var ddx = x + 0.5 - cx, ddy = y + 0.5 - cy, dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dd > r && dd <= r + 1.6 && x >= 0 && y >= 0 && x < out.w && y < out.h && out.data[(y * out.w + x) * 4 + 3] > 0) {
          setPx(out, x, y, ARCH);
        }
      }
      for (y = cy - r; y < cy + r; y++) for (x = cx - r; x < cx + r; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        var col;
        if (d > r * 0.8) {
          col = (dy < -r * 0.45 && d > r * 0.88) ? TIRE_HI : TIRE;
        } else if (d > r * 0.7) {
          col = dy < 0 ? rc.light : rc.mid;
        } else if (d <= r * 0.2) {
          col = d <= r * 0.08 ? rc.dark : rc.hub;
        } else if (st.n === 0) {
          col = dy < 0 ? rc.light : rc.mid;
          for (var k = 0; k < 5; k++) {
            var la = k * Math.PI * 2 / 5 - Math.PI / 2 + angle;
            if (Math.hypot(dx - Math.cos(la) * r * 0.46, dy - Math.sin(la) * r * 0.46) <= 0.75) col = rc.dark;
          }
        } else {
          var step = Math.PI * 2 / st.n;
          var ang = Math.atan2(dy, dx) + Math.PI / 2 - angle;
          var a = ((ang % step) + step) % step;
          var da = Math.abs(a - step / 2);
          var half = Math.atan2(r * st.half, d);
          col = da <= half ? (dy < 0 ? rc.light : rc.mid) : rc.gap;
        }
        setPx(out, x, y, col);
      }
    });
    return out;
  }

  // color = [r,g,b] for a fixed outline, or null to tint each outline pixel from the body next to it.
  function addOutline(img, color) {
    var w = img.w + 2, h = img.h + 2, out = makeImage(w, h), x, y;
    for (y = 0; y < img.h; y++) for (x = 0; x < img.w; x++) {
      var si = (y * img.w + x) * 4, di = ((y + 1) * w + (x + 1)) * 4;
      out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = img.data[si + 3];
    }
    var src = out.data.slice();
    function opaqueAt(px, py) { return px >= 0 && py >= 0 && px < w && py < h && src[(py * w + px) * 4 + 3] > 0; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      if (src[i + 3] > 0) continue;
      var nx = -1, ny = -1;
      if (opaqueAt(x, y - 1)) { nx = x; ny = y - 1; }
      else if (opaqueAt(x, y + 1)) { nx = x; ny = y + 1; }
      else if (opaqueAt(x - 1, y)) { nx = x - 1; ny = y; }
      else if (opaqueAt(x + 1, y)) { nx = x + 1; ny = y; }
      if (nx < 0) continue;
      var c = color;
      if (!c) {
        var ni = (ny * w + nx) * 4;
        c = [src[ni] * 0.34, src[ni + 1] * 0.32, src[ni + 2] * 0.4];
      }
      out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; out.data[i + 3] = 255;
    }
    return out;
  }

  // Flat, semi-transparent ground shadow under the car.
  function addShadow(img, rows) {
    rows = rows || 2;
    var w = img.w, h = img.h, out = makeImage(w, h + rows), x, y, r;
    out.data.set(img.data);
    var x0 = w, x1 = -1;
    for (y = Math.max(0, h - 3); y < h; y++) for (x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    }
    if (x1 < 0) return out;
    var span = x1 - x0, inset = Math.round(span * 0.06);
    for (r = 0; r < rows; r++) {
      var ins = inset + r * Math.max(1, Math.round(span * 0.04));
      for (x = x0 + ins; x <= x1 - ins; x++) {
        var i = ((h + r) * w + x) * 4;
        out.data[i] = 8; out.data[i + 1] = 6; out.data[i + 2] = 16; out.data[i + 3] = r === 0 ? 120 : 70;
      }
    }
    return out;
  }

  // Finds the two wheels from the silhouette: they are the two places where the car reaches the
  // bottom edge, below the underbody line. Returns { rearX, frontX, r } as fractions of the width,
  // or null when the silhouette does not show two clear contact patches.
  function detectWheels(img) {
    var w = img.w, h = img.h, d = img.data, x, y;
    var bottomY = new Int32Array(w).fill(-1);
    for (x = 0; x < w; x++) {
      for (y = h - 1; y >= 0; y--) if (d[(y * w + x) * 4 + 3] > 0) { bottomY[x] = y; break; }
    }
    var eps = Math.max(2, Math.round(h * 0.05)), runs = [], start = -1, gap = 0, last = 0;
    for (x = 0; x <= w; x++) {
      var on = x < w && bottomY[x] >= h - 1 - eps;
      if (on) { if (start < 0) start = x; gap = 0; last = x; }
      else if (start >= 0) {
        gap++;
        if (gap > 1 || x === w) { runs.push({ x0: start, x1: last }); start = -1; gap = 0; }
      }
    }
    runs.forEach(function (rn) { rn.c = (rn.x0 + rn.x1 + 1) / 2; rn.wd = rn.x1 - rn.x0 + 1; });
    runs = runs.filter(function (rn) { return rn.wd >= 3; });
    runs.sort(function (a, b) { return b.wd - a.wd; });
    if (!runs.length) return null;
    var first = runs[0], second = null;
    for (var q = 1; q < runs.length; q++) if (Math.abs(runs[q].c - first.c) > w * 0.3) { second = runs[q]; break; }
    if (!second) return null;
    var pair = first.c < second.c ? [first, second] : [second, first];

    // underbody level: the median bottom edge between the two contact patches
    var from = Math.round(pair[0].c + (pair[1].c - pair[0].c) * 0.3), to = Math.round(pair[0].c + (pair[1].c - pair[0].c) * 0.7);
    var mids = [];
    for (x = from; x <= to; x++) if (bottomY[x] >= 0) mids.push(bottomY[x]);
    mids.sort(function (a, b) { return a - b; });
    var yb = mids.length ? mids[mids.length >> 1] : Math.round(h * 0.75);

    var widths = [], centers = [], reach = Math.round(w * 0.2);
    pair.forEach(function (rn) {
      var cx = Math.round(rn.c), l = cx, r = cx;
      while (l - 1 >= 0 && cx - (l - 1) <= reach && bottomY[l - 1] > yb + 1) l--;
      while (r + 1 < w && (r + 1) - cx <= reach && bottomY[r + 1] > yb + 1) r++;
      widths.push(r - l + 1); centers.push((l + r + 1) / 2);
    });
    var rad = ((widths[0] + widths[1]) / 2) / 2 / w;
    if (rad < 0.04 || rad > 0.14) return null;
    return { rearX: centers[0] / w, frontX: centers[1] / w, r: rad };
  }

  function detectWheelsFromPrepared(prepared, width) {
    return detectWheels(resizeArea(prepared.img, width || 128));
  }

  // ---------- compositing helpers and animation effects ----------
  function blendPx(img, x, y, c, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    var i = (y * img.w + x) * 4, d = img.data, da = d[i + 3] / 255, oa = a + da * (1 - a);
    if (oa <= 0) return;
    d[i] = (c[0] * a + d[i] * da * (1 - a)) / oa;
    d[i + 1] = (c[1] * a + d[i + 1] * da * (1 - a)) / oa;
    d[i + 2] = (c[2] * a + d[i + 2] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }
  function compositeOver(dst, src, ox, oy) {
    for (var y = 0; y < src.h; y++) for (var x = 0; x < src.w; x++) {
      var i = (y * src.w + x) * 4, a = src.data[i + 3];
      if (a > 0) blendPx(dst, x + ox, y + oy, [src.data[i], src.data[i + 1], src.data[i + 2]], a / 255);
    }
  }
  function quant4(a) { return Math.round(a * 4) / 4; }
  function disc(img, x, y, r, c, a) {
    var cx = Math.round(x) + 0.5, cy = Math.round(y) + 0.5, rr = Math.max(0.75, r);
    for (var yy = Math.floor(cy - rr); yy <= Math.ceil(cy + rr); yy++) for (var xx = Math.floor(cx - rr); xx <= Math.ceil(cx + rr); xx++) {
      var dx = xx + 0.5 - cx, dy = yy + 0.5 - cy;
      if (dx * dx + dy * dy <= rr * rr) blendPx(img, xx, yy, c, a);
    }
  }
  function shiftY(img, dy) {
    var out = makeImage(img.w, img.h);
    for (var y = 0; y < img.h; y++) {
      var ny = y + dy;
      if (ny < 0 || ny >= img.h) continue;
      out.data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ny * img.w * 4);
    }
    return out;
  }
  // Transparent wheel wells (body-only sprite): the game draws its own wheels underneath.
  function cutWells(img, wheels) {
    var out = cloneImage(img), w = img.w, h = img.h;
    wheels.forEach(function (wh) {
      var cx = Math.round(wh.cx), cy = Math.round(wh.cy), r = wh.r, x, y;
      for (y = cy - r - 2; y <= cy + r + 1; y++) for (x = cx - r - 2; x <= cx + r + 1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        var dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), i = (y * w + x) * 4;
        if (dd <= r + 0.5) out.data[i + 3] = 0;
        else if (dd <= r + 1.8 && out.data[i + 3] > 0) setPx(out, x, y, ARCH);
      }
    });
    return out;
  }

  var NEON = { pink: [255, 64, 170], cyan: [64, 230, 255], green: [110, 255, 120], orange: [255, 150, 50], violet: [170, 110, 255] };
  var SPOKES = { five: 5, mesh: 10, disc: 5 };

  function drawSpeedLines(out, t, padL, ox, bodyH, carW) {
    var ys = [0.3, 0.46, 0.62, 0.78], ph = [0, 0.37, 0.71, 0.54], len = [8, 13, 7, 10], sc = Math.max(1, carW / 130);
    for (var i = 0; i < 4; i++) {
      var u = (t + ph[i]) % 1, L = Math.round(len[i] * sc);
      var head = Math.round((padL + ox) - 2 - L - u * (padL + L)), y = Math.round(ox + bodyH * ys[i]);
      for (var k = 0; k < L; k++) blendPx(out, head + k, y, [235, 235, 250], quant4((0.25 + 0.6 * (k / L)) * (1 - u * 0.7)));
    }
  }
  function drawPuffs(out, t, x0, y0, span, c0, c1, n, rMax) {
    for (var i = 0; i < n; i++) {
      var a = (t + i / n) % 1, r = 0.8 + a * (rMax - 0.8);
      var col = [c0[0] + (c1[0] - c0[0]) * a, c0[1] + (c1[1] - c0[1]) * a, c0[2] + (c1[2] - c0[2]) * a];
      disc(out, x0 - a * span * 0.9, y0 - a * 3, r, col, quant4((1 - a) * 0.85));
    }
  }
  function drawNeon(out, t, col, x0, x1, ground) {
    var pulse = 0.7 + 0.3 * Math.sin(t * Math.PI * 2), str = [0.35, 0.7, 0.9, 0.35];
    for (var x = x0; x <= x1; x++) for (var k = 0; k < 4; k++) {
      var y = ground - 2 + k;
      if (y < 0 || y >= out.h) continue;
      if ((k === 0 || k === 3) && ((x + y) & 1) !== 0) continue;
      if (out.data[(y * out.w + x) * 4 + 3] > 200) continue;
      blendPx(out, x, y, col, quant4(str[k] * pulse));
    }
  }
  function drawBeam(out, x0, y0, len) {
    for (var dx = 1; dx <= len; dx++) {
      var half = Math.floor(dx * 0.3) + 1, a = 0.6 * (1 - dx / len) + 0.1;
      for (var dy = -half; dy <= half; dy++) if (((x0 + dx + y0 + dy) & 1) === 0) blendPx(out, x0 + dx, y0 + dy, [255, 246, 200], quant4(a));
    }
    blendPx(out, x0, y0, [255, 255, 235], 1);
  }

  var DEFAULTS = {
    width: 128, colors: 12, dither: 0, sat: 1.15, contrast: 1.1, hue: 0, sharpen: 0, clean: 0, palette: 'auto',
    wheels: true, wheelMode: 'stamp', rearX: 0.22, frontX: 0.79, wheelR: 0.075, wheelLift: 0, wheelStyle: 'five', rimColor: 'silver',
    shine: false, rimlight: 0, outline: true, outlineMode: 'dark', shadow: true
  };
  function mergeOpts(o) {
    var opt = {}, k;
    for (k in DEFAULTS) opt[k] = DEFAULTS[k];
    for (k in (o || {})) if (o[k] !== undefined) opt[k] = o[k];
    if (o && o.wheelMode === undefined && o.wheels === false) opt.wheelMode = 'keep';
    return opt;
  }

  // Phase A: background removal and crop. Slow part, cached by the page.
  function prepare(src, opts) {
    opts = opts || {};
    var img = src;
    if (img.w > 640) img = resizeArea(img, 640);
    var res = removeBackground(img, { tol: opts.tol, seed: opts.seed });
    var failed = false, work = res.img;
    if (countOpaque(work) < img.w * img.h * 0.02) { work = cloneImage(img); failed = true; }
    work = keepLargestComponent(work);
    work = cropToContent(work);
    if (opts.flip) work = flipH(work);
    return { img: work, bg: res.bg, failed: failed };
  }

  // Phase B: everything that shapes the body. Wheels, outline, shadow and effects come per frame.
  function prepareBody(prepared, o) {
    var opt = mergeOpts(o);
    var small = resizeArea(prepared.img, opt.width);
    var tuned = hueShift(adjustColors(small, opt.sat, opt.contrast), opt.hue);
    if (opt.sharpen) tuned = sharpen(tuned, opt.sharpen);
    var def = PALETTE_DEFS[opt.palette];
    var q = def ? mapToPalette(tuned, PALETTES[opt.palette], opt.dither, def.gray) : quantize(tuned, opt.colors, opt.dither);
    var img = q.img;
    if (opt.clean) img = cleanPixels(img, opt.clean);
    if (opt.shine) img = addGlassShine(img, q.full);
    if (opt.rimlight) img = addRimLight(img, q.full, opt.rimlight);
    var r = Math.max(3, Math.round(img.w * opt.wheelR)), cy = img.h - r - opt.wheelLift;
    return {
      img: img, palette: q.palette, full: q.full, lift: opt.wheelLift,
      wheelMode: opt.wheelMode,
      wheels: [{ cx: img.w * opt.rearX, cy: cy, r: r }, { cx: img.w * opt.frontX, cy: cy, r: r }]
    };
  }

  // One animation frame. t in [0,1) is the position in the loop. fx: { bob, spin, exhaust, dust, speed, beam, neon, neonColor }.
  function frame(body, o, t, fx) {
    var opt = mergeOpts(o), f = fx || {};
    var bw = body.img.w, bh = body.img.h;
    var dy = (f.bob && Math.sin(t * Math.PI * 4) > 0.35) ? -1 : 0;
    var img = dy ? shiftY(body.img, dy) : cloneImage(body.img);
    var mode = body.wheelMode;
    if (mode === 'stamp') {
      var n = SPOKES[opt.wheelStyle] || 5, sp = f.spin === undefined ? 1 : Math.round(f.spin);
      img = drawWheels(img, body.wheels, opt.wheelStyle, opt.rimColor, t * (Math.PI * 2 / n) * sp);
    } else if (mode === 'none') {
      img = cutWells(img, body.wheels);
    }
    var ox = 0;
    if (opt.outline) { img = addOutline(img, opt.outlineMode === 'tint' ? null : [20, 18, 30]); ox = 1; }
    if (opt.shadow) img = addShadow(img, 2);
    var carW = img.w, carH = img.h;
    var padL = (f.exhaust || f.speed || f.dust) ? Math.round(carW * 0.3) : 0;
    var padR = f.beam ? Math.round(carW * 0.28) : 0;
    var padB = f.neon ? 2 : 0;
    var out = makeImage(padL + carW + padR, carH + padB);
    var ground = ox + bh - (body.lift || 0);
    if (f.speed) drawSpeedLines(out, t, padL, ox, bh, carW);
    if (f.exhaust) drawPuffs(out, t, padL + ox + 1, Math.round(ox + bh * 0.74), padL, [150, 150, 165], [215, 215, 228], 3, 2.6);
    if (f.dust) drawPuffs(out, t + 0.17, padL + ox + Math.round(body.wheels[0].cx - body.wheels[0].r * 0.4), ground - 1, padL, [168, 140, 104], [214, 190, 150], 3, 1.8);
    compositeOver(out, img, padL, 0);
    if (f.neon) drawNeon(out, t, NEON[f.neonColor] || NEON.pink, padL + ox + 2, padL + ox + bw - 3, ground);
    if (f.beam) drawBeam(out, padL + ox + bw, Math.round(ox + bh * 0.6), padR);
    return {
      img: out,
      geom: {
        w: out.w, h: out.h, carX: padL, carW: carW, carH: carH, outline: ox, ground: ground, padL: padL, padR: padR,
        wheels: body.wheels.map(function (wh) { return { cx: wh.cx + padL + ox, cy: wh.cy + ox, r: wh.r }; })
      }
    };
  }

  // One wheel on its own, n rotation frames (a loop is one spoke period times spin).
  function wheelFrames(body, o, n, spin) {
    var opt = mergeOpts(o), r = body.wheels[0].r, size = r * 2 + 2, st = SPOKES[opt.wheelStyle] || 5, list = [];
    for (var i = 0; i < n; i++) {
      var im = makeImage(size, size);
      list.push(drawWheels(im, [{ cx: r + 1, cy: r + 1, r: r }], opt.wheelStyle, opt.rimColor, (i / n) * (Math.PI * 2 / st) * (spin === undefined ? 1 : spin)));
    }
    return list;
  }

  // Static render (no effects): what the garage and the plain PNG use.
  function render(prepared, o) {
    var opt = mergeOpts(o), body = prepareBody(prepared, opt), f = frame(body, opt, 0, null);
    return { img: f.img, palette: body.palette, body: body, geom: f.geom, opt: opt };
  }

  var api = {
    makeImage: makeImage, cloneImage: cloneImage, dist: dist, removeBackground: removeBackground,
    keepLargestComponent: keepLargestComponent, cropToContent: cropToContent, flipH: flipH,
    resizeArea: resizeArea, adjustColors: adjustColors, hueShift: hueShift, quantize: quantize, mapToPalette: mapToPalette,
    sharpen: sharpen, cleanPixels: cleanPixels, addRimLight: addRimLight, addGlassShine: addGlassShine,
    drawWheels: drawWheels, addOutline: addOutline, addShadow: addShadow, cutWells: cutWells,
    countOpaque: countOpaque, detectWheels: detectWheels, detectWheelsFromPrepared: detectWheelsFromPrepared,
    prepare: prepare, prepareBody: prepareBody, frame: frame, wheelFrames: wheelFrames, render: render,
    DEFAULTS: DEFAULTS, PALETTES: PALETTES, PALETTE_DEFS: PALETTE_DEFS, NEON: NEON, SPOKES: SPOKES,
    rgb2hsl: rgb2hsl, hsl2rgb: hsl2rgb, snapDir: snapDir, luma: luma
  };
  root.PixelCar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
