  /* ---------- aba Editor de sprites (camadas, frames, prévia) ----------
     Este trecho é inlinado dentro do módulo principal (build.py), então usa $, clamp, toCanvas,
     scaleCanvas, canvasToBlob, saveData, pushGarage, saveGarage, renderGarage, garage, E e SP dele. */
  var ed = {
    P: SP.project(64, 48), f: 0, l: 0, hist: SP.projHistory(120),
    tool: 'pencil', color: [239, 125, 87], zoom: 'auto', z: 8, grid: true, onion: false, scale: 1,
    pal: SP.SWEETIE.map(SP.parseHex), drag: null, last: null, armed: null, armedTimer: 0, saveTimer: 0,
    playing: false, playTimer: 0, playF: 0
  };
  var ED_KEY = 'garagem-pixel-editor-v2', ED_KEY_V1 = 'garagem-pixel-editor-v1';
  var edCanvas = $('edCanvas'), edGrid = $('edGrid'), edBuf = document.createElement('canvas'), edBuf2 = document.createElement('canvas');
  function edSay(t) { $('edStatus').textContent = t; }
  function cel() { return ed.P.frames[ed.f].cels[ed.l]; }
  function edFrameImg() { return SP.composite(ed.P, ed.f); }

  // ---------- guardar e recuperar (no navegador) ----------
  function edSaveSoon() {
    clearTimeout(ed.saveTimer);
    ed.saveTimer = setTimeout(function () {
      try {
        var P = ed.P;
        localStorage.setItem(ED_KEY, JSON.stringify({
          w: P.w, h: P.h, fps: P.fps, layers: P.layers,
          frames: P.frames.map(function (fr) { return fr.cels.map(function (c) { return toCanvas(c).toDataURL('image/png'); }); }),
          pal: ed.pal.map(SP.toHex), name: $('edName').value
        }));
      } catch (e) { /* armazenamento pode estar bloqueado ou cheio */ }
    }, 400);
  }
  function loadAll(urls, cb) {
    var out = new Array(urls.length), left = urls.length;
    if (!left) { cb(out); return; }
    urls.forEach(function (u, i) { imageFromUrl(u, function (im) { out[i] = im; if (--left === 0) cb(out); }); });
  }
  function edLoadSaved() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(ED_KEY) || 'null'); } catch (e) { s = null; }
    try {
      if (s && Array.isArray(s.pal)) { var pal = s.pal.map(SP.parseHex).filter(Boolean).slice(0, 48); if (pal.length) ed.pal = pal; }
      if (s && typeof s.name === 'string') $('edName').value = s.name.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40) || 'meu-sprite';
      if (s && Array.isArray(s.frames) && Array.isArray(s.layers) && s.frames.length && s.frames.length <= 64 && s.layers.length && s.layers.length <= 16) {
        var urls = [];
        s.frames.forEach(function (fr) { (Array.isArray(fr) ? fr : []).forEach(function (u) { urls.push(typeof u === 'string' && u.indexOf('data:image/png') === 0 ? u : ''); }); });
        loadAll(urls, function (ims) {
          var P = SP.project(s.w, s.h), k = 0, bad = false;
          P.layers = s.layers.map(function (l, i) { return { name: String((l && l.name) || 'Camada ' + (i + 1)).slice(0, 24), visible: !(l && l.visible === false) }; });
          P.fps = clamp(parseInt(s.fps, 10) || 8, 1, 24);
          P.frames = s.frames.map(function (fr) {
            return { cels: P.layers.map(function () {
              var im = ims[k++], c = SP.create(P.w, P.h);
              if (!im) { bad = true; return c; }
              return SP.resize(SP.fromImage(im), P.w, P.h);
            }) };
          });
          if (bad) return;
          edSetProject(P, true); edSay('Seu último desenho foi recuperado.');
        });
        return;
      }
      var v1 = JSON.parse(localStorage.getItem(ED_KEY_V1) || 'null');
      if (v1 && typeof v1.url === 'string' && v1.url.indexOf('data:image/png') === 0) {
        imageFromUrl(v1.url, function (im) { if (im) { edSetProject(SP.projectFromDoc(SP.fromImage(im)), true); edSay('Seu último desenho foi recuperado.'); } });
      }
    } catch (e) { /* ignore */ }
  }
  function imageFromUrl(url, cb) {
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      var g = c.getContext('2d'); g.drawImage(img, 0, 0);
      var d = g.getImageData(0, 0, c.width, c.height);
      cb({ w: c.width, h: c.height, data: d.data });
    };
    img.onerror = function () { cb(null); };
    img.src = url;
  }

  // ---------- estado ----------
  function edHasInk() {
    return ed.P.frames.some(function (fr) { return fr.cels.some(function (c) { for (var i = 3; i < c.data.length; i += 4) if (c.data[i]) return true; return false; }); });
  }
  // Ações que apagam o desenho pedem um segundo clique (confirm() não existe aqui).
  function edConfirm(key, btn, label, go) {
    if (ed.armed === key) { clearTimeout(ed.armedTimer); ed.armed = null; btn.textContent = label; go(); return; }
    if (!edHasInk()) { go(); return; }
    ed.armed = key; btn.textContent = 'Clique de novo para apagar o desenho';
    clearTimeout(ed.armedTimer);
    ed.armedTimer = setTimeout(function () { ed.armed = null; btn.textContent = label; }, 3000);
  }
  function edClampSel() { ed.f = clamp(ed.f, 0, ed.P.frames.length - 1); ed.l = clamp(ed.l, 0, ed.P.layers.length - 1); }
  function edSetProject(P, keepHist) {
    edStop();
    ed.P = P; ed.f = 0; ed.l = P.layers.length - 1;
    if (!keepHist) ed.hist.clear();
    $('edW').value = P.w; $('edH').value = P.h; $('edFps').value = P.fps;
    edLayout(); edRefresh();
  }
  // Mudança de estrutura (camadas, frames, tamanho): guarda foto antes e depois para desfazer.
  function edStruct(fn, msg) {
    edStop();
    var before = SP.cloneProject(ed.P), r = fn();
    if (r === false) return false;
    ed.hist.pushProj(before, SP.cloneProject(ed.P));
    edClampSel(); edLayout(); edRefresh(); edSaveSoon();
    if (msg) edSay(msg);
    return true;
  }

  // ---------- zoom ----------
  var ED_ZOOMS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32];
  function edAutoZoom() {
    var box = $('edScroll'), w = ed.P.w, h = ed.P.h;
    var availW = Math.max(40, box.clientWidth - 26), availH = Math.max(40, Math.min(window.innerHeight * 0.7, 720) - 26);
    return clamp(Math.floor(Math.min(availW / w, availH / h)), 1, 32);
  }
  function edZ() { return ed.zoom === 'auto' ? edAutoZoom() : ed.zoom; }
  function edSetZoom(z) {
    ed.zoom = z;
    document.querySelectorAll('[data-ezoom]').forEach(function (o) { o.setAttribute('aria-pressed', String(String(z) === o.getAttribute('data-ezoom'))); });
    edLayout(); edDraw();
  }
  function edStep(dir) {
    var cur = edZ(), i;
    if (dir > 0) { for (i = 0; i < ED_ZOOMS.length; i++) if (ED_ZOOMS[i] > cur) return edSetZoom(ED_ZOOMS[i]); }
    else { for (i = ED_ZOOMS.length - 1; i >= 0; i--) if (ED_ZOOMS[i] < cur) return edSetZoom(ED_ZOOMS[i]); }
  }
  function edLayout() {
    var w = ed.P.w, h = ed.P.h, z = edZ();
    ed.z = z; $('edZoomNow').textContent = 'zoom ' + z + '×';
    edBuf.width = w; edBuf.height = h; edBuf2.width = w; edBuf2.height = h;
    edCanvas.width = w * z; edCanvas.height = h * z;
    edGrid.width = w * z; edGrid.height = h * z;
    drawGrid();
  }
  function drawGrid() {
    var g = edGrid.getContext('2d'), z = ed.z, w = ed.P.w, h = ed.P.h;
    g.clearRect(0, 0, edGrid.width, edGrid.height);
    if (!ed.grid || z < 6) return;
    g.fillStyle = 'rgba(255,255,255,0.14)';
    for (var x = 1; x < w; x++) g.fillRect(x * z, 0, 1, h * z);
    for (var y = 1; y < h; y++) g.fillRect(0, y * z, w * z, 1);
  }

  // ---------- desenho na tela ----------
  function putImg(buf, im) {
    buf.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(im.data), im.w, im.h), 0, 0);
  }
  function edDraw() {
    var c = edCanvas.getContext('2d'); c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, edCanvas.width, edCanvas.height);
    if (ed.onion && ed.f > 0) {
      putImg(edBuf2, SP.composite(ed.P, ed.f - 1));
      c.globalAlpha = 0.3; c.drawImage(edBuf2, 0, 0, edCanvas.width, edCanvas.height); c.globalAlpha = 1;
    }
    putImg(edBuf, edFrameImg());
    c.drawImage(edBuf, 0, 0, edCanvas.width, edCanvas.height);
    $('edBoard').style.backgroundSize = Math.max(8, ed.z * 2) + 'px ' + Math.max(8, ed.z * 2) + 'px';
  }
  function swatchBtn(c) {
    var b = document.createElement('button'); b.type = 'button';
    var hx = SP.toHex(c);
    b.style.background = hx; b.title = hx; b.setAttribute('aria-label', 'Cor ' + hx);
    b.setAttribute('aria-pressed', String(hx === SP.toHex(ed.color)));
    b.addEventListener('click', function () { edSetColor(c); if (ed.tool === 'eraser') edSetTool('pencil'); });
    return b;
  }
  function edUsedPalette() {
    var box = $('edUsed'); box.textContent = '';
    SP.usedColors(edFrameImg(), 32).forEach(function (c) { box.appendChild(swatchBtn(c)); });
    if (!box.childNodes.length) { var p = document.createElement('span'); p.className = 'note'; p.textContent = 'Nenhuma ainda.'; box.appendChild(p); }
  }
  function edPalette() {
    var box = $('edPal'); box.textContent = '';
    ed.pal.forEach(function (c) { box.appendChild(swatchBtn(c)); });
  }
  function edSetColor(c) {
    ed.color = [c[0], c[1], c[2]];
    $('edSwatch').style.background = SP.toHex(ed.color);
    $('edColor').value = SP.toHex(ed.color);
    edPalette(); edUsedPalette();
  }
  function edSetTool(t) {
    ed.tool = t;
    document.querySelectorAll('[data-etool]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-etool') === t)); });
  }

  // ---------- painel de camadas ----------
  function renderLayers() {
    var ul = $('edLayers'); ul.textContent = '';
    for (var l = ed.P.layers.length - 1; l >= 0; l--) (function (l) {
      var L = ed.P.layers[l], li = document.createElement('li');
      if (!L.visible) li.className = 'off';
      var eye = document.createElement('button'); eye.type = 'button'; eye.className = 'btn eye';
      eye.textContent = L.visible ? '👁' : '–'; eye.setAttribute('aria-pressed', String(L.visible));
      eye.setAttribute('aria-label', (L.visible ? 'Esconder a camada ' : 'Mostrar a camada ') + L.name);
      eye.addEventListener('click', function () { L.visible = !L.visible; renderLayers(); edDraw(); edUsedPalette(); renderFrames(); edPreview(); edSaveSoon(); });
      var pick = document.createElement('button'); pick.type = 'button'; pick.className = 'btn pick';
      pick.textContent = L.name; pick.setAttribute('aria-pressed', String(l === ed.l));
      pick.addEventListener('click', function () { ed.l = l; renderLayers(); $('edLayerName').value = L.name; });
      li.appendChild(eye); li.appendChild(pick); ul.appendChild(li);
    })(l);
    $('edLayerName').value = ed.P.layers[ed.l].name;
    $('lyDel').disabled = ed.P.layers.length < 2; $('lyMerge').disabled = ed.l < 1;
    $('lyUp').disabled = ed.l >= ed.P.layers.length - 1; $('lyDown').disabled = ed.l < 1;
  }
  // ---------- tira de frames ----------
  function frameThumb(f) {
    var c = toCanvas(SP.composite(ed.P, f));
    return c;
  }
  function renderFrames() {
    var box = $('edFrames'); box.textContent = '';
    ed.P.frames.forEach(function (_, f) {
      var b = document.createElement('button'); b.type = 'button';
      b.setAttribute('aria-pressed', String(f === ed.f)); b.setAttribute('aria-label', 'Frame ' + (f + 1) + ' de ' + ed.P.frames.length);
      b.appendChild(frameThumb(f));
      var n = document.createElement('span'); n.textContent = String(f + 1); b.appendChild(n);
      b.addEventListener('click', function () { edGoFrame(f); });
      box.appendChild(b);
    });
    $('frDel').disabled = ed.P.frames.length < 2;
    $('frLeft').disabled = ed.f < 1; $('frRight').disabled = ed.f >= ed.P.frames.length - 1;
    $('frPlay').disabled = ed.P.frames.length < 2 && !ed.playing;
    $('edFpsOut').textContent = ed.P.fps + ' fps';
  }
  function edGoFrame(f) {
    edStop();
    ed.f = clamp(f, 0, ed.P.frames.length - 1);
    edDraw(); edUsedPalette(); renderFrames(); edPreview();
    edSay('Frame ' + (ed.f + 1) + ' de ' + ed.P.frames.length + '.');
  }
  // ---------- prévia animada ----------
  function edPreview(frame) {
    var cv = $('edPrev'), P = ed.P, f = frame == null ? ed.f : frame;
    if (cv.width !== P.w || cv.height !== P.h) { cv.width = P.w; cv.height = P.h; }
    cv.style.width = P.w * clamp(Math.floor(220 / P.w), 1, 8) + 'px';
    var g = cv.getContext('2d'); g.clearRect(0, 0, P.w, P.h);
    putImg(edBuf2, SP.composite(P, f)); g.drawImage(edBuf2, 0, 0);
    $('edPrevInfo').textContent = P.frames.length === 1 ? 'Um frame só. Crie mais frames para animar.'
      : (ed.playing ? 'Tocando: frame ' + (f + 1) + ' de ' + P.frames.length : P.frames.length + ' frames a ' + P.fps + ' fps');
  }
  function edPlay() {
    if (ed.P.frames.length < 2) { edSay('Crie mais de um frame para tocar a animação.'); return; }
    ed.playing = true; ed.playF = ed.f; $('frPlay').textContent = '■ Parar'; $('frPlay').setAttribute('aria-pressed', 'true');
    (function tick() {
      if (!ed.playing) return;
      ed.playF = (ed.playF + 1) % ed.P.frames.length;
      edPreview(ed.playF);
      ed.playTimer = setTimeout(tick, 1000 / ed.P.fps);
    })();
  }
  function edStop() {
    if (!ed.playing) return;
    ed.playing = false; clearTimeout(ed.playTimer);
    $('frPlay').textContent = '▶ Tocar'; $('frPlay').setAttribute('aria-pressed', 'false');
    edPreview();
  }
  function edRefresh() {
    edClampSel();
    edDraw(); edUsedPalette(); renderLayers(); renderFrames(); edPreview();
    $('spUndo').disabled = !ed.hist.undo.length; $('spRedo').disabled = !ed.hist.redo.length;
    var P = ed.P;
    $('edInfo').textContent = 'Frame: ' + P.w * ed.scale + ' × ' + P.h * ed.scale + ' px · folha: ' + P.w * P.frames.length * ed.scale + ' × ' + P.h * ed.scale + ' px · ' +
      P.frames.length + (P.frames.length === 1 ? ' frame' : ' frames') + ' · ' + P.layers.length + (P.layers.length === 1 ? ' camada' : ' camadas');
  }

  // ---------- ponteiro ----------
  function edPoint(ev) {
    var r = edCanvas.getBoundingClientRect();
    return [Math.floor((ev.clientX - r.left) / r.width * ed.P.w), Math.floor((ev.clientY - r.top) / r.height * ed.P.h)];
  }
  function stamp(x, y, col) {
    var d = cel();
    SP.set(d, x, y, col);
    if ($('edMirror').checked) SP.set(d, d.w - 1 - x, y, col);
  }
  function edPointerDown(ev) {
    if (ev.button !== 0 && ev.button !== 2) return;
    ev.preventDefault();
    edStop();
    var p = edPoint(ev);
    if (!SP.inside(cel(), p[0], p[1])) return;
    var erase = ev.button === 2 || ed.tool === 'eraser';
    var col = erase ? [0, 0, 0, 0] : [ed.color[0], ed.color[1], ed.color[2], 255];
    if (ed.tool === 'picker') {
      var c = SP.get(edFrameImg(), p[0], p[1]);
      if (c && c[3]) { edSetColor(c); edSay('Cor ' + SP.toHex(c) + ' escolhida.'); }
      else edSay('Esse pixel está vazio.');
      return;
    }
    if (!ed.P.layers[ed.l].visible) { ed.P.layers[ed.l].visible = true; renderLayers(); edSay('A camada estava escondida, então eu a mostrei.'); }
    try { edCanvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    ed.drag = { before: SP.clone(cel()), start: p, col: col, tool: ed.tool, f: ed.f, l: ed.l };
    ed.last = p;
    if (ed.tool === 'bucket') {
      SP.flood(cel(), p[0], p[1], function (x, y) { stamp(x, y, col); });
      edEnd();
      return;
    }
    if (ed.tool === 'pencil' || ed.tool === 'eraser') stamp(p[0], p[1], col);
    edDraw();
  }
  function edShape(a, b) {
    var d = ed.drag, fill = $('edFill').checked;
    cel().data.set(d.before.data);
    var cb = function (x, y) { stamp(x, y, d.col); };
    if (d.tool === 'line') SP.line(a[0], a[1], b[0], b[1], cb);
    else if (d.tool === 'rect') SP.rect(a[0], a[1], b[0], b[1], fill, cb);
    else if (d.tool === 'ellipse') SP.ellipse(a[0], a[1], b[0], b[1], fill, cb);
  }
  function edPointerMove(ev) {
    var p = edPoint(ev);
    if (SP.inside(cel(), p[0], p[1])) {
      var c = SP.get(edFrameImg(), p[0], p[1]);
      $('edPos').textContent = 'x ' + p[0] + ' · y ' + p[1] + (c[3] ? ' · ' + SP.toHex(c) : ' · vazio');
    }
    if (!ed.drag) return;
    var d = ed.drag;
    if (d.tool === 'pencil' || d.tool === 'eraser') {
      SP.line(ed.last[0], ed.last[1], p[0], p[1], function (x, y) { stamp(x, y, d.col); });
      ed.last = p;
    } else if (d.tool === 'line' || d.tool === 'rect' || d.tool === 'ellipse') {
      edShape(d.start, p);
    }
    edDraw();
  }
  function edEnd() {
    if (!ed.drag) return;
    var d = ed.drag; ed.drag = null;
    var entry = SP.diff(d.before, ed.P.frames[d.f].cels[d.l]);
    if (entry) { ed.hist.pushPx(d.f, d.l, entry); edSaveSoon(); }
    edRefresh();
  }
  edCanvas.addEventListener('pointerdown', edPointerDown);
  edCanvas.addEventListener('pointermove', edPointerMove);
  edCanvas.addEventListener('pointerup', edEnd);
  edCanvas.addEventListener('pointercancel', edEnd);
  edCanvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  edCanvas.addEventListener('pointerleave', function () { if (!ed.drag) $('edPos').textContent = 'Passe o mouse sobre o desenho.'; });

  // ---------- desfazer / refazer ----------
  function edAfterHist(en) {
    if (!en) return;
    if (en.k === 'px') { ed.f = en.f; ed.l = en.l; }
    edClampSel(); edLayout(); edRefresh(); edSaveSoon();
    $('edW').value = ed.P.w; $('edH').value = ed.P.h; $('edFps').value = ed.P.fps;
  }
  function edUndo() { edStop(); edAfterHist(ed.hist.back(ed.P)); }
  function edRedo() { edStop(); edAfterHist(ed.hist.forward(ed.P)); }

  // ---------- botões ----------
  document.querySelectorAll('[data-etool]').forEach(function (b) { b.addEventListener('click', function () { edSetTool(b.getAttribute('data-etool')); }); });
  document.querySelectorAll('[data-ezoom]').forEach(function (b) {
    b.addEventListener('click', function () { var v = b.getAttribute('data-ezoom'); edSetZoom(v === 'auto' ? 'auto' : parseInt(v, 10)); });
  });
  $('edZoomIn').addEventListener('click', function () { edStep(1); });
  $('edZoomOut').addEventListener('click', function () { edStep(-1); });
  $('edScroll').addEventListener('wheel', function (ev) {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault(); edStep(ev.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  window.addEventListener('resize', function () { if (!$('edView').hidden && ed.zoom === 'auto') { edLayout(); edDraw(); } });
  if (window.ResizeObserver) new ResizeObserver(function () {
    if (!$('edView').hidden && ed.zoom === 'auto' && edAutoZoom() !== ed.z) { edLayout(); edDraw(); }
  }).observe($('edScroll'));
  document.querySelectorAll('[data-escale]').forEach(function (b) {
    b.addEventListener('click', function () {
      ed.scale = parseInt(b.getAttribute('data-escale'), 10);
      document.querySelectorAll('[data-escale]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      edRefresh();
    });
  });
  $('edGridOn').addEventListener('change', function () { ed.grid = this.checked; drawGrid(); });
  $('edOnion').addEventListener('change', function () { ed.onion = this.checked; edDraw(); });
  $('spUndo').addEventListener('click', edUndo);
  $('spRedo').addEventListener('click', edRedo);
  $('edColor').addEventListener('input', function () { var c = SP.parseHex(this.value); if (c) { edSetColor(c); if (ed.tool === 'eraser') edSetTool('pencil'); } });
  $('edAddColor').addEventListener('click', function () {
    var hx = SP.toHex(ed.color);
    if (ed.pal.some(function (c) { return SP.toHex(c) === hx; })) { edSay('Essa cor já está na paleta.'); return; }
    ed.pal.push(ed.color.slice()); if (ed.pal.length > 48) ed.pal.shift();
    edPalette(); edSaveSoon(); edSay('Cor ' + hx + ' guardada na paleta.');
  });

  // camadas
  $('edLayerName').addEventListener('input', function () {
    ed.P.layers[ed.l].name = this.value.slice(0, 24) || 'Camada';
    var pk = $('edLayers').querySelectorAll('.pick'), idx = ed.P.layers.length - 1 - ed.l;
    if (pk[idx]) pk[idx].textContent = ed.P.layers[ed.l].name;
    edSaveSoon();
  });
  $('lyNew').addEventListener('click', function () {
    if (ed.P.layers.length >= 16) { edSay('O limite é de 16 camadas.'); return; }
    edStruct(function () { ed.l = SP.addLayer(ed.P, ed.l + 1); }, 'Camada nova criada.');
  });
  $('lyDup').addEventListener('click', function () {
    if (ed.P.layers.length >= 16) { edSay('O limite é de 16 camadas.'); return; }
    edStruct(function () { ed.l = SP.dupLayer(ed.P, ed.l); }, 'Camada duplicada.');
  });
  $('lyUp').addEventListener('click', function () { edStruct(function () { var n = SP.moveLayer(ed.P, ed.l, 1); if (n < 0) return false; ed.l = n; }); });
  $('lyDown').addEventListener('click', function () { edStruct(function () { var n = SP.moveLayer(ed.P, ed.l, -1); if (n < 0) return false; ed.l = n; }); });
  $('lyMerge').addEventListener('click', function () {
    edStruct(function () { if (!SP.mergeDown(ed.P, ed.l)) return false; ed.l -= 1; }, 'Camada mesclada com a de baixo.');
  });
  $('lyDel').addEventListener('click', function () {
    edStruct(function () { if (!SP.removeLayer(ed.P, ed.l)) return false; }, 'Camada excluída. Use Desfazer para voltar.');
  });

  // frames
  $('frNew').addEventListener('click', function () {
    if (ed.P.frames.length >= 64) { edSay('O limite é de 64 frames.'); return; }
    edStruct(function () { ed.f = SP.addFrame(ed.P, ed.f + 1); }, 'Frame novo em branco.');
  });
  $('frDup').addEventListener('click', function () {
    if (ed.P.frames.length >= 64) { edSay('O limite é de 64 frames.'); return; }
    edStruct(function () { ed.f = SP.addFrame(ed.P, ed.f + 1, ed.f); }, 'Frame duplicado. Mude o novo frame para criar o movimento.');
  });
  $('frLeft').addEventListener('click', function () { edStruct(function () { var n = SP.moveFrame(ed.P, ed.f, -1); if (n < 0) return false; ed.f = n; }); });
  $('frRight').addEventListener('click', function () { edStruct(function () { var n = SP.moveFrame(ed.P, ed.f, 1); if (n < 0) return false; ed.f = n; }); });
  $('frDel').addEventListener('click', function () {
    edStruct(function () { if (!SP.removeFrame(ed.P, ed.f)) return false; }, 'Frame excluído. Use Desfazer para voltar.');
  });
  $('frPlay').addEventListener('click', function () { if (ed.playing) edStop(); else edPlay(); });
  $('edFps').addEventListener('input', function () {
    ed.P.fps = clamp(parseInt(this.value, 10) || 8, 1, 24); $('edFpsOut').textContent = ed.P.fps + ' fps'; edPreview(ed.playing ? ed.playF : undefined); edSaveSoon();
  });

  // tela
  $('edResize').addEventListener('click', function () {
    var w = clamp(parseInt($('edW').value, 10) || ed.P.w, 1, 256), h = clamp(parseInt($('edH').value, 10) || ed.P.h, 1, 256);
    $('edW').value = w; $('edH').value = h;
    if (w === ed.P.w && h === ed.P.h) return;
    edStruct(function () { SP.mapCels(ed.P, function (c) { return SP.resize(c, w, h); }, w, h); }, 'Tela agora com ' + w + ' × ' + h + ' px.');
  });
  $('edNew').addEventListener('click', function () {
    edConfirm('new', this, 'Nova tela em branco', function () {
      var w = clamp(parseInt($('edW').value, 10) || 64, 1, 256), h = clamp(parseInt($('edH').value, 10) || 48, 1, 256);
      edSetProject(SP.project(w, h)); edSaveSoon(); edSay('Tela em branco de ' + w + ' × ' + h + ' px.');
    });
  });
  $('spClear').addEventListener('click', function () {
    var before = SP.clone(cel());
    cel().data.fill(0);
    var e = SP.diff(before, cel());
    if (e) ed.hist.pushPx(ed.f, ed.l, e);
    edRefresh(); edSaveSoon(); edSay('Camada limpa neste frame. Use Desfazer para voltar.');
  });
  $('edFlipH').addEventListener('click', function () { edStruct(function () { SP.mapCels(ed.P, SP.flipH); }, 'Sprite espelhado na horizontal.'); });
  $('edFlipV').addEventListener('click', function () { edStruct(function () { SP.mapCels(ed.P, SP.flipV); }, 'Sprite espelhado na vertical.'); });

  // abrir
  function sheetN() { return clamp(parseInt($('edSheetN').value, 10) || 1, 1, 64); }
  // Corta uma imagem em n frames lado a lado e monta o projeto.
  function projectFromImage(im, n) {
    if (n < 2 || im.w % n !== 0) n = 1;
    var fw = im.w / n, P = SP.project(Math.min(fw, 256), Math.min(im.h, 256));
    P.frames = [];
    for (var f = 0; f < n; f++) {
      var c = SP.create(P.w, P.h);
      for (var y = 0; y < P.h; y++) for (var x = 0; x < P.w; x++) {
        var si = (y * im.w + f * fw + x) * 4;
        SP.set(c, x, y, [im.data[si], im.data[si + 1], im.data[si + 2], im.data[si + 3]]);
      }
      P.frames.push({ cels: [c] });
    }
    return { P: P, n: n, cut: fw > 256 || im.h > 256 };
  }
  function openImage(im, what) {
    var n = sheetN(), r = projectFromImage(im, n), msg = what + ' (' + r.P.w + ' × ' + r.P.h + ' px';
    msg += r.n > 1 ? ', ' + r.n + ' frames).' : ').';
    if (n > 1 && r.n === 1) msg += ' A largura da imagem não divide por ' + n + ', então abri como um frame só.';
    if (r.cut) msg += ' Passava de 256 px, então foi cortada.';
    edSetProject(r.P); edSaveSoon(); edSay(msg);
  }
  $('edFromCar').addEventListener('click', function () {
    if (!stat) { edSay('Gere um carro no Gerador primeiro.'); return; }
    var self = this;
    edConfirm('car', self, 'Carro do gerador', function () {
      var d = SP.fromImage(stat.img);
      edSetProject(SP.projectFromDoc(d)); edSaveSoon();
      edSay('Carro do gerador aberto (' + d.w + ' × ' + d.h + ' px). Pode retocar à vontade.' + (stat.img.w > 256 || stat.img.h > 256 ? ' Atenção: o editor aceita até 256 px, o resto foi cortado.' : ''));
    });
  });
  $('edFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    var url = URL.createObjectURL(f);
    imageFromUrl(url, function (im) {
      URL.revokeObjectURL(url);
      if (!im) { edSay('Não consegui abrir essa imagem.'); return; }
      openImage(im, 'Imagem aberta');
    });
  });
  function edGaragePicker() {
    var box = $('edGarage'); box.textContent = '';
    if (!garage.length) { var p = document.createElement('span'); p.className = 'note'; p.textContent = 'A garagem está vazia.'; box.appendChild(p); return; }
    garage.forEach(function (it, idx) {
      var b = document.createElement('button'); b.type = 'button'; b.title = 'Abrir este carro no editor'; b.setAttribute('aria-label', 'Abrir o carro ' + (idx + 1) + ' da garagem');
      var im = document.createElement('img'); im.src = it.url; im.alt = ''; b.appendChild(im);
      b.addEventListener('click', function () {
        var key = 'g' + it.id;
        if (ed.armed !== key && edHasInk()) {
          ed.armed = key; clearTimeout(ed.armedTimer);
          ed.armedTimer = setTimeout(function () { ed.armed = null; }, 3000);
          edSay('Isso troca o desenho atual. Clique de novo no mesmo carro para confirmar.');
          return;
        }
        ed.armed = null;
        imageFromUrl(it.url, function (img) {
          if (!img) { edSay('Não consegui abrir esse carro.'); return; }
          edSetProject(SP.projectFromDoc(SP.fromImage(img))); edSaveSoon(); edSay('Carro da garagem aberto no editor.');
        });
      });
      box.appendChild(b);
    });
  }

  // salvar
  function edFileName() { return ($('edName').value || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'meu-sprite'; }
  function edSuffix() { return ed.scale > 1 ? '-' + ed.scale + 'x' : ''; }
  function edSaveBlob(blob, name, type) {
    saveData(blob, name, type, function (n, msg) { edSay(n ? 'Arquivo ' + n + ' salvo.' : msg); });
  }
  $('edSave').addEventListener('click', function () {
    var c = scaleCanvas(toCanvas(edFrameImg()), ed.scale), multi = ed.P.frames.length > 1;
    canvasToBlob(c).then(function (blob) { edSaveBlob(blob, edFileName() + (multi ? '-frame' + (ed.f + 1) : '') + edSuffix() + '.png', 'image/png'); });
  });
  $('edSaveSheet').addEventListener('click', function () {
    var c = scaleCanvas(toCanvas(SP.sheetImage(ed.P)), ed.scale);
    canvasToBlob(c).then(function (blob) { edSaveBlob(blob, edFileName() + '-folha' + edSuffix() + '.png', 'image/png'); });
  });
  $('edSaveGif').addEventListener('click', function () {
    if (ed.P.frames.length < 2) { edSay('Crie mais de um frame para gerar o GIF.'); return; }
    var frames = SP.frameImages(ed.P).map(function (im) { return scaleImg(im, ed.scale); });
    var bytes = E.encodeGif(frames, { delay: Math.round(100 / ed.P.fps), transparent: true });
    edSaveBlob(new Blob([bytes], { type: 'image/gif' }), edFileName() + edSuffix() + '.gif', 'image/gif');
  });
  $('edToGarage').addEventListener('click', function () {
    if (!edHasInk()) { edSay('Desenhe alguma coisa antes de enviar.'); return; }
    var dropped = pushGarage(edFrameImg(), null);
    saveGarage(); renderGarage(); edGaragePicker();
    edSay(dropped ? 'Enviado para a garagem (frame ' + (ed.f + 1) + '). O mais antigo saiu para caber.' : 'Frame ' + (ed.f + 1) + ' enviado para a garagem.');
  });
  $('edName').addEventListener('input', edSaveSoon);

  document.addEventListener('keydown', function (ev) {
    if ($('edView').hidden) return;
    var tg = ev.target && ev.target.tagName, ty = ev.target && ev.target.type;
    if (tg === 'SELECT' || tg === 'TEXTAREA' || (tg === 'INPUT' && (ty === 'text' || ty === 'number'))) return;
    var k = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); if (ev.shiftKey) edRedo(); else edUndo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && k === 'y') { ev.preventDefault(); edRedo(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var map = { b: 'pencil', e: 'eraser', g: 'bucket', i: 'picker', l: 'line', r: 'rect', o: 'ellipse' };
    if (map[k]) { edSetTool(map[k]); return; }
    if (k === '+' || k === '=') edStep(1); else if (k === '-') edStep(-1); else if (k === '0') edSetZoom('auto');
    else if (k === ',') edGoFrame(ed.f - 1); else if (k === '.') edGoFrame(ed.f + 1);
    else if (k === 'p') { if (ed.playing) edStop(); else edPlay(); }
  });

  var edStarted = false;
  function showView(v) {
    var isEd = v === 'ed';
    $('genView').hidden = isEd; $('edView').hidden = !isEd;
    $('tabGen').setAttribute('aria-pressed', String(!isEd)); $('tabEd').setAttribute('aria-pressed', String(isEd));
    if (isEd) {
      if (!edStarted) { edStarted = true; edLoadSaved(); }
      edGaragePicker(); edLayout(); edRefresh();
    } else edStop();
    try { history.replaceState(null, '', isEd ? '#editor' : location.pathname + location.search); } catch (e) { /* ignore */ }
  }
  $('tabGen').addEventListener('click', function () { showView('gen'); });
  $('tabEd').addEventListener('click', function () { showView('ed'); });
  edSetColor(ed.color); edPalette(); edLayout(); edDraw(); renderLayers(); renderFrames(); edPreview();
