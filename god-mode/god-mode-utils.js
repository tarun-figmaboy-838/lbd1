/* ==========================================================================
 * god-mode-utils.js -- shared primitives for every God Mode module
 *
 * Loaded first; everything else depends on window.GodModeUtils.
 *
 * Stage space: the game is designed on a fixed 1920x1080 grid and drawn through
 * `#stage { transform: scale(s) }`, where s = viewport / canvas. Every number
 * God Mode shows or writes is in that design space, so a value copied out of the
 * editor drops straight into data.js regardless of browser zoom or viewport.
 * ======================================================================== */
'use strict';

window.GodModeUtils = (function () {

  function qa(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /** True when a keydown came from a field, so shortcuts never eat typing. */
  function isTypingInField(e) {
    var t = e && e.target;
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' ||
      t.isContentEditable === true;
  }

  /** Clipboard write with the textarea/execCommand fallback for file:// pages. */
  function copyText(text) {
    var s = String(text == null ? '' : text);
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(s).catch(function () { return legacy(s); });
    }
    return Promise.resolve(legacy(s));
  }
  function legacy(s) {
    var ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  // -------------------------------------------------------------- stage math
  function getStage() { return document.getElementById('stage') || document.body; }

  /** The CanvasScaler factor. Read from the engine when it is available. */
  function stageScale() {
    if (window.Engine && Engine.scale) {
      var s = Engine.scale();
      if (s > 0) return s;
    }
    var st = getStage();
    var r = st.getBoundingClientRect();
    return r.width > 0 && st.offsetWidth > 0 ? r.width / st.offsetWidth : 1;
  }

  function stageSize() {
    if (window.Engine && Engine.stageSize) return Engine.stageSize();
    return [1920, 1080];
  }

  /** A DOM element's viewport rect converted into stage space. */
  function stageRectOf(el) {
    var s = stageScale();
    var st = getStage().getBoundingClientRect();
    var r = el.getBoundingClientRect();
    return {
      x: (r.left - st.left) / s, y: (r.top - st.top) / s,
      w: r.width / s, h: r.height / s
    };
  }

  /** A viewport point in stage space. */
  function toStagePoint(clientX, clientY) {
    var s = stageScale();
    var st = getStage().getBoundingClientRect();
    return { x: (clientX - st.left) / s, y: (clientY - st.top) / s };
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.hidden) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) < 0.02) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  }

  function round(v, dp) {
    var m = Math.pow(10, dp == null ? 2 : dp);
    return Math.round(v * m) / m;
  }

  // ------------------------------------------------------------ node access
  /** The live game handle, whichever alias main.js exposed. */
  function game() { return window.lbd1Game || window.__game || null; }

  /** Every engine node record, in creation (draw) order. */
  function nodes() {
    if (!window.Engine || !Engine.order) return [];
    return Engine.order().map(function (id) { return Engine.get(id); })
      .filter(Boolean);
  }

  /** `/GamePlay/BackGround/Top/ChatBox` style path for a node record. */
  function pathOf(rec) {
    var parts = [], n = rec;
    while (n) { parts.unshift(n.data.name == null ? '?' : n.data.name); n = n.parent; }
    return '/' + parts.join('/');
  }

  function toast(msg, ms) {
    var el = qa('#godToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'godToast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(el.__t);
    el.__t = setTimeout(function () { el.classList.remove('on'); }, ms || 1500);
  }

  return {
    qa: qa, qsa: qsa, isTypingInField: isTypingInField,
    copyText: copyText, download: download,
    getStage: getStage, stageScale: stageScale, stageSize: stageSize,
    stageRectOf: stageRectOf, toStagePoint: toStagePoint,
    isVisible: isVisible, round: round,
    game: game, nodes: nodes, pathOf: pathOf, toast: toast
  };
})();
