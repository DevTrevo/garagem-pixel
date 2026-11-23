/* Small file encoders with no dependencies: CRC32, store-only ZIP and animated GIF (with transparency).
   Runs in the browser and in Node (used by test_encoders.js). */
(function (root) {
  'use strict';

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function concat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), p = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
    return out;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return Uint8Array.from(Buffer.from(str, 'utf8'));
  }

  // files: [{ name: 'a/b.png', data: Uint8Array }]. Store-only (no compression): PNG and GIF are already compressed.
  function zipStore(files, when) {
    var d = when || new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var locals = [], centrals = [], offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name), crc = crc32(f.data), size = f.data.length;
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      var local = concat([new Uint8Array(lh.buffer), name, f.data]);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      centrals.push(concat([new Uint8Array(ch.buffer), name]));
      locals.push(local);
      offset += local.length;
    });
    var cd = concat(centrals);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cd.length, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    return concat(locals.concat([cd, new Uint8Array(end.buffer)]));
  }

  // LZW as the GIF format wants it (variable code size, clear code when the table is full).
  function lzw(indices, minCode) {
    var clear = 1 << minCode, eoi = clear + 1, next = eoi + 1, size = minCode + 1;
    var out = [], cur = 0, shift = 0, table = new Map();
    function emit(code) {
      cur |= code << shift; shift += size;
      while (shift >= 8) { out.push(cur & 255); cur >>>= 8; shift -= 8; }
    }
    emit(clear);
    var prefix = indices[0];
    for (var i = 1; i < indices.length; i++) {
      var k = indices[i], key = (prefix << 8) | k, code = table.get(key);
      if (code === undefined) {
        emit(prefix);
        if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; table = new Map(); }
        else { if (next >= (1 << size)) size++; table.set(key, next++); }
        prefix = k;
      } else prefix = code;
    }
    emit(prefix); emit(eoi);
    if (shift > 0) out.push(cur & 255);
    return out;
  }

  // frames: [{ w, h, data: RGBA }], all the same size.
  // opts: { delay: centiseconds per frame, transparent: bool (alpha < 128 becomes transparent), loop: 0 = forever }
  function encodeGif(frames, opts) {
    opts = opts || {};
    var w = frames[0].w, h = frames[0].h, tr = !!opts.transparent, delay = Math.max(1, Math.round(opts.delay || 10));
    var map = new Map(), pal = [], reduce = false, f, i;
    if (tr) pal.push([0, 0, 0]);
    scan:
    for (f = 0; f < frames.length; f++) {
      var d = frames[f].data;
      for (i = 0; i < d.length; i += 4) {
        if (tr && d[i + 3] < 128) continue;
        var key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        if (!map.has(key)) { map.set(key, pal.length); pal.push([d[i], d[i + 1], d[i + 2]]); if (pal.length > 256) { reduce = true; break scan; } }
      }
    }
    var cache = new Map();
    if (reduce) {
      var mosaic = { w: w, h: h * frames.length, data: new Uint8ClampedArray(w * h * frames.length * 4) };
      frames.forEach(function (fr, n) {
        var o = n * w * h * 4;
        for (var j = 0; j < fr.data.length; j += 4) {
          var on = !(tr && fr.data[j + 3] < 128);
          mosaic.data[o + j] = fr.data[j]; mosaic.data[o + j + 1] = fr.data[j + 1]; mosaic.data[o + j + 2] = fr.data[j + 2]; mosaic.data[o + j + 3] = on ? 255 : 0;
        }
      });
      var q = root.PixelCar.quantize(mosaic, tr ? 255 : 256, 0);
      pal = (tr ? [[0, 0, 0]] : []).concat(q.palette);
    }
    function indexOf(r, g, b) {
      var k = (r << 16) | (g << 8) | b;
      if (!reduce) return map.get(k);
      var c = cache.get(k);
      if (c !== undefined) return c;
      var best = tr ? 1 : 0, bd = Infinity;
      for (var p = tr ? 1 : 0; p < pal.length; p++) {
        var dr = r - pal[p][0], dg = g - pal[p][1], db = b - pal[p][2], dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; best = p; }
      }
      cache.set(k, best);
      return best;
    }
    var bits = 1;
    while ((1 << bits) < pal.length && bits < 8) bits++;
    var tableSize = 1 << bits, minCode = Math.max(2, bits);
    var out = [];
    function bytes(arr) { for (var n = 0; n < arr.length; n++) out.push(arr[n]); }
    function str(s) { for (var n = 0; n < s.length; n++) out.push(s.charCodeAt(n)); }
    function u16(v) { out.push(v & 255, (v >> 8) & 255); }
    str('GIF89a'); u16(w); u16(h);
    out.push(0x80 | 0x70 | (bits - 1), 0, 0);
    for (i = 0; i < tableSize; i++) { var c = pal[i] || [0, 0, 0]; out.push(c[0], c[1], c[2]); }
    out.push(0x21, 0xFF, 0x0B); str('NETSCAPE2.0'); out.push(3, 1); u16(opts.loop || 0); out.push(0);
    frames.forEach(function (fr) {
      var idx = new Uint8Array(w * h);
      for (var p = 0, n = 0; p < fr.data.length; p += 4, n++) {
        idx[n] = (tr && fr.data[p + 3] < 128) ? 0 : indexOf(fr.data[p], fr.data[p + 1], fr.data[p + 2]);
      }
      out.push(0x21, 0xF9, 0x04, ((tr ? 2 : 1) << 2) | (tr ? 1 : 0)); u16(delay); out.push(0, 0);
      out.push(0x2C); u16(0); u16(0); u16(w); u16(h); out.push(0);
      out.push(minCode);
      var data = lzw(idx, minCode);
      for (var s = 0; s < data.length; s += 255) {
        var chunk = data.slice(s, s + 255);
        out.push(chunk.length); bytes(chunk);
      }
      out.push(0);
    });
    out.push(0x3B);
    return Uint8Array.from(out);
  }

  var api = { crc32: crc32, zipStore: zipStore, encodeGif: encodeGif, concat: concat, utf8: utf8 };
  root.PixelEnc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
