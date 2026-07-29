/* ==========================================================================
 * god-mode-live-editor.js -- Figma-style direct-manipulation layout editor
 *
 * Pick any element on screen, drag it, resize it from eight handles, or type
 * exact numbers, then export the result as layout JSON that tools/apply_layout.js
 * writes back into js/data.js.
 *
 * Why it edits RectTransform fields and not CSS
 * ---------------------------------------------
 * Geometry in this build is not authored in CSS -- engine.js computes
 *   size   = (aMax - aMin) * parent + sizeDelta
 *   corner = aMin * parent + anchoredPosition - sizeDelta * pivot
 * per axis, from data.js. So a drag has to move `anchoredPosition` and a resize
 * has to change `sizeDelta`; writing `style.left` would be overwritten on the
 * next relayout (any resize, or any grid/layout-group reflow) and would not
 * survive an export. Both are applied through the engine so the whole subtree
 * re-lays-out exactly as it does at boot.
 *
 * Unity's Y axis points up from the bottom-left of the parent rect; the browser's
 * points down from the top-left. Vertical drags are therefore negated once, here,
 * so a downward drag lowers `anchoredPosition.y` -- which is what data.js expects.
 * ======================================================================== */
'use strict';

window.GodModeLiveEditor = function () {
  var U = window.GodModeUtils;
  var E = null;                          // resolved on init

  var HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  var GRID = 10;                         // snap step, stage px
  var MIN_SIZE = 8;                      // stage px, per axis
  var STORE_KEY = 'lbd1GodLayout';

  var sel = null;                        // selected node record
  var cursorEdit = false, snap = false, locked = false;
  var drag = null;                       // active gesture
  var edited = Object.create(null);      // id -> original {ap, sd, scale, rotZ, fontSize, text}
  var ghosts = [];
  var box = null, label = null, hover = null;
  var ui = {};

  // ------------------------------------------------------------------ setup
  function init() {
    E = window.Engine;
    buildChrome();
    cacheUi();
    bindUi();
    buildTargetList();
    document.addEventListener('pointerdown', onStagePointerDown, true);
    document.addEventListener('pointermove', onHoverMove, true);
    document.addEventListener('click', swallowClick, true);
    window.addEventListener('resize', function () { if (sel) drawBox(); });
    if (E && E.onTick) E.onTick(function () { if (sel && !drag) drawBox(); });
  }

  function buildChrome() {
    box = document.createElement('div');
    box.id = 'godSelBox';
    label = document.createElement('div');
    label.id = 'godSelLabel';
    box.appendChild(label);
    HANDLES.forEach(function (h) {
      var el = document.createElement('div');
      el.className = 'godHandle';
      el.dataset.h = h;
      el.addEventListener('pointerdown', onHandleDown);
      box.appendChild(el);
    });
    document.body.appendChild(box);

    hover = document.createElement('div');
    hover.id = 'godHover';
    document.body.appendChild(hover);
  }

  function cacheUi() {
    ['godTargetSel', 'godSelInfo', 'godX', 'godY', 'godW', 'godH', 'godScale',
     'godRot', 'godFont', 'godZ', 'godOpacity', 'godText', 'godCursorEdit',
     'godSnap', 'godLock', 'godEditCount'].forEach(function (id) {
      ui[id] = document.getElementById(id);
    });
  }

  // -------------------------------------------------------------- targeting
  /**
   * Every node carrying an Image, a TMP text or a Button is selectable, which is
   * how "all assets and elements including text" stays true without a hand-kept
   * registry -- the list is the live scene graph.
   */
  function targets() {
    return U.nodes().filter(function (r) {
      return !!(r.img || r.tmp || r.btn) && !r.isRootCanvas;
    });
  }

  function buildTargetList() {
    var s = ui.godTargetSel;
    if (!s) return;
    var keep = s.value;
    s.innerHTML = '<option value="">— pick an element —</option>';
    targets().forEach(function (r) {
      var o = document.createElement('option');
      o.value = r.id;
      var kind = r.tmp ? 'text' : r.btn ? 'button' : 'image';
      o.textContent = (r.activeSelf ? '' : '· ') + U.pathOf(r).replace(/^\//, '') +
        '  [' + kind + ']';
      s.appendChild(o);
    });
    if (keep) s.value = keep;
  }

  /**
   * Topmost selectable node under a viewport point.
   *
   * elementsFromPoint() is no use for the game layer: engine.js sets
   * `pointer-events: none` on every Image whose Unity raycast flag is false --
   * which is nearly all of the artwork -- and the browser's hit test honours
   * that, so those nodes are invisible to it. A design tool has to be able to
   * grab them anyway, so geometry is tested directly, walking Engine.order() in
   * reverse (creation order is DOM order is paint order, so the last match on
   * top wins).
   *
   * God Mode chrome does accept pointer events, so the normal hit test is still
   * the right way to detect it: a handle means "this is a resize, not a move",
   * and a panel is a hard blocker.
   */
  function hitTest(x, y) {
    var top = document.elementFromPoint(x, y);
    if (top && top.closest) {
      if (top.closest('.godHandle')) return null;
      if (top.closest('.godPanel, #godBadge, #godToast, #preloader, #rotateVeil')) return null;
    }
    var reveal = document.body.classList.contains('godRevealInactive');
    var list = targets();
    for (var i = list.length - 1; i >= 0; i--) {
      var rec = list[i];
      if (!reveal && !E.isActiveInHierarchy(rec.id)) continue;
      var r = rec.el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return rec;
    }
    return null;
  }

  // -------------------------------------------------------------- selection
  function select(rec) {
    sel = rec || null;
    locked = false;
    box.classList.toggle('locked', false);
    if (ui.godLock) ui.godLock.classList.remove('godOn');
    if (!sel) { box.classList.remove('on'); return; }
    captureOriginal(sel);
    if (ui.godTargetSel) ui.godTargetSel.value = sel.id;
    syncFields();
    drawBox();
    document.dispatchEvent(new CustomEvent('godEditorSelectionChanged', {
      detail: { element: sel.el, id: sel.id, name: sel.data.name, path: U.pathOf(sel) }
    }));
  }

  function selectById(id) { select(E.get(id)); }

  /** Snapshot the serialized values once, so Reset is exact. */
  function captureOriginal(rec) {
    if (edited[rec.id]) return;
    edited[rec.id] = {
      ap: (rec.posOverride || rec.data.anchoredPosition || [0, 0]).slice(),
      sd: (rec.data.sizeDelta || [0, 0]).slice(),
      scale: rec.scale.slice(),
      rotZ: rec.rotZ,
      fontSize: rec.tmp ? rec.tmp.fontSize : null,
      autoSize: rec.tmp ? rec.tmp.autoSize : null,
      text: rec.tmpEl ? rec.tmpEl.textContent : null,
      zIndex: rec.el.style.zIndex,
      opacity: rec.el.style.opacity,
      touched: false
    };
    updateEditCount();
  }

  function markTouched() {
    if (sel && edited[sel.id]) { edited[sel.id].touched = true; updateEditCount(); }
  }

  function updateEditCount() {
    if (!ui.godEditCount) return;
    var n = Object.keys(edited).filter(function (k) { return edited[k].touched; }).length;
    ui.godEditCount.textContent = n + ' edited';
  }

  function drawBox() {
    if (!sel) return;
    var r = sel.el.getBoundingClientRect();
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    box.classList.add('on');
    var sr = stageGeom(sel);
    label.textContent = sel.data.name + '  ' +
      U.round(sr.x, 1) + ', ' + U.round(sr.y, 1) + '  ' +
      U.round(sr.w, 1) + '×' + U.round(sr.h, 1);
  }

  /** anchoredPosition / sizeDelta as currently applied. */
  function stageGeom(rec) {
    var ap = rec.posOverride || rec.data.anchoredPosition || [0, 0];
    var sd = rec.data.sizeDelta || [0, 0];
    return { x: ap[0], y: ap[1], w: sd[0], h: sd[1] };
  }

  function syncFields() {
    if (!sel) return;
    var g = stageGeom(sel);
    setVal(ui.godX, U.round(g.x, 2));
    setVal(ui.godY, U.round(g.y, 2));
    setVal(ui.godW, U.round(g.w, 2));
    setVal(ui.godH, U.round(g.h, 2));
    setVal(ui.godScale, U.round(sel.scale[0], 3));
    setVal(ui.godRot, U.round(sel.rotZ, 2));
    setVal(ui.godFont, sel.tmp ? U.round(sel.tmp.fontSize, 2) : '');
    setVal(ui.godZ, sel.el.style.zIndex || '');
    setVal(ui.godOpacity, sel.el.style.opacity === '' ? 1 : sel.el.style.opacity);
    if (ui.godText) ui.godText.value = sel.tmpEl ? sel.tmpEl.textContent : '';
    if (ui.godSelInfo) {
      var rect = U.stageRectOf(sel.el);
      ui.godSelInfo.textContent = U.pathOf(sel) + '\nid ' + sel.id +
        '  ·  on-stage ' + U.round(rect.x, 1) + ', ' + U.round(rect.y, 1) +
        '  ' + U.round(rect.w, 1) + '×' + U.round(rect.h, 1) +
        (sel.activeSelf ? '' : '  ·  INACTIVE');
    }
    if (ui.godFont) ui.godFont.disabled = !sel.tmp;
    if (ui.godText) ui.godText.disabled = !sel.tmpEl;
  }
  function setVal(el, v) { if (el && document.activeElement !== el) el.value = v; }

  // ----------------------------------------------------------- apply values
  function applyPos(x, y) {
    if (!sel) return;
    E.setAnchoredPos(sel.id, x, y);
    sel.data.anchoredPosition = [x, y];   // keep data and override in step
    markTouched(); drawBox(); syncFields();
  }
  function applySize(w, h) {
    if (!sel || !sel.data.rect) return;
    E.setSizeDelta(sel.id, Math.max(MIN_SIZE, w), Math.max(MIN_SIZE, h));
    markTouched(); drawBox(); syncFields();
  }

  // -------------------------------------------------------------- gestures
  function onStagePointerDown(e) {
    if (!document.body.classList.contains('godMode')) return;
    if (e.target.closest && e.target.closest('.godPanel, #godSelBox, #godBadge')) return;
    if (!cursorEdit) return;
    var rec = hitTest(e.clientX, e.clientY);
    if (!rec) return;
    e.preventDefault();
    e.stopPropagation();
    if (!sel || sel.id !== rec.id) select(rec);
    if (locked) return;
    var g = stageGeom(sel);
    var p = U.toStagePoint(e.clientX, e.clientY);
    drag = { kind: 'move', p0: p, ap0: [g.x, g.y], moved: false };
    document.body.classList.add('godDragging');
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }

  function onHandleDown(e) {
    if (!sel || locked) return;
    e.preventDefault();
    e.stopPropagation();
    var g = stageGeom(sel);
    drag = {
      kind: 'resize', h: e.currentTarget.dataset.h,
      p0: U.toStagePoint(e.clientX, e.clientY),
      ap0: [g.x, g.y], sd0: [g.w, g.h],
      pivot: sel.data.pivot || [0.5, 0.5],
      scale: [sel.scale[0] || 1, sel.scale[1] || 1],
      moved: false
    };
    document.body.classList.add('godDragging');
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }

  function onDragMove(e) {
    if (!drag || !sel) return;
    var p = U.toStagePoint(e.clientX, e.clientY);
    var dx = p.x - drag.p0.x;
    var dy = p.y - drag.p0.y;
    var doSnap = snap || e.shiftKey;
    drag.moved = true;

    if (drag.kind === 'move') {
      // Unity Y is up, the browser's is down -- negate once, right here.
      var nx = drag.ap0[0] + dx;
      var ny = drag.ap0[1] - dy;
      if (doSnap) { nx = Math.round(nx / GRID) * GRID; ny = Math.round(ny / GRID) * GRID; }
      applyPos(nx, ny);
      return;
    }

    // Resize: the grabbed edge follows the cursor and the opposite edge stays
    // pinned on screen.
    //
    // Two corrections are needed because engine.js lays the node out at its
    // sizeDelta and *then* applies localScale about the pivot
    // (transform-origin: pivot). Writing the raw pointer delta into sizeDelta on
    // a node scaled 1.5x made the box grow 1.5x too fast and dragged the
    // opposite corner along with it. With rendered edges written out:
    //
    //   left   = aMinX*pw + ap.x - sd.x*pv.x*e
    //   right  = left + sd.x*e
    //   top    = ph*(1-aMaxY) - ap.y - sd.y*(1-pv.y)*e
    //   bottom = top + sd.y*e            (e = this node's localScale on the axis)
    //
    // so holding an edge fixed gives  Δsd = delta / e  and an anchoredPosition
    // compensation of  Δsd * pivotShare * e.
    var h = drag.h;
    var ex = drag.scale[0] || 1, ey = drag.scale[1] || 1;
    var w = drag.sd0[0], hh = drag.sd0[1];
    var ax = drag.ap0[0], ay = drag.ap0[1];
    var pvx = drag.pivot[0], pvy = drag.pivot[1];

    if (h.indexOf('e') >= 0) { w = drag.sd0[0] + dx / ex; }
    if (h.indexOf('w') >= 0) { w = drag.sd0[0] - dx / ex; }
    if (h.indexOf('s') >= 0) { hh = drag.sd0[1] + dy / ey; }
    if (h.indexOf('n') >= 0) { hh = drag.sd0[1] - dy / ey; }
    if (doSnap) { w = Math.round(w / GRID) * GRID; hh = Math.round(hh / GRID) * GRID; }
    w = Math.max(MIN_SIZE, w);
    hh = Math.max(MIN_SIZE, hh);

    var gw = w - drag.sd0[0], gh = hh - drag.sd0[1];
    if (h.indexOf('e') >= 0) ax = drag.ap0[0] + gw * pvx * ex;
    if (h.indexOf('w') >= 0) ax = drag.ap0[0] - gw * (1 - pvx) * ex;
    // Unity Y is up: growing downward drops the bottom edge, so ap.y falls.
    if (h.indexOf('s') >= 0) ay = drag.ap0[1] - gh * (1 - pvy) * ey;
    if (h.indexOf('n') >= 0) ay = drag.ap0[1] + gh * pvy * ey;

    E.setSizeDelta(sel.id, w, hh);
    E.setAnchoredPos(sel.id, ax, ay);
    sel.data.anchoredPosition = [ax, ay];
    markTouched(); drawBox(); syncFields();
  }

  function onDragUp() {
    var moved = !!(drag && drag.moved);
    drag = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    document.body.classList.remove('godDragging');
    if (!moved) return;
    // the click that follows a drag must not also fire a game button
    pendingSwallow = true;
    setTimeout(function () { pendingSwallow = false; }, 250);
  }

  /** A pick or a drag must never also pop a bubble / fire a game button. */
  var pendingSwallow = false;
  function swallowClick(e) {
    if (!document.body.classList.contains('godMode')) return;
    if (e.target.closest && e.target.closest('.godPanel, #godSelBox')) return;
    if (cursorEdit || pendingSwallow) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onHoverMove(e) {
    if (!cursorEdit || drag) { hover.classList.remove('on'); return; }
    if (!document.body.classList.contains('godMode')) return;
    if (e.target.closest && e.target.closest('.godPanel, #godSelBox')) {
      hover.classList.remove('on'); return;
    }
    var rec = hitTest(e.clientX, e.clientY);
    if (!rec || (sel && rec.id === sel.id)) { hover.classList.remove('on'); return; }
    var r = rec.el.getBoundingClientRect();
    hover.style.left = r.left + 'px';
    hover.style.top = r.top + 'px';
    hover.style.width = r.width + 'px';
    hover.style.height = r.height + 'px';
    hover.classList.add('on');
  }

  // ------------------------------------------------------------- keyboard
  /** Arrow nudge in stage px: 1, or 10 with Shift. */
  function nudge(dxs, dys, big) {
    if (!sel || locked) return false;
    var g = stageGeom(sel);
    var step = big ? GRID : 1;
    applyPos(g.x + dxs * step, g.y + dys * step);
    return true;
  }

  // ------------------------------------------------------------------- ui
  function bindUi() {
    var on = function (id, ev, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    if (ui.godTargetSel) {
      ui.godTargetSel.addEventListener('change', function () {
        if (this.value) selectById(this.value);
      });
    }

    // numeric fields commit on input so dragging a number feels live
    var num = function (el, fn) {
      if (!el) return;
      el.addEventListener('input', function () {
        var v = parseFloat(el.value);
        if (isFinite(v)) fn(v);
      });
    };
    num(ui.godX, function (v) { var g = stageGeom(sel); applyPos(v, g.y); });
    num(ui.godY, function (v) { var g = stageGeom(sel); applyPos(g.x, v); });
    num(ui.godW, function (v) { var g = stageGeom(sel); applySize(v, g.h); });
    num(ui.godH, function (v) { var g = stageGeom(sel); applySize(g.w, v); });
    num(ui.godScale, function (v) {
      if (!sel) return; E.setScale(sel.id, v); markTouched(); drawBox();
    });
    num(ui.godRot, function (v) {
      if (!sel) return; E.setRotZ(sel.id, v); markTouched(); drawBox();
    });
    num(ui.godFont, function (v) {
      if (!sel || !sel.tmp) return; E.setFontSize(sel.id, v); markTouched(); drawBox();
    });
    num(ui.godOpacity, function (v) {
      if (!sel) return; sel.el.style.opacity = v; markTouched();
    });
    if (ui.godZ) {
      ui.godZ.addEventListener('input', function () {
        if (!sel) return; E.setZIndex(sel.id, ui.godZ.value); markTouched();
      });
    }

    on('godApplyText', 'click', function () {
      if (!sel || !ui.godText) return;
      E.setText(sel.id, ui.godText.value);
      markTouched(); drawBox();
      U.toast('Text applied');
    });

    on('godPick', 'click', function () { setCursorEdit(true); U.toast('Click any element'); });
    on('godCursorEdit', 'click', function () { setCursorEdit(!cursorEdit); });
    on('godSnap', 'click', function () {
      snap = !snap;
      ui.godSnap.classList.toggle('godOn', snap);
      U.toast('Snap ' + (snap ? 'on (10px grid)' : 'off'));
    });
    on('godLock', 'click', function () {
      if (!sel) return;
      locked = !locked;
      ui.godLock.classList.toggle('godOn', locked);
      box.classList.toggle('locked', locked);
    });
    on('godForward', 'click', function () { bumpZ(1); });
    on('godBackward', 'click', function () { bumpZ(-1); });
    on('godFitContent', 'click', fitContent);
    on('godGhost', 'click', duplicateGhost);
    on('godCenterX', 'click', function () { centerOn(0); });
    on('godCenterY', 'click', function () { centerOn(1); });
    on('godResetSel', 'click', function () { resetOne(sel && sel.id); syncFields(); drawBox(); });
    on('godResetAll', 'click', function () { resetAll(); U.toast('All edits reset'); });
    on('godCopySel', 'click', function () {
      U.copyText(reportOne(sel)).then(function () { U.toast('Values copied'); });
    });
    on('godCopyAll', 'click', function () {
      U.copyText(reportAll()).then(function () { U.toast('All edited values copied'); });
    });
    on('godExportJson', 'click', exportJson);
    on('godSaveTemp', 'click', saveTemp);
    on('godLoadTemp', 'click', loadTemp);
    on('godClearTemp', 'click', function () {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
      resetAll();
      U.toast('Saved layout cleared');
    });
    on('godRefreshList', 'click', function () { buildTargetList(); U.toast('Element list rebuilt'); });
  }

  function setCursorEdit(on) {
    cursorEdit = !!on;
    document.body.classList.toggle('godCursorEdit', cursorEdit);
    if (ui.godCursorEdit) ui.godCursorEdit.classList.toggle('godOn', cursorEdit);
    if (!cursorEdit) hover.classList.remove('on');
  }

  function bumpZ(d) {
    if (!sel) return;
    var cur = parseInt(sel.el.style.zIndex || '0', 10) || 0;
    E.setZIndex(sel.id, cur + d);
    markTouched(); syncFields();
  }

  /** Measure the intrinsic content size and write it into sizeDelta. */
  function fitContent() {
    if (!sel) return;
    var el = sel.tmpEl || sel.el;
    var prevW = sel.el.style.width, prevH = sel.el.style.height;
    sel.el.style.width = 'auto';
    sel.el.style.height = 'auto';
    var w = el.scrollWidth, h = el.scrollHeight;
    sel.el.style.width = prevW;
    sel.el.style.height = prevH;
    if (w > 0 && h > 0) applySize(w, h);
    U.toast('Fitted to ' + Math.round(w) + '×' + Math.round(h));
  }

  /** Centre inside the parent rect on one axis (0 = x, 1 = y). */
  function centerOn(axis) {
    if (!sel || !sel.data.rect) return;
    var d = sel.data;
    var parent = sel.parent;
    var pw = parent ? parent.w : U.stageSize()[0];
    var ph = parent ? parent.h : U.stageSize()[1];
    var g = stageGeom(sel);
    if (axis === 0) {
      var x = pw / 2 - sel.w / 2 - d.anchorMin[0] * pw + d.sizeDelta[0] * d.pivot[0];
      applyPos(x, g.y);
    } else {
      var y = ph / 2 - sel.h / 2 - d.anchorMin[1] * ph + d.sizeDelta[1] * d.pivot[1];
      applyPos(g.x, y);
    }
  }

  function duplicateGhost() {
    if (!sel) return;
    var clone = sel.el.cloneNode(true);
    clone.classList.add('godGhostClone');
    clone.style.opacity = '0.5';
    clone.style.pointerEvents = 'none';
    clone.style.left = (sel.left + 40) + 'px';
    clone.style.top = (sel.top + 40) + 'px';
    (sel.el.parentNode || document.body).appendChild(clone);
    ghosts.push(clone);
    setTimeout(function () { removeGhost(clone); }, 8000);
    U.toast('Ghost added (8s)');
  }
  function removeGhost(c) {
    var i = ghosts.indexOf(c);
    if (i >= 0) ghosts.splice(i, 1);
    if (c.parentNode) c.parentNode.removeChild(c);
  }

  // ---------------------------------------------------------------- reset
  function resetOne(id) {
    if (!id || !edited[id]) return;
    var o = edited[id], rec = E.get(id);
    if (!rec) return;
    rec.data.anchoredPosition = o.ap.slice();
    rec.posOverride = null;
    rec.data.sizeDelta = o.sd.slice();
    rec.scale = o.scale.slice();
    rec.rotZ = o.rotZ;
    if (rec.tmp && o.fontSize != null) {
      rec.tmp.fontSize = o.fontSize;
      rec.tmp.autoSize = o.autoSize;
      if (rec.tmpEl) rec.tmpEl.style.fontSize = o.fontSize + 'px';
    }
    if (rec.tmpEl && o.text != null) E.setText(id, o.text);
    rec.el.style.zIndex = o.zIndex;
    rec.el.style.opacity = o.opacity;
    E.setAnchoredPos(id, o.ap[0], o.ap[1]);
    rec.posOverride = null;
    E.relayout();
    delete edited[id];
    updateEditCount();
  }

  function resetAll() {
    Object.keys(edited).forEach(resetOne);
    ghosts.slice().forEach(removeGhost);
    setCursorEdit(false);
    locked = false;
    box.classList.remove('on', 'locked');
    hover.classList.remove('on');
    sel = null;
    if (ui.godTargetSel) ui.godTargetSel.value = '';
    if (ui.godSelInfo) ui.godSelInfo.textContent = 'nothing selected';
    updateEditCount();
    if (E && E.relayout) E.relayout();
  }

  // --------------------------------------------------------------- reports
  function reportOne(rec) {
    if (!rec) return '(nothing selected)';
    var g = stageGeom(rec);
    var out = [
      U.pathOf(rec),
      'id            ' + rec.id,
      'name          ' + rec.data.name,
      'anchoredPos   ' + U.round(g.x, 2) + ', ' + U.round(g.y, 2),
      'sizeDelta     ' + U.round(g.w, 2) + ', ' + U.round(g.h, 2),
      'anchorMin     ' + JSON.stringify(rec.data.anchorMin || null),
      'anchorMax     ' + JSON.stringify(rec.data.anchorMax || null),
      'pivot         ' + JSON.stringify(rec.data.pivot || null),
      'scale         ' + U.round(rec.scale[0], 3) + ', ' + U.round(rec.scale[1], 3),
      'rotZ          ' + U.round(rec.rotZ, 2)
    ];
    if (rec.tmp) out.push('fontSize      ' + U.round(rec.tmp.fontSize, 2));
    if (rec.img && rec.img.sprite) out.push('sprite        ' + rec.img.sprite.path);
    if (rec.tmpEl) {
      out.push('text          ' + JSON.stringify(rec.tmpEl.textContent.slice(0, 120)));
    }
    return out.join('\n');
  }

  function reportAll() {
    var ids = Object.keys(edited).filter(function (k) { return edited[k].touched; });
    if (!ids.length) return '(no edits yet)';
    return ids.map(function (id) { return reportOne(E.get(id)); })
      .join('\n' + new Array(48).join('-') + '\n');
  }

  // --------------------------------------------------------- layout JSON
  /**
   * The export carries only what tools/apply_layout.js needs to rewrite data.js:
   * the fileID, the serialized fields that changed, and enough identity
   * (name + path) for a human to audit the patch.
   */
  function layoutPayload() {
    var ids = Object.keys(edited).filter(function (k) { return edited[k].touched; });
    return {
      screen: 'lbd1',
      reference: [1920, 1080],
      note: 'anchoredPosition / sizeDelta are Unity RectTransform values in the ' +
        '1920x1080 design space; y is up from the parent rect bottom-left.',
      assets: ids.map(function (id) {
        var rec = E.get(id);
        var g = stageGeom(rec);
        var o = edited[id];
        var a = {
          id: id, name: rec.data.name, path: U.pathOf(rec),
          anchoredPosition: [U.round(g.x, 2), U.round(g.y, 2)],
          sizeDelta: [U.round(g.w, 2), U.round(g.h, 2)],
          was: { anchoredPosition: o.ap, sizeDelta: o.sd }
        };
        if (rec.scale[0] !== o.scale[0] || rec.scale[1] !== o.scale[1]) {
          a.scale = [U.round(rec.scale[0], 4), U.round(rec.scale[1], 4)];
        }
        if (rec.rotZ !== o.rotZ) a.rotZ = U.round(rec.rotZ, 3);
        if (rec.tmp && o.fontSize != null && rec.tmp.fontSize !== o.fontSize) {
          a.fontSize = U.round(rec.tmp.fontSize, 2);
        }
        if (rec.tmpEl && o.text != null && rec.tmpEl.textContent !== o.text) {
          a.text = rec.tmpEl.textContent;
        }
        return a;
      })
    };
  }

  function exportJson() {
    var payload = layoutPayload();
    if (!payload.assets.length) { U.toast('Nothing edited yet'); return; }
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    U.download('layout_lbd1_' + stamp + '.json', JSON.stringify(payload, null, 2));
    U.toast(payload.assets.length + ' element(s) exported');
  }

  function saveTemp() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(layoutPayload()));
      U.toast('Layout saved to localStorage');
    } catch (e) { U.toast('Save failed (storage blocked)'); }
  }

  function loadTemp() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    if (!raw) { U.toast('Nothing saved'); return; }
    var data;
    try { data = JSON.parse(raw); } catch (e) { U.toast('Saved layout is corrupt'); return; }
    (data.assets || []).forEach(function (a) {
      var rec = E.get(a.id);
      if (!rec) return;
      captureOriginal(rec);
      edited[a.id].touched = true;
      if (a.sizeDelta) E.setSizeDelta(a.id, a.sizeDelta[0], a.sizeDelta[1]);
      if (a.anchoredPosition) {
        E.setAnchoredPos(a.id, a.anchoredPosition[0], a.anchoredPosition[1]);
        rec.data.anchoredPosition = a.anchoredPosition.slice();
      }
      if (a.scale) E.setScale(a.id, a.scale[0], a.scale[1]);
      if (a.rotZ != null) E.setRotZ(a.id, a.rotZ);
      if (a.fontSize != null) E.setFontSize(a.id, a.fontSize);
      if (a.text != null) E.setText(a.id, a.text);
    });
    updateEditCount();
    if (sel) { syncFields(); drawBox(); }
    U.toast((data.assets || []).length + ' element(s) restored');
  }

  return {
    init: init, select: select, selectById: selectById,
    setCursorEdit: setCursorEdit, nudge: nudge,
    resetAll: resetAll, refresh: buildTargetList,
    copySelected: function () { return U.copyText(reportOne(sel)); },
    copyAll: function () { return U.copyText(reportAll()); },
    exportJson: exportJson,
    selected: function () { return sel; },
    isCursorEdit: function () { return cursorEdit; }
  };
};
