/* ==========================================================================
 * engine.js -- dependency-free uGUI runtime
 *
 * Reproduces the parts of Unity that these three games actually use:
 *   - RectTransform anchor/pivot/sizeDelta layout (exact, both axes independent)
 *   - CanvasScaler ScaleWithScreenSize / Expand boot scale
 *   - nested Canvas overrideSorting -> z-index
 *   - Image simple / sliced (9-slice) / tiled / filled, atlas crop, tint,
 *     linear->sRGB colour conversion, preserveAspect
 *   - TextMeshPro alignment / spacing / autosize approximation
 *   - GridLayoutGroup
 *   - Unity lifecycle (Awake / OnEnable / Start / Update / OnDisable)
 *   - cancellable coroutines, LeanTween + DOTween easing and tween kinds
 *   - AudioSource channels with browser unlock
 *   - ParticleSystem canvas approximation
 *
 * No framework, no build step, no fetch(). Layout/config are embedded by
 * data.js as window.LAYOUT / window.CONFIG.
 * ======================================================================== */
'use strict';

var Engine = (function () {

  // ------------------------------------------------------------------ state
  var stage = null, viewport = null, fxCanvas = null, fxCtx = null;
  var nodes = Object.create(null);      // id -> {id,data,el,parent,active,...}
  var order = [];                       // ids in creation (draw) order
  var refW = 1920, refH = 1080;
  var scaleMode = 1, matchMode = 1, match = 0.5, scaleFactor = 1;
  var colorSpace = 0;
  var canvasScale = 1, stageW = 1920, stageH = 1080;
  var resizeHooks = [], tickHooks = [];
  var audioUnlocked = false, pendingAudio = [];
  var rafId = null, lastT = 0;
  var particleSystems = [];

  // ------------------------------------------------------------ colour math
  // Unity Linear colour space: serialized Image/TMP colours are linear;
  // the browser composites in sRGB, so convert or everything reads too dark.
  function lin2srgb(c) {
    if (c <= 0) return 0;
    if (c <= 0.0031308) return c * 12.92;
    return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }
  function css(rgba) {
    if (!rgba) return 'rgba(255,255,255,1)';
    var r = rgba[0], g = rgba[1], b = rgba[2], a = rgba.length > 3 ? rgba[3] : 1;
    if (colorSpace === 1) { r = lin2srgb(r); g = lin2srgb(g); b = lin2srgb(b); }
    return 'rgba(' + Math.round(clamp01(r) * 255) + ',' +
      Math.round(clamp01(g) * 255) + ',' + Math.round(clamp01(b) * 255) + ',' +
      (Math.round(clamp01(a) * 1000) / 1000) + ')';
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function isWhite(c) {
    return !c || (c[0] >= 0.999 && c[1] >= 0.999 && c[2] >= 0.999);
  }

  // ------------------------------------------------------------------ easing
  // LeanTween / DOTween easing. Names accept either library's spelling.
  var E = {
    linear: function (t) { return t; },
    inQuad: function (t) { return t * t; },
    outQuad: function (t) { return t * (2 - t); },
    inOutQuad: function (t) {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    },
    inCubic: function (t) { return t * t * t; },
    outCubic: function (t) { return (--t) * t * t + 1; },
    inOutCubic: function (t) {
      return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
    },
    inSine: function (t) { return 1 - Math.cos(t * Math.PI / 2); },
    outSine: function (t) { return Math.sin(t * Math.PI / 2); },
    inOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
    inBack: function (t) { var s = 1.70158; return t * t * ((s + 1) * t - s); },
    outBack: function (t) {
      var s = 1.70158; t -= 1; return t * t * ((s + 1) * t + s) + 1;
    },
    inOutBack: function (t) {
      var s = 1.70158 * 1.525;
      if ((t *= 2) < 1) return 0.5 * (t * t * ((s + 1) * t - s));
      return 0.5 * ((t -= 2) * t * ((s + 1) * t + s) + 2);
    },
    outElastic: function (t) {
      if (t === 0 || t === 1) return t;
      var p = 0.3, s = p / 4;
      return Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1;
    },
    outBounce: function (t) {
      if (t < 1 / 2.75) return 7.5625 * t * t;
      if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
      if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
      t -= 2.625 / 2.75; return 7.5625 * t * t + 0.984375;
    }
  };
  var EASE_ALIAS = {
    'Linear': 'linear', 'easeLinear': 'linear',
    'InQuad': 'inQuad', 'easeInQuad': 'inQuad',
    'OutQuad': 'outQuad', 'easeOutQuad': 'outQuad',
    'InOutQuad': 'inOutQuad', 'easeInOutQuad': 'inOutQuad',
    'InSine': 'inSine', 'easeInSine': 'inSine',
    'OutSine': 'outSine', 'easeOutSine': 'outSine',
    'InOutSine': 'inOutSine', 'easeInOutSine': 'inOutSine',
    'InBack': 'inBack', 'easeInBack': 'inBack',
    'OutBack': 'outBack', 'easeOutBack': 'outBack',
    'InOutBack': 'inOutBack', 'easeInOutBack': 'inOutBack',
    'OutElastic': 'outElastic', 'easeOutElastic': 'outElastic',
    'InCubic': 'inCubic', 'OutCubic': 'outCubic', 'InOutCubic': 'inOutCubic'
  };
  function ease(name) {
    if (typeof name === 'function') return name;
    if (!name) return E.linear;
    return E[EASE_ALIAS[name] || name] || E.linear;
  }

  // ------------------------------------------------------- task groups
  // Replicates StopAllCoroutines / DOTween.Kill semantics: every timer and
  // tween belongs to a token, and cancelling a token kills all of them.
  var groupSeq = 0;
  function TaskGroup(owner) {
    this.owner = owner || ('g' + (++groupSeq));
    this.cancelled = false;
    this.timers = [];
    this.tweens = [];
  }
  TaskGroup.prototype.wait = function (sec) {
    var self = this;
    return new Promise(function (res) {
      if (self.cancelled) return;             // never resolves -> chain stops
      var id = setTimeout(function () {
        var i = self.timers.indexOf(id);
        if (i >= 0) self.timers.splice(i, 1);
        if (!self.cancelled) res();
      }, Math.max(0, sec * 1000));
      self.timers.push(id);
    });
  };
  TaskGroup.prototype.tween = function (dur, easeName, apply, onDone) {
    var self = this;
    if (self.cancelled) return Promise.resolve();
    var fn = ease(easeName);
    return new Promise(function (res) {
      var t0 = null, rec = { alive: true };
      self.tweens.push(rec);
      function step(ts) {
        if (!rec.alive || self.cancelled) return;
        if (t0 === null) t0 = ts;
        var k = dur <= 0 ? 1 : Math.min(1, (ts - t0) / (dur * 1000));
        try { apply(fn(k), k); } catch (e) { logErr(e); }
        if (k < 1) { rec.raf = requestAnimationFrame(step); }
        else {
          rec.alive = false;
          var i = self.tweens.indexOf(rec);
          if (i >= 0) self.tweens.splice(i, 1);
          if (onDone) { try { onDone(); } catch (e) { logErr(e); } }
          res();
        }
      }
      rec.raf = requestAnimationFrame(step);
    });
  };
  TaskGroup.prototype.delayedCall = function (sec, fn) {
    return this.wait(sec).then(function () { fn(); });
  };
  TaskGroup.prototype.cancel = function () {
    this.cancelled = true;
    for (var i = 0; i < this.timers.length; i++) clearTimeout(this.timers[i]);
    this.timers.length = 0;
    for (var j = 0; j < this.tweens.length; j++) {
      this.tweens[j].alive = false;
      if (this.tweens[j].raf) cancelAnimationFrame(this.tweens[j].raf);
    }
    this.tweens.length = 0;
  };
  TaskGroup.prototype.reset = function () { this.cancel(); this.cancelled = false; };
  // run a generator as a coroutine; `yield <number>` waits seconds,
  // `yield <promise>` awaits it. Cancelling the group stops it.
  TaskGroup.prototype.run = function (genFn) {
    var self = this, it = genFn();
    function pump(v) {
      if (self.cancelled) return Promise.resolve();
      var r;
      try { r = it.next(v); } catch (e) { logErr(e); return Promise.resolve(); }
      if (r.done) return Promise.resolve(r.value);
      var y = r.value;
      var p = (typeof y === 'number') ? self.wait(y)
        : (y && typeof y.then === 'function') ? y : Promise.resolve(y);
      return p.then(pump);
    }
    return pump();
  };

  function logErr(e) {
    if (typeof console !== 'undefined' && console.error) console.error(e);
  }

  // -------------------------------------------------------------- DOM build
  function el(tag, cls) {
    var d = document.createElement(tag || 'div');
    if (cls) d.className = cls;
    return d;
  }

  function buildNode(data, parentRec, depth) {
    var d = el('div', 'un');
    d.dataset.id = String(data.id);
    d.dataset.name = data.name == null ? '' : String(data.name);
    var rec = {
      id: String(data.id), data: data, el: d,
      parent: parentRec, children: [],
      activeSelf: !!data.active,
      img: null, tmp: null, btn: null, canvas: null, cg: null, sliced: false,
      grid: null, particles: null, rounded: null,
      audio: null, started: false, controllers: [],
      w: 0, h: 0, left: 0, top: 0,
      scale: (data.scale || [1, 1, 1]).slice(),
      rotZ: data.rotZ || 0,
      posOverride: null,   // {x,y} runtime anchoredPosition override
      alpha: 1
    };
    nodes[rec.id] = rec;
    order.push(rec.id);

    var comps = data.components || [];
    for (var i = 0; i < comps.length; i++) {
      var c = comps[i];
      switch (c.kind) {
        case 'Image': rec.img = c; break;
        case 'TMP': rec.tmp = c; break;
        case 'Button': rec.btn = c; break;
        case 'Canvas': rec.canvas = c; break;
        case 'CanvasGroup': rec.cg = c; break;
        case 'GridLayout': rec.grid = c; break;
        case 'HorizontalLayoutGroup': rec.hv = c; rec.hvAxis = 0; break;
        case 'VerticalLayoutGroup': rec.hv = c; rec.hvAxis = 1; break;
        case 'Particles': rec.particles = c; break;
        case 'RoundedCorners': rec.rounded = c; break;
        case 'AudioSource': rec.audio = c; break;
        default: break;
      }
    }

    // Unity drives the ROOT Canvas's RectTransform itself: the serialized
    // values are meaningless (sizeDelta 0,0 and localScale 0,0,0 here), so the
    // rect must be replaced with the canvas pixel size or nothing renders.
    if (rec.canvas) {
      var anc = parentRec, nested = false;
      while (anc) { if (anc.canvas) { nested = true; break; } anc = anc.parent; }
      rec.isRootCanvas = !nested;
      if (rec.isRootCanvas) { rec.scale = [1, 1, 1]; rec.rotZ = 0; }
    }

    applyGraphics(rec);

    if (!rec.activeSelf) d.classList.add('un-off');
    if (parentRec) parentRec.children.push(rec);
    (parentRec ? parentRec.el : stage).appendChild(d);

    var kids = data.children || [];
    for (var k = 0; k < kids.length; k++) buildNode(kids[k], rec, depth + 1);
    return rec;
  }

  // ------------------------------------------------------------- graphics
  function applyGraphics(rec) {
    var d = rec.el, img = rec.img, tmp = rec.tmp;

    // nested canvas that overrides sorting -> stacking context + z-index
    if (rec.canvas && rec.canvas.overrideSorting) {
      d.style.zIndex = String(rec.canvas.sortingOrder);
      d.style.isolation = 'isolate';
    }

    if (img && img.enabled) {
      paintImage(rec);
      if (!img.raycast) d.style.pointerEvents = 'none';
    } else if (!img && !tmp && !rec.btn) {
      d.style.pointerEvents = 'none';
    }

    if (rec.rounded && rec.rounded.enabled) {
      var rr = rec.rounded.radius.map(function (v) { return v + 'px'; }).join(' ');
      if (rec.imgEl) rec.imgEl.style.borderRadius = rr;
      d.style.borderRadius = rr;
      d.style.overflow = 'hidden';
    }

    if (tmp && tmp.enabled) {
      d.classList.add('un-tmp');
      var t = el('div', 'un-tmp-inner');
      rec.tmpEl = t;
      d.appendChild(t);
      var fam = tmp.font && tmp.font.family ? tmp.font.family : 'sans-serif';
      t.style.fontFamily = '"' + fam + '", sans-serif';
      t.style.fontSize = tmp.fontSize + 'px';
      var col = tmp.faceColor && tmp.faceColor.length ? tmp.faceColor : tmp.color;
      t.style.color = css(col);
      if (tmp.charSpacing) t.style.letterSpacing = (tmp.charSpacing / 100 * tmp.fontSize) + 'px';
      // TMP lineSpacing is a percentage of the font's line height
      t.style.lineHeight = (1 + (tmp.lineSpacing || 0) / 100) * 1.0 + 'em';
      t.style.whiteSpace = tmp.wrap ? 'pre-wrap' : 'pre';
      if (tmp.style & 1) t.style.fontWeight = 'bold';
      if (tmp.style & 2) t.style.fontStyle = 'italic';
      if (tmp.style & 4) t.style.textDecoration = 'underline';
      if (tmp.style & 8) t.style.textTransform = 'uppercase';
      if (tmp.outlineWidth > 0 && tmp.outlineColor) {
        var ow = (tmp.outlineWidth * tmp.fontSize * 0.1).toFixed(2);
        t.style.webkitTextStroke = ow + 'px ' + css(tmp.outlineColor);
        t.style.paintOrder = 'stroke fill';
      }
      // TMP horizontal alignment bitfield: 1 left, 2 center, 4 right,
      // 8 justified, 16 flush; vertical: 256 top, 512 middle, 1024 bottom
      d.style.display = 'flex';
      d.style.justifyContent = (tmp.alignH & 2) ? 'center'
        : (tmp.alignH & 4) ? 'flex-end' : 'flex-start';
      d.style.alignItems = (tmp.alignV & 512) ? 'center'
        : (tmp.alignV & 1024) ? 'flex-end' : 'flex-start';
      t.style.textAlign = (tmp.alignH & 2) ? 'center'
        : (tmp.alignH & 4) ? 'right' : 'left';
      var m = tmp.margin || [0, 0, 0, 0];
      d.style.paddingLeft = m[0] + 'px'; d.style.paddingTop = m[1] + 'px';
      d.style.paddingRight = m[2] + 'px'; d.style.paddingBottom = m[3] + 'px';
      if (!tmp.raycast) d.style.pointerEvents = 'none';
      setTextEl(rec, tmp.text);
    }

    if (rec.cg) {
      rec.alpha = rec.cg.alpha;
      d.style.opacity = rec.cg.alpha;
      if (!rec.cg.blocksRaycasts) d.style.pointerEvents = 'none';
    }

    if (rec.btn) {
      d.classList.add('un-btn');
      rec.interactable = rec.btn.interactable;
      if (!rec.interactable) d.classList.add('un-dis');
      d.style.cursor = 'pointer';
      d.style.pointerEvents = 'auto';
    }

    if (rec.particles) {
      particleSystems.push(rec);
      d.style.pointerEvents = 'none';
    }
  }

  /**
   * A Unity Image draws into its own layer, never onto the GameObject div, so
   * that a tint cannot affect child objects.
   *
   * Unity multiplies the sprite by m_Color. CSS background-blend-mode:multiply
   * reproduces that exactly and stays inside this layer -- an earlier version
   * used mask-image + background-color, which replaced the artwork with a flat
   * silhouette and also masked every child.
   */
  function ensureImgEl(rec) {
    if (rec.imgEl) return rec.imgEl;
    var d = el('div', 'un-img');
    rec.imgEl = d;
    rec.el.insertBefore(d, rec.el.firstChild);
    return d;
  }

  function hasBorder(s) {
    return s && (s.border[0] || s.border[1] || s.border[2] || s.border[3]);
  }

  function cropStyles(s) {
    if (!s || !s.crop) return null;
    var cw = s.crop[2], ch = s.crop[3];
    return {
      size: (100 / cw) + '% ' + (100 / ch) + '%',
      pos: (cw >= 1 ? 0 : (s.crop[0] / (1 - cw)) * 100) + '% ' +
        (ch >= 1 ? 0 : ((1 - s.crop[1] - ch) / (1 - ch)) * 100) + '%'
    };
  }

  function paintImage(rec) {
    var img = rec.img;
    if (!img) return;
    var d = ensureImgEl(rec);
    d.removeAttribute('style');
    rec.sliced = false;
    rec.preserveAspect = null;

    var s = img.sprite;
    var tint = img.color || [1, 1, 1, 1];
    var alpha = tint.length > 3 ? tint[3] : 1;
    var rgb = [tint[0], tint[1], tint[2]];
    if (alpha < 0.999) d.style.opacity = alpha;

    if (!s || !s.path) {
      // Unity draws a plain colour quad when the sprite is null or missing.
      d.style.backgroundColor = css(rgb);
    } else {
      var crop = cropStyles(s);
      if (img.type === 1 && hasBorder(s)) {
        var bl = s.border[0], bb = s.border[1], br = s.border[2], bt = s.border[3];
        var slice = [bt, br, bb, bl];
        d.style.borderImageSource = 'url("' + s.path + '")';
        d.style.borderImageSlice = slice.join(' ') + (img.fillCenter ? ' fill' : '');
        d.style.borderImageWidth = slice.map(function (v) { return v + 'px'; }).join(' ');
        d.style.borderImageRepeat = 'stretch';
        d.style.borderStyle = 'solid';
        d.style.borderColor = 'transparent';
        d.style.borderWidth = slice.map(function (v) { return v + 'px'; }).join(' ');
        rec.sliced = true;
        // border-image cannot blend with background-color; a non-white tint on
        // a 9-sliced sprite is listed in known-approximations.md.
      } else {
        d.style.backgroundImage = 'url("' + s.path + '")';
        d.style.backgroundRepeat = img.type === 2 ? 'repeat' : 'no-repeat';
        d.style.backgroundSize = (crop && crop.size) ||
          (img.type === 2 ? (s.rect[2] + 'px ' + s.rect[3] + 'px') : '100% 100%');
        if (crop) d.style.backgroundPosition = crop.pos;
        if (!isWhite(rgb)) {
          d.style.backgroundColor = css(rgb);
          d.style.backgroundBlendMode = 'multiply';
        }
      }
      if (img.preserveAspect) rec.preserveAspect = [s.rect[2], s.rect[3]];
    }

    if (rec.rounded && rec.rounded.enabled) {
      d.style.borderRadius = rec.rounded.radius
        .map(function (v) { return v + 'px'; }).join(' ');
    }
    if (img.type === 3) applyFill(rec, img.fillAmount);
    applyPreserveAspect(rec);
  }

  function applyPreserveAspect(rec) {
    if (!rec.preserveAspect || !rec.imgEl || rec.sliced) return;
    var ar = rec.preserveAspect[0] / rec.preserveAspect[1];
    var bw = rec.w, bh = rec.h;
    if (!bw || !bh) return;
    if (bw / bh > ar) bw = bh * ar; else bh = bw / ar;
    rec.imgEl.style.backgroundSize = bw + 'px ' + bh + 'px';
    rec.imgEl.style.backgroundPosition = 'center center';
  }

  function applyFill(rec, amt) {
    var img = rec.img;
    if (!img || !rec.imgEl) return;
    var a = clamp01(amt);
    var m = img.fillMethod, o = img.fillOrigin, inset;
    if (m === 0) {          // Horizontal: origin 0 = left, 1 = right
      inset = o === 0 ? '0 ' + ((1 - a) * 100) + '% 0 0'
        : '0 0 0 ' + ((1 - a) * 100) + '%';
    } else if (m === 1) {   // Vertical: origin 0 = bottom, 1 = top
      inset = o === 0 ? ((1 - a) * 100) + '% 0 0 0'
        : '0 0 ' + ((1 - a) * 100) + '% 0';
    } else {                // radial
      rec.imgEl.style.webkitMaskImage = rec.imgEl.style.maskImage =
        'conic-gradient(#000 ' + (a * 360) + 'deg, transparent 0)';
      return;
    }
    rec.imgEl.style.clipPath = 'inset(' + inset + ')';
  }

  function setSprite(id, sprite) {
    var r = get(id);
    if (!r || !r.img) return;
    var s = (sprite && sprite.__sprite) ? sprite.__sprite : sprite;
    if (!s || !s.path) return;
    r.img.sprite = s;
    paintImage(r);
  }

  function setImageColor(id, rgba) {
    var r = get(id);
    if (!r || !r.img) return;
    r.img.color = rgba;
    paintImage(r);
  }

  function setTextEl(rec, str) {
    if (!rec.tmpEl) return;
    var s = str == null ? '' : String(str);
    if (rec.tmp && rec.tmp.richText) {
      // TMP rich text -> minimal HTML; escape everything else
      var esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      esc = esc.replace(/&lt;(\/?)(b|i|u|s)&gt;/gi, '<$1$2>');
      esc = esc.replace(/&lt;color=([#\w]+)&gt;/gi, '<span style="color:$1">')
        .replace(/&lt;\/color&gt;/gi, '</span>');
      rec.tmpEl.innerHTML = esc;
    } else {
      rec.tmpEl.textContent = s;
    }
    if (rec.tmp && rec.tmp.autoSize) autoSize(rec);
  }

  function autoSize(rec) {
    var t = rec.tmpEl, tmp = rec.tmp;
    var lo = tmp.sizeMin || 8, hi = tmp.sizeMax || tmp.fontSize;
    var boxW = rec.w - ((tmp.margin || [0, 0, 0, 0])[0] + (tmp.margin || [0, 0, 0, 0])[2]);
    var boxH = rec.h - ((tmp.margin || [0, 0, 0, 0])[1] + (tmp.margin || [0, 0, 0, 0])[3]);
    if (boxW <= 0 || boxH <= 0) return;
    var best = lo;
    for (var i = 0; i < 12; i++) {
      var mid = (lo + hi) / 2;
      t.style.fontSize = mid + 'px';
      if (t.scrollWidth <= boxW + 1 && t.scrollHeight <= boxH + 1) {
        best = mid; lo = mid;
      } else { hi = mid; }
    }
    t.style.fontSize = best + 'px';
  }

  // --------------------------------------------------------------- layout
  // Unity RectTransform, exact, per axis:
  //   size   = (aMax - aMin) * P + sizeDelta
  //   corner = aMin * P + anchoredPosition - sizeDelta * pivot
  // (bottom-left origin; flipped to CSS top-left afterwards)
  function layoutTree() {
    for (var i = 0; i < (LAYOUT_ROOTS || []).length; i++) {
      var rid = String(LAYOUT_ROOTS[i].id);
      if (nodes[rid]) layoutNode(nodes[rid], stageW, stageH);
    }
  }

  function layoutNode(rec, pw, ph) {
    var d = rec.data;
    if (rec.isRootCanvas) {
      rec.w = stageW; rec.h = stageH; rec.left = 0; rec.top = 0;
      var rs = rec.el.style;
      rs.left = '0px'; rs.top = '0px';
      rs.width = stageW + 'px'; rs.height = stageH + 'px';
      rs.transform = 'none'; rs.transformOrigin = '50% 50%';
      for (var rc = 0; rc < rec.children.length; rc++) {
        layoutNode(rec.children[rc], rec.w, rec.h);
      }
      return;
    }
    if (d.rect) {
      var aMin = d.anchorMin, aMax = d.anchorMax, sd = d.sizeDelta,
        pv = d.pivot, ap = rec.posOverride || d.anchoredPosition;

      var w = (aMax[0] - aMin[0]) * pw + sd[0];
      var h = (aMax[1] - aMin[1]) * ph + sd[1];
      var cx = aMin[0] * pw + ap[0] - sd[0] * pv[0];
      var cy = aMin[1] * ph + ap[1] - sd[1] * pv[1];

      if (w < 0) w = 0;
      if (h < 0) h = 0;

      rec.w = w; rec.h = h;
      rec.left = cx;
      rec.top = ph - (cy + h);
      var st = rec.el.style;
      st.left = rec.left + 'px';
      st.top = rec.top + 'px';
      st.width = w + 'px';
      st.height = h + 'px';
      applyTransform(rec);
      applyPreserveAspect(rec);
      if (rec.tmp && rec.tmp.autoSize) autoSize(rec);
    } else {
      // non-UI transform (particle roots etc.): world units -> canvas px.
      // These sit under a ScreenSpaceCamera canvas with orthographicSize 5,
      // so 1 world unit == stageH / (2*5) pixels.
      var ppu = stageH / 10;
      rec.w = 0; rec.h = 0;
      var p = d.position || [0, 0, 0];
      rec.left = stageW / 2 + p[0] * ppu;
      rec.top = stageH / 2 - p[1] * ppu;
      rec.el.style.left = rec.left + 'px';
      rec.el.style.top = rec.top + 'px';
      rec.el.style.width = '0px';
      rec.el.style.height = '0px';
      applyTransform(rec);
    }

    if (rec.grid && rec.grid.enabled) { layoutGrid(rec); return; }
    if (rec.hv && rec.hv.enabled) { layoutLinear(rec); return; }
    for (var i = 0; i < rec.children.length; i++) {
      layoutNode(rec.children[i], rec.w, rec.h);
    }
  }

  function applyTransform(rec) {
    var d = rec.data, s = rec.scale, r = rec.rotZ;
    var tr = '';
    if (r) tr += 'rotate(' + (-r) + 'deg) ';
    if (s[0] !== 1 || s[1] !== 1) tr += 'scale(' + s[0] + ',' + s[1] + ') ';
    rec.el.style.transform = tr || 'none';
    var pv = d.rect ? d.pivot : [0.5, 0.5];
    rec.el.style.transformOrigin = (pv[0] * 100) + '% ' + ((1 - pv[1]) * 100) + '%';
  }

  // Unity HorizontalOrVerticalLayoutGroup.
  // Faithful to CalcAlongAxis / SetChildrenAlongAxis, including negative
  // spacing, m_ReverseArrangement, and the child-alignment start offset --
  // LBD-1's number strip relies on all three at once.
  function layoutLinear(rec) {
    var g = rec.hv, mainAxis = rec.hvAxis;
    var kids = rec.children.filter(function (c) { return c.activeSelf; });
    var pad = g.padding || {};
    var padL = pad.m_Left || 0, padR = pad.m_Right || 0;
    var padT = pad.m_Top || 0, padB = pad.m_Bottom || 0;

    function padMin(axis) { return axis === 0 ? padL : padT; }
    function padSum(axis) { return axis === 0 ? padL + padR : padT + padB; }
    function boxSize(axis) { return axis === 0 ? rec.w : rec.h; }
    function alignOn(axis) {
      var a = g.childAlignment || 0;
      return axis === 0 ? (a % 3) * 0.5 : Math.floor(a / 3) * 0.5;
    }
    function controlOn(axis) {
      return axis === 0 ? g.childControlWidth : g.childControlHeight;
    }
    function forceOn(axis) {
      return axis === 0 ? g.childForceExpandWidth : g.childForceExpandHeight;
    }
    function scaleOn(axis) {
      return axis === 0 ? g.childScaleWidth : g.childScaleHeight;
    }
    function sd(k, axis) { return (k.data.sizeDelta || [0, 0])[axis] || 0; }
    function scaleOf(k, axis) { return (k.scale || [1, 1])[axis] || 1; }

    // GetChildSizes with m_ChildControl*Size == false (the case in these
    // projects): min == preferred == sizeDelta, flexible only from forceExpand.
    function childSizes(k, axis) {
      var min = sd(k, axis), preferred = min;
      var flexible = forceOn(axis) ? 1 : 0;
      return { min: min, preferred: preferred, flexible: flexible };
    }
    function startOffset(axis, requiredWithoutPadding) {
      var required = requiredWithoutPadding + padSum(axis);
      return padMin(axis) + (boxSize(axis) - required) * alignOn(axis);
    }

    function place(k, axis, pos, size) {
      if (axis === 0) { k.left = pos; if (size != null) k.w = size; }
      else { k.top = pos; if (size != null) k.h = size; }
    }

    [0, 1].forEach(function (axis) {
      var alongOther = (mainAxis === 1) !== (axis === 1);
      var useScale = scaleOn(axis), control = controlOn(axis);
      var align = alignOn(axis), spacing = g.spacing || 0;

      if (alongOther) {
        var innerSize = boxSize(axis) - padSum(axis);
        kids.forEach(function (k) {
          var cs = childSizes(k, axis);
          var sc = useScale ? scaleOf(k, axis) : 1;
          var cap = cs.flexible > 0 ? boxSize(axis) : cs.preferred;
          var required = Math.min(Math.max(innerSize, cs.min), Math.max(cs.min, cap));
          var off = startOffset(axis, required * sc);
          if (control) place(k, axis, off, required);
          else place(k, axis, off + (required - sd(k, axis)) * align, sd(k, axis));
        });
        return;
      }

      // along the layout axis
      var totalMin = padSum(axis), totalPreferred = padSum(axis), totalFlex = 0;
      kids.forEach(function (k) {
        var cs = childSizes(k, axis);
        var sc = useScale ? scaleOf(k, axis) : 1;
        totalMin += cs.min * sc + spacing;
        totalPreferred += cs.preferred * sc + spacing;
        totalFlex += cs.flexible * sc;
      });
      if (kids.length > 0) { totalMin -= spacing; totalPreferred -= spacing; }
      totalPreferred = Math.max(totalMin, totalPreferred);

      var size = boxSize(axis);
      var pos = padMin(axis), flexMult = 0;
      var surplus = size - totalPreferred;
      if (surplus > 0) {
        if (totalFlex === 0) pos = startOffset(axis, totalPreferred - padSum(axis));
        else flexMult = surplus / totalFlex;
      }
      var minMaxLerp = 0;
      if (totalMin !== totalPreferred) {
        minMaxLerp = Math.max(0, Math.min(1,
          (size - totalMin) / (totalPreferred - totalMin)));
      }

      var idx = [];
      for (var i = 0; i < kids.length; i++) idx.push(i);
      if (g.reverse) idx.reverse();

      idx.forEach(function (i) {
        var k = kids[i];
        var cs = childSizes(k, axis);
        var sc = useScale ? scaleOf(k, axis) : 1;
        var childSize = cs.min + (cs.preferred - cs.min) * minMaxLerp
          + cs.flexible * flexMult;
        if (control) place(k, axis, pos, childSize);
        else place(k, axis, pos + (childSize - sd(k, axis)) * align, sd(k, axis));
        pos += childSize * sc + spacing;
      });
    });

    // commit and recurse
    rec.children.forEach(function (k) {
      if (!k.activeSelf) {
        // keep a sane box so the element is correct when re-enabled
        k.w = sd(k, 0); k.h = sd(k, 1);
      }
      k.el.style.left = k.left + 'px';
      k.el.style.top = k.top + 'px';
      k.el.style.width = k.w + 'px';
      k.el.style.height = k.h + 'px';
      applyTransform(k);
      for (var j = 0; j < k.children.length; j++) {
        layoutNode(k.children[j], k.w, k.h);
      }
    });
  }

  // Unity GridLayoutGroup (constraint / start corner / axis / alignment)
  function layoutGrid(rec) {
    var g = rec.grid;
    var kids = rec.children.filter(function (c) { return c.activeSelf; });
    var n = kids.length;
    var pad = g.padding || {};
    var pl = pad.m_Left || 0, pr = pad.m_Right || 0,
      pt = pad.m_Top || 0, pb = pad.m_Bottom || 0;
    var cs = g.cellSize, sp = g.spacing;
    var cx, cy;
    var cc = g.runtimeConstraintCount != null
      ? g.runtimeConstraintCount : g.constraintCount;

    if (g.constraint === 1) {              // FixedColumnCount
      cx = cc; cy = Math.ceil(n / Math.max(1, cx));
    } else if (g.constraint === 2) {       // FixedRowCount
      cy = cc; cx = Math.ceil(n / Math.max(1, cy));
    } else {                                // Flexible
      var innerW = Math.max(1, rec.w - pl - pr);
      cx = Math.max(1, Math.floor((innerW + sp[0] + 0.001) / (cs[0] + sp[0])));
      cy = Math.ceil(n / cx);
    }
    if (n === 0) { cx = cy = 0; }

    var reqW = cx * cs[0] + Math.max(0, cx - 1) * sp[0];
    var reqH = cy * cs[1] + Math.max(0, cy - 1) * sp[1];
    var alignX = (g.childAlignment % 3) * 0.5;
    var alignY = Math.floor(g.childAlignment / 3) * 0.5;
    var offX = pl + (rec.w - (reqW + pl + pr)) * alignX;
    var offY = pt + (rec.h - (reqH + pt + pb)) * alignY;

    for (var i = 0; i < n; i++) {
      var px, py;
      if (g.startAxis === 0) { px = i % cx; py = Math.floor(i / cx); }
      else { px = Math.floor(i / cy); py = i % cy; }
      if (g.startCorner % 2 === 1) px = cx - 1 - px;
      if (Math.floor(g.startCorner / 2) === 1) py = cy - 1 - py;

      var k = kids[i];
      k.w = cs[0]; k.h = cs[1];
      k.left = offX + (cs[0] + sp[0]) * px;
      k.top = offY + (cs[1] + sp[1]) * py;
      k.el.style.left = k.left + 'px';
      k.el.style.top = k.top + 'px';
      k.el.style.width = k.w + 'px';
      k.el.style.height = k.h + 'px';
      applyTransform(k);
      for (var j = 0; j < k.children.length; j++) {
        layoutNode(k.children[j], k.w, k.h);
      }
    }
    // inactive children still need a defined box for when they reappear
    for (var m = 0; m < rec.children.length; m++) {
      if (!rec.children[m].activeSelf) {
        var c = rec.children[m];
        c.w = cs[0]; c.h = cs[1];
        c.el.style.width = c.w + 'px'; c.el.style.height = c.h + 'px';
        for (var q = 0; q < c.children.length; q++) {
          layoutNode(c.children[q], c.w, c.h);
        }
      }
    }
  }

  // ------------------------------------------------------------ boot scale
  function computeScale() {
    var W = viewport.clientWidth, H = viewport.clientHeight;
    var sw = W / refW, sh = H / refH, s;
    if (scaleMode === 1) {                       // ScaleWithScreenSize
      if (matchMode === 0) {                     // MatchWidthOrHeight (log lerp)
        s = Math.exp(Math.log(Math.max(1e-6, sw)) * (1 - match) +
          Math.log(Math.max(1e-6, sh)) * match);
      } else if (matchMode === 1) {              // Expand
        s = Math.min(sw, sh);
      } else {                                   // Shrink
        s = Math.max(sw, sh);
      }
    } else {                                     // ConstantPixelSize
      s = scaleFactor;
    }
    canvasScale = s;
    // Screen Space - Camera canvas: canvas rect = viewport px / scaleFactor
    stageW = W / s;
    stageH = H / s;
    stage.style.width = stageW + 'px';
    stage.style.height = stageH + 'px';
    stage.style.transform = 'scale(' + s + ')';
    stage.style.transformOrigin = '0 0';
    if (fxCanvas) {
      fxCanvas.width = Math.round(stageW);
      fxCanvas.height = Math.round(stageH);
      fxCanvas.style.width = stageW + 'px';
      fxCanvas.style.height = stageH + 'px';
    }
  }

  var LAYOUT_ROOTS = null;

  function boot(layout, cfg) {
    cfg = cfg || {};
    viewport = document.getElementById('viewport');
    stage = document.getElementById('stage');
    if (!viewport || !stage) throw new Error('missing #viewport / #stage');
    var sc = cfg.canvasScaler || {};
    refW = sc.referenceResolution ? sc.referenceResolution[0] : 1920;
    refH = sc.referenceResolution ? sc.referenceResolution[1] : 1080;
    scaleMode = sc.uiScaleMode != null ? sc.uiScaleMode : 1;
    matchMode = sc.screenMatchMode != null ? sc.screenMatchMode : 1;
    match = sc.match != null ? sc.match : 0.5;
    scaleFactor = sc.scaleFactor != null ? sc.scaleFactor : 1;
    colorSpace = cfg.colorSpace != null ? cfg.colorSpace : 0;

    stage.innerHTML = '';
    nodes = Object.create(null); order = []; particleSystems = [];
    LAYOUT_ROOTS = layout;

    fxCanvas = el('canvas', 'un-fx');
    fxCtx = fxCanvas.getContext('2d');

    computeScale();
    for (var i = 0; i < layout.length; i++) buildNode(layout[i], null, 0);
    stage.appendChild(fxCanvas);
    layoutTree();

    window.addEventListener('resize', function () {
      computeScale(); layoutTree();
      for (var r = 0; r < resizeHooks.length; r++) resizeHooks[r]();
    });
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, unlockAudio, { once: false });
    });
    startTick();
    return nodes;
  }

  // ---------------------------------------------------------- node access
  function get(id) { return nodes[String(id)]; }
  function byName(name, root) {
    var out = [];
    for (var i = 0; i < order.length; i++) {
      var r = nodes[order[i]];
      if (String(r.data.name) === name) out.push(r);
    }
    return out;
  }
  function isActiveSelf(id) { var r = get(id); return !!(r && r.activeSelf); }
  function isActiveInHierarchy(id) {
    var r = get(id);
    while (r) { if (!r.activeSelf) return false; r = r.parent; }
    return true;
  }

  var activateHooks = [];
  function onActivated(fn) { activateHooks.push(fn); }

  function setActive(id, on) {
    var r = get(id);
    if (!r) return;
    on = !!on;
    if (r.activeSelf === on) return;
    r.activeSelf = on;
    r.el.classList.toggle('un-off', !on);
    // GridLayoutGroup parents re-flow when a child's active state changes
    if (r.parent && r.parent.grid) layoutGrid(r.parent);
    else if (r.parent && r.parent.hv) layoutLinear(r.parent);
    for (var i = 0; i < activateHooks.length; i++) activateHooks[i](r, on);
  }

  // Runtime sprite/tint changes go through paintImage (declared above) so they
  // land on the dedicated .un-img layer. An earlier revision re-declared
  // setSprite/setImageColor here to paint rec.el directly with mask-image;
  // because function declarations hoist, those duplicates silently won over the
  // paintImage versions and every swap was invisible (the .un-img child still
  // held the old artwork) while a mask leaked onto the node's whole subtree.

  function setText(id, s) { var r = get(id); if (r) setTextEl(r, s); }
  function getText(id) {
    var r = get(id);
    return r && r.tmpEl ? (r.tmpEl.textContent || '') : '';
  }
  function setTextColor(id, rgba) {
    var r = get(id); if (r && r.tmpEl) r.tmpEl.style.color = css(rgba);
  }
  function setAlpha(id, a) {
    var r = get(id); if (!r) return;
    r.alpha = a; r.el.style.opacity = a;
  }
  function setScale(id, sx, sy) {
    var r = get(id); if (!r) return;
    r.scale[0] = sx; r.scale[1] = (sy == null ? sx : sy);
    applyTransform(r);
  }
  function getScale(id) { var r = get(id); return r ? r.scale.slice() : [1, 1, 1]; }
  function setRotZ(id, deg) {
    var r = get(id); if (!r) return;
    r.rotZ = deg; applyTransform(r);
  }
  function getRotZ(id) { var r = get(id); return r ? r.rotZ : 0; }
  function setAnchoredPos(id, x, y) {
    var r = get(id); if (!r) return;
    r.posOverride = [x, y];
    var pw = r.parent ? r.parent.w : stageW, ph = r.parent ? r.parent.h : stageH;
    if (r.parent && r.parent.grid) { layoutGrid(r.parent); return; }
    if (r.parent && r.parent.hv) { layoutLinear(r.parent); return; }
    layoutNode(r, pw, ph);
  }
  function getAnchoredPos(id) {
    var r = get(id); if (!r) return [0, 0];
    return (r.posOverride || r.data.anchoredPosition || [0, 0]).slice();
  }
  /**
   * Edit-time only (God Mode layout editor). sizeDelta is a serialized
   * RectTransform field, so it is written back onto data and the subtree is
   * re-laid-out from the parent -- the same path the boot layout takes.
   */
  function setSizeDelta(id, w, h) {
    var r = get(id); if (!r || !r.data.rect) return;
    r.data.sizeDelta = [w, h];
    relayoutFrom(r);
  }
  function getSizeDelta(id) {
    var r = get(id);
    return r && r.data.sizeDelta ? r.data.sizeDelta.slice() : [0, 0];
  }
  function relayoutFrom(r) {
    if (r.parent && r.parent.grid) { layoutGrid(r.parent); return; }
    if (r.parent && r.parent.hv) { layoutLinear(r.parent); return; }
    var pw = r.parent ? r.parent.w : stageW, ph = r.parent ? r.parent.h : stageH;
    layoutNode(r, pw, ph);
  }
  function setFontSize(id, px) {
    var r = get(id); if (!r || !r.tmpEl) return;
    r.tmp.fontSize = px;
    r.tmp.autoSize = false;              // a manual size wins over TMP autosize
    r.tmpEl.style.fontSize = px + 'px';
  }
  function getFontSize(id) {
    var r = get(id);
    return r && r.tmp ? r.tmp.fontSize : null;
  }
  function setZIndex(id, z) {
    var r = get(id); if (!r) return;
    r.el.style.zIndex = z === null || z === '' ? '' : String(z);
  }
  /** Live geometry in stage space, resolved through every ancestor. */
  function stageRectOf(id) {
    var r = get(id); if (!r) return null;
    var x = 0, y = 0, n = r;
    while (n) { x += n.left; y += n.top; n = n.parent; }
    return { x: x, y: y, w: r.w, h: r.h };
  }
  // pixel offset applied on top of layout (used by DOShakePosition)
  function setPixelOffset(id, dx, dy) {
    var r = get(id); if (!r) return;
    r.el.style.marginLeft = (dx || 0) + 'px';
    r.el.style.marginTop = (dy || 0) + 'px';
  }
  function setFill(id, amt) {
    var r = get(id); if (r && r.img) { r.img.fillAmount = amt; applyFill(r, amt); }
  }
  function setInteractable(id, on) {
    var r = get(id); if (!r) return;
    r.interactable = !!on;
    r.el.classList.toggle('un-dis', !on);
  }
  function isInteractable(id) { var r = get(id); return !!(r && r.interactable); }

  /** localScale multiplied down the ancestor chain, per axis. */
  function accumulatedScale(rec) {
    var sx = 1, sy = 1, n = rec;
    while (n) {
      if (!n.isRootCanvas) { sx *= n.scale[0] || 1; sy *= n.scale[1] || 1; }
      n = n.parent;
    }
    return [sx, sy];
  }

  // world-space centre of a node in stage pixels (for hand-hint placement)
  function centerOf(id) {
    var r = get(id); if (!r) return [0, 0];
    var x = 0, y = 0, n = r;
    while (n) { x += n.left; y += n.top; n = n.parent; }
    return [x + r.w / 2, y + r.h / 2];
  }

  // ------------------------------------------------------------ interaction
  // UnityEvent has two listener kinds. Inspector-wired ("persistent") calls
  // are NOT removed by onClick.RemoveAllListeners() -- only script-added ones
  // are. Invocation order is persistent first, then runtime, in order added.
  function ensureClick(id) {
    var r = get(id);
    if (!r) return null;
    if (r._clickBound) return r;
    r._persist = [];
    r._runtime = [];
    r._down = function (e) {
      if (!r.interactable) return;
      e.preventDefault();
      r.el.classList.add('un-press');
      r._armed = true;
    };
    r._up = function (e) {
      r.el.classList.remove('un-press');
      if (!r._armed) return;
      r._armed = false;
      if (!r.interactable) return;
      if (e.type === 'pointercancel') return;
      var list = r._persist.concat(r._runtime);
      for (var i = 0; i < list.length; i++) {
        try { list[i](); } catch (err) { logErr(err); }
      }
    };
    r.el.addEventListener('pointerdown', r._down);
    r.el.addEventListener('pointerup', r._up);
    r.el.addEventListener('pointercancel', r._up);
    r._clickBound = true;
    return r;
  }
  /** Scene-serialized (persistent) onClick list. */
  function setPersistentClick(id, fn) {
    var r = ensureClick(id);
    if (r) r._persist = [fn];
  }
  /** onClick.AddListener(...) at runtime. */
  function addClick(id, fn) {
    var r = ensureClick(id);
    if (r) r._runtime.push(fn);
  }
  /** onClick.RemoveAllListeners() -- runtime listeners only. */
  function clearClicks(id) {
    var r = get(id);
    if (r && r._runtime) r._runtime.length = 0;
  }
  function onClick(id, fn) { setPersistentClick(id, fn); }

  // ----------------------------------------------------------------- audio
  var channels = Object.create(null), cache = Object.create(null);
  function clip(src) {
    if (!src) return null;
    if (!cache[src]) { var a = new Audio(src); a.preload = 'auto'; cache[src] = a; }
    return cache[src];
  }
  function channel(name) {
    if (!channels[name]) channels[name] = { el: null, src: null, vol: 1, loop: false };
    return channels[name];
  }
  function play(chName, src, opts) {
    opts = opts || {};
    var ch = channel(chName);
    if (!src) return;
    if (ch.el) { try { ch.el.pause(); ch.el.currentTime = 0; } catch (e) { } }
    var base = clip(src);
    if (!base) return;
    var a = base.cloneNode ? base.cloneNode() : new Audio(src);
    a.volume = opts.volume != null ? opts.volume : ch.vol;
    a.loop = !!opts.loop;
    ch.el = a; ch.src = src;
    tryPlay(a);
  }
  function playOneShot(src, volume) {
    var base = clip(src); if (!base) return;
    var a = base.cloneNode ? base.cloneNode() : new Audio(src);
    a.volume = volume != null ? volume : 1;
    tryPlay(a);
  }
  function stopChannel(chName) {
    var ch = channels[chName];
    if (ch && ch.el) { try { ch.el.pause(); ch.el.currentTime = 0; } catch (e) { } }
  }
  function tryPlay(a) {
    var p = a.play();
    if (p && p.catch) {
      p.catch(function () {
        if (!audioUnlocked && pendingAudio.length < 8) pendingAudio.push(a);
      });
    }
  }
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    while (pendingAudio.length) {
      var a = pendingAudio.shift();
      try { a.play(); } catch (e) { }
    }
  }
  function audioDuration(src) {
    return new Promise(function (res) {
      var a = clip(src);
      if (!a) return res(0);
      if (a.readyState >= 1 && isFinite(a.duration)) return res(a.duration);
      a.addEventListener('loadedmetadata', function () {
        res(isFinite(a.duration) ? a.duration : 0);
      }, { once: true });
      setTimeout(function () { res(isFinite(a.duration) ? a.duration : 0); }, 1500);
    });
  }
  function preload(list) {
    (list || []).forEach(function (src) {
      if (!src) return;
      if (/\.(png|jpe?g|webp)$/i.test(src)) { var im = new Image(); im.src = src; }
      else clip(src);
    });
  }

  // ------------------------------------------------------------ tick / rAF
  function onTick(fn) { tickHooks.push(fn); }
  function startTick() {
    if (rafId) return;
    lastT = performance.now();
    (function loop(ts) {
      rafId = requestAnimationFrame(loop);
      var dt = Math.min(0.1, (ts - lastT) / 1000);
      lastT = ts;
      for (var i = 0; i < tickHooks.length; i++) {
        try { tickHooks[i](dt); } catch (e) { logErr(e); }
      }
      stepParticles(dt);
    })(lastT);
  }

  // ------------------------------------------------------ particles (canvas)
  // Unity ParticleSystem cannot be reproduced mechanically; this is a Canvas
  // approximation driven by the serialized emission/lifetime/size/colour.
  function stepParticles(dt) {
    if (!fxCtx) return;
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    for (var i = 0; i < particleSystems.length; i++) {
      var rec = particleSystems[i];
      var ps = rec.particles;
      if (!isActiveInHierarchy(rec.id)) { rec._pool = null; continue; }
      if (!rec._pool) {
        rec._pool = [];
        rec._acc = 0;
        rec._t = 0;
        if (!ps.playOnAwake && !rec._playing) { rec._pool = []; }
      }
      if (!ps.playOnAwake && !rec._playing) continue;
      rec._t += dt;
      var c = centerOf(rec.id);
      var sc = accumulatedScale(rec);

      // A zero-velocity emitter is not a spray -- it is a steady soft halo held in
      // place (the GlowEffect_* parents: startSpeed 0, startSize 1.2, lifetime
      // 0.8). Spawning that as discrete particles reads as dots popping on and
      // off, which is not what the Unity build shows, so it is drawn as one
      // breathing radial glow instead, centred on the spot it marks.
      //
      // Its single child is a POINT emitter (shapeRadius 0.0001) offset onto the
      // hiding place; in Unity its soft particles pile up there and are the bright
      // core of the glow. It is the same visual, so it is folded in rather than
      // drawn as its own spray of dots.
      if (!ps.startSpeed) { drawGlowField(rec, ps, sc, rec._t); continue; }
      if (isPointEmitter(ps) && rec.parent && rec.parent.particles &&
          !rec.parent.particles.startSpeed) continue;

      var rate = ps.rateOverTime || 10;
      var cap = Math.min(ps.maxParticles || 60, 90);
      rec._acc += rate * dt;
      while (rec._acc >= 1 && rec._pool.length < cap) {
        rec._acc -= 1;
        rec._pool.push(spawnParticle(ps, c, sc));
      }
      fxCtx.save();
      for (var j = rec._pool.length - 1; j >= 0; j--) {
        var p = rec._pool[j];
        p.age += dt;
        if (p.age >= p.life) {
          if (ps.looping) rec._pool[j] = spawnParticle(ps, c, sc);
          else rec._pool.splice(j, 1);
          continue;
        }
        p.vy += (ps.gravity || 0) * 9.81 * dt * 20;
        p.x += p.vx * dt; p.y += p.vy * dt;
        var k = p.age / p.life;
        var a = (ps.colorOverLifetime ? (1 - k) : 1) * p.a;
        var sz = Math.max(0.5, p.size * (1 - k * 0.35));
        fxCtx.globalAlpha = clamp01(a);
        // A Unity particle is a soft sprite, not a hard disc. Flat arc fills made
        // the larger glow particles read as painted blobs on the props, so they
        // draw a cached radial-gradient puff instead. Small sparkles keep the
        // cheap arc path -- the gradient is imperceptible under ~10px.
        if (sz >= 10) {
          var puff = glowSprite(p.col);
          fxCtx.drawImage(puff, p.x - sz, p.y - sz, sz * 2, sz * 2);
        } else {
          fxCtx.fillStyle = p.col;
          fxCtx.beginPath();
          fxCtx.arc(p.x, p.y, sz, 0, Math.PI * 2);
          fxCtx.fill();
        }
      }
      fxCtx.restore();
    }
    fxCtx.globalAlpha = 1;
  }
  // ParticleSystemShapeType values these scenes use. Everything else falls back
  // to a radius, which is the safe default for the sphere/cone family.
  var SHAPE_BOX = { 5: 1, 15: 1, 16: 1 };            // Box / BoxShell / BoxEdge
  // Emission geometry and startSize are serialized in WORLD units. The canvas is
  // Screen Space - Camera with orthographicSize 5, so 10 world units span the
  // canvas height -- the same conversion layoutNode() already uses for non-UI
  // transforms.
  // A Unity particle sprite is a soft dot filling a fraction of its quad, so the
  // serialized startSize (in world units) overstates the visible mark.
  var PARTICLE_SIZE_K = 0.06;    // sparks/ambient: fine dots, ~3px radius
  var PARTICLE_SIZE_MIN = 2.5;   // below this a dot stops reading at all
  var PARTICLE_SIZE_MAX = 90;    // guard: a large serialized size must not fill the screen
  var GLOW_SIZE_K = 0.29;        // steady halos, tuned against the Unity build
  var GLOW_BREATHE_HZ = 0.35;    // slow in-out, matches the original's pulse
  var GLOW_ALPHA_GAIN = 2.5;     // see drawGlowField: per-particle alpha -> one glow
  var GLOW_GLINT_K = 0.27;       // specular hotspot, as a fraction of the glow radius
  var GLOW_RAY_LONG = 1.55;      // soft streak reach, as a multiple of the radius
  var GLOW_RAY_SHORT = 0.95;
  var GLOW_RAY_SPIN = 0.07;      // rad/s -- barely perceptible, keeps it alive
  var GLOW_TWINKLES = 5;         // drifting sparks around the glow
  var GLOW_PAD_K = 1.6;         // contrast pad radius, as a multiple of the glow radius
  var GLOW_PAD_ALPHA = 0.62;      // how strongly it darkens the backdrop

  function worldToPx() { return stageH / 10; }

  /**
   * One 64x64 radial-gradient puff per colour, cached. Building a gradient per
   * particle per frame would mean thousands of allocations a second; drawing a
   * cached bitmap scaled to the particle is effectively free.
   */
  var glowCache = Object.create(null);
  function rgbaOf(cssColor, alpha) {
    var m = /^rgba?\(([^)]+)\)$/.exec(cssColor);
    if (!m) return cssColor;
    var p = m[1].split(',');
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + alpha + ')';
  }
  /**
   * One continuous soft glow, drawn fresh each frame so it can breathe. Two
   * concentric gradients: a tight bright core over a wide soft falloff, which is
   * how an additive glow sprite reads in the original.
   */
  function isPointEmitter(ps) {
    return !SHAPE_BOX[ps.shapeType] && (ps.shapeRadius || 0) < 0.01;
  }

  /**
   * Where a glow visually sits: on its child point emitter if it has one, because
   * that child is deliberately offset onto the hiding place (the parent rect is
   * only the effect's container). Exported as glowCenterOf so the tap hint can
   * point at the same spot.
   */
  function glowCenter(rec) {
    for (var i = 0; i < rec.children.length; i++) {
      var k = rec.children[i];
      if (k.particles && isPointEmitter(k.particles)) return centerOf(k.id);
    }
    return centerOf(rec.id);
  }

  function drawGlowField(rec, ps, scale, t) {
    var ppu = worldToPx();
    var s = Math.max(scale[0] || 1, scale[1] || 1);
    var c = glowCenter(rec);
    var R = (ps.startSize || 1) * ppu * s * GLOW_SIZE_K;
    if (R < 1) return;
    var breathe = 1 + 0.08 * Math.sin(t * Math.PI * 2 * GLOW_BREATHE_HZ);
    R *= breathe;
    var col = ps.startColor || [1, 1, 1, 1];
    var base = css([col[0], col[1], col[2]]);
    // The serialized alpha (0.43) is a PER-PARTICLE value: Unity has ~8 of them
    // alive on the same spot at once (rate 10, lifetime 0.8), so the accumulated
    // result is near-saturated. One continuous glow has to carry that whole
    // budget, hence the multiplier -- at the raw 0.43 it read as a faint smudge.
    var a = clamp01((col.length > 3 ? col[3] : 1) * GLOW_ALPHA_GAIN * (0.9 + 0.1 * breathe));

    fxCtx.save();
    // Contrast pad: a soft, deeply darkened wash of the glow's own hue, laid down
    // BEFORE the light. Hue alone cannot carry visibility -- GlowEffect_lake is
    // the same green as the statue's, but the lake is bright cyan water, so a
    // cyan-green glow on it had almost no luminance difference and vanished. A
    // darker pad underneath gives the light something to read against, which is
    // how it reads as a glow sunk into the water rather than a tint on top of it.
    // On the dark props it is imperceptible, so one set of values covers all nine.
    var padR = R * GLOW_PAD_K;
    fxCtx.globalAlpha = clamp01(a * GLOW_PAD_ALPHA);
    fxCtx.drawImage(glowFieldSprite(darkenBy(base, 0.22)),
      c[0] - padR, c[1] - padR, padR * 2, padR * 2);

    // The halo blends NORMALLY, not additively. Additive light clips to white on
    // a pale prop -- over the cyan lake the whole glow came out rgb(255,255,255)
    // and simply disappeared into the water, while reading fine on the dark
    // statue. Normal blending keeps the hue whatever it sits on, so one set of
    // values works for every prop. Only the rays and the glint stay additive,
    // where blowing out to near-white is the point.
    fxCtx.globalAlpha = a;
    fxCtx.drawImage(glowFieldSprite(base), c[0] - R, c[1] - R, R * 2, R * 2);
    var inner = R * 0.4;                          // saturated body
    fxCtx.globalAlpha = clamp01(a * 0.85);
    fxCtx.drawImage(glowFieldSprite(base), c[0] - inner, c[1] - inner, inner * 2, inner * 2);
    fxCtx.globalCompositeOperation = 'lighter';
    // Soft blooming streaks, not spikes. Filled triangles gave crisp polygon
    // edges -- a laser rather than magic, and far too hard for a five-year-old's
    // screen. Each streak is instead the radial-gradient puff stretched into a
    // long thin ellipse, so it is soft on every edge by construction: two long
    // ones make a gentle cross and two short diagonals fill it into a bloom.
    var rays = whiten(base);
    var puff = glowSprite(rays);
    fxCtx.translate(c[0], c[1]);
    fxCtx.rotate(t * GLOW_RAY_SPIN);
    for (var q = 0; q < 4; q++) {
      var long = q < 2;
      var len = R * (long ? GLOW_RAY_LONG : GLOW_RAY_SHORT) * breathe;
      var wide = R * (long ? 0.5 : 0.62);
      fxCtx.globalAlpha = clamp01(a * (long ? 0.4 : 0.24));
      fxCtx.drawImage(puff, -wide / 2, -len, wide, len * 2);
      fxCtx.rotate(q === 1 ? Math.PI / 4 : Math.PI / 2);
    }
    fxCtx.setTransform(1, 0, 0, 1, 0, 0);

    // Twinkles: a few small soft sparks drifting around the glow, each on its own
    // phase. The splash art scatters exactly these around its gem, and they are
    // what makes the light feel alive and magical rather than a static lamp.
    for (var w = 0; w < GLOW_TWINKLES; w++) {
      var ph = w * 2.399963;                       // golden angle -- never lines up
      var ang = ph + t * 0.35;
      var dist = R * (1.15 + 0.35 * Math.sin(t * 0.9 + ph));
      var tw = R * 0.17 * (0.65 + 0.35 * Math.sin(t * 2.1 + ph * 3));
      var ta = clamp01(a * 0.5 * (0.35 + 0.65 * Math.sin(t * 1.7 + ph * 2)));
      if (ta <= 0.01 || tw < 0.6) continue;
      var tx = c[0] + Math.cos(ang) * dist;
      var ty = c[1] + Math.sin(ang) * dist;
      fxCtx.globalAlpha = ta;
      fxCtx.drawImage(puff, tx - tw, ty - tw, tw * 2, tw * 2);
    }

    // Specular glint: a soft, near-white hot centre. Small and much whiter than
    // the streaks, so it stays legible even where the glow and the prop share a
    // hue (gold on the treasure chest).
    var glint = R * GLOW_GLINT_K * (2 - breathe);
    fxCtx.globalAlpha = clamp01(a);
    fxCtx.drawImage(glowSprite(whitenBy(base, 0.92)), c[0] - glint, c[1] - glint,
      glint * 2, glint * 2);
    fxCtx.restore();
    fxCtx.globalAlpha = 1;
    fxCtx.globalCompositeOperation = 'source-over';
  }

  /**
   * Lift a colour toward white by `k`.
   *
   * Two different amounts are needed. The broad streaks keep most of their hue
   * (0.45) -- at 0.72 they blew out and the whole glow vanished into the pale
   * cyan lake. The small core goes much whiter (0.85), because a gold glow on the
   * gold treasure chest is nearly invisible otherwise; it is a few pixels across,
   * so it adds a readable spark without washing anything out.
   */
  function whitenBy(cssColor, k) {
    var m = /^rgba?\(([^)]+)\)$/.exec(cssColor);
    if (!m) return cssColor;
    var p = m[1].split(',');
    function up(v) { return Math.round(parseFloat(v) + (255 - parseFloat(v)) * k); }
    return 'rgba(' + up(p[0]) + ',' + up(p[1]) + ',' + up(p[2]) + ',1)';
  }
  function whiten(cssColor) { return whitenBy(cssColor, 0.45); }

  /** Scale a colour's channels toward black, keeping its hue. */
  function darkenBy(cssColor, k) {
    var m = /^rgba?\(([^)]+)\)$/.exec(cssColor);
    if (!m) return cssColor;
    var p = m[1].split(',');
    function dn(v) { return Math.round(parseFloat(v) * k); }
    return 'rgba(' + dn(p[0]) + ',' + dn(p[1]) + ',' + dn(p[2]) + ',1)';
  }

  /**
   * Glow-field gradient: holds its energy near the centre so the result reads as
   * a lit spot with a soft edge. The particle puff below falls off much earlier,
   * which is right for a small dot but washes out at glow size.
   */
  var glowFieldCache = Object.create(null);
  function glowFieldSprite(color) {
    if (glowFieldCache[color]) return glowFieldCache[color];
    var R = 48;
    var cv = document.createElement('canvas');
    cv.width = cv.height = R * 2;
    var g = cv.getContext('2d');
    var grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, rgbaOf(color, 1));
    grad.addColorStop(0.2, rgbaOf(color, 0.72));
    grad.addColorStop(0.5, rgbaOf(color, 0.24));
    grad.addColorStop(1, rgbaOf(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, R * 2, R * 2);
    glowFieldCache[color] = cv;
    return cv;
  }

  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    var R = 32;
    var cv = document.createElement('canvas');
    cv.width = cv.height = R * 2;
    var g = cv.getContext('2d');
    // Falls off early and hard: several of these overlap inside one emitter, and
    // a gentle ramp accumulated into an opaque blob over the artwork.
    var grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, rgbaOf(color, 0.85));
    grad.addColorStop(0.3, rgbaOf(color, 0.28));
    grad.addColorStop(1, rgbaOf(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, R * 2, R * 2);
    glowCache[color] = cv;
    return cv;
  }

  /**
   * Emission area was previously `shapeRadius * 20` for every system, which
   * ignored shapeType and shapeScale outright. CrystalGlowParticles is a Box of
   * 10x3 world units -- an ambient sparkle band across the cave -- and collapsed
   * into a 20px dot at the centre of the screen; the GlowEffect_* circles
   * (radius 0.3) shrank to 6px, so a "glowing spot" read as a speck beside its
   * prop rather than a halo over it.
   */
  function spawnParticle(ps, c, scale) {
    var ppu = worldToPx();
    var sx = (scale && scale[0]) || 1, sy = (scale && scale[1]) || 1;
    var ang = Math.random() * Math.PI * 2;
    var spd = (ps.startSpeed || 0) * (0.5 + Math.random()) * 12;
    var col = ps.startColor || [1, 1, 1, 1];
    var ox, oy;

    if (SHAPE_BOX[ps.shapeType]) {
      var box = ps.shapeScale || [1, 1, 1];
      ox = (Math.random() - 0.5) * (box[0] || 1) * ppu * sx;
      oy = (Math.random() - 0.5) * (box[1] || 1) * ppu * sy;
    } else {
      // sqrt keeps the distribution even across the disc instead of clustering
      // everything at the centre
      var rad = (ps.shapeRadius || 0) * ppu;
      var r = Math.sqrt(Math.random()) * rad;
      ox = Math.cos(ang) * r * sx;
      oy = Math.sin(ang) * r * sy;
    }

    var size = (ps.startSize || 1) * ppu * PARTICLE_SIZE_K * Math.max(sx, sy);
    return {
      x: c[0] + ox,
      y: c[1] + oy,
      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      life: Math.max(0.2, (ps.startLifetime || 1) * (0.6 + Math.random() * 0.6)),
      age: 0,
      size: Math.max(PARTICLE_SIZE_MIN, Math.min(PARTICLE_SIZE_MAX, size)),
      col: css([col[0], col[1], col[2]]),
      a: col.length > 3 ? col[3] : 1
    };
  }
  function playParticles(id) {
    var r = get(id); if (!r || !r.particles) return;
    r._playing = true; r._pool = null;
  }
  function stopParticles(id) {
    var r = get(id); if (!r) return;
    r._playing = false; r._pool = null;
  }

  // ------------------------------------------------- controller lifecycle
  // Unity order: Awake -> OnEnable -> Start (first time active) -> Update.
  var registry = [];   // {hostId, def}
  function register(hostId, def) {
    registry.push({ hostId: String(hostId), def: def, started: false, enabled: false });
  }
  function tickControllers() {
    for (var i = 0; i < registry.length; i++) {
      var e = registry[i];
      var live = isActiveInHierarchy(e.hostId);
      if (live && !e.enabled) {
        e.enabled = true;
        if (e.def.onEnable) { try { e.def.onEnable(); } catch (x) { logErr(x); } }
        if (!e.started) {
          e.started = true;
          if (e.def.start) { try { e.def.start(); } catch (x) { logErr(x); } }
        }
      } else if (!live && e.enabled) {
        e.enabled = false;
        if (e.def.onDisable) { try { e.def.onDisable(); } catch (x) { logErr(x); } }
      }
    }
  }
  function awakeAll() {
    for (var i = 0; i < registry.length; i++) {
      var e = registry[i];
      // Unity runs Awake only for objects active in the hierarchy at load
      if (isActiveInHierarchy(e.hostId) && e.def.awake) {
        try { e.def.awake(); } catch (x) { logErr(x); }
      }
    }
  }
  function controllerStarted(hostId) {
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].hostId === String(hostId)) return registry[i].started;
    }
    return false;
  }

  // ---------------------------------------------------------- diagnostics
  function dump() {
    return {
      nodeCount: order.length,
      canvasScale: canvasScale, stageW: stageW, stageH: stageH,
      controllers: registry.map(function (e) {
        return { host: e.hostId, started: e.started, enabled: e.enabled };
      })
    };
  }

  return {
    boot: boot, get: get, byName: byName, nodes: function () { return nodes; },
    order: function () { return order; },
    setActive: setActive, isActiveSelf: isActiveSelf,
    isActiveInHierarchy: isActiveInHierarchy, onActivated: onActivated,
    setSprite: setSprite, setImageColor: setImageColor,
    setText: setText, getText: getText, setTextColor: setTextColor,
    setAlpha: setAlpha, setScale: setScale, getScale: getScale,
    setRotZ: setRotZ, getRotZ: getRotZ,
    setAnchoredPos: setAnchoredPos, getAnchoredPos: getAnchoredPos,
    setSizeDelta: setSizeDelta, getSizeDelta: getSizeDelta,
    setFontSize: setFontSize, getFontSize: getFontSize,
    setZIndex: setZIndex, stageRectOf: stageRectOf,
    setPixelOffset: setPixelOffset,
    setFill: setFill, setInteractable: setInteractable,
    glowCenterOf: function (id) { var r = get(id); return r ? glowCenter(r) : null; },
    isInteractable: isInteractable, centerOf: centerOf,
    onClick: onClick, setPersistentClick: setPersistentClick,
    addClick: addClick, clearClicks: clearClicks,
    TaskGroup: TaskGroup, ease: ease, easings: E,
    play: play, playOneShot: playOneShot, stopChannel: stopChannel,
    audioDuration: audioDuration, preload: preload, unlockAudio: unlockAudio,
    onTick: onTick, onResize: function (f) { resizeHooks.push(f); },
    relayout: function () { layoutTree(); },
    layoutGrid: function (id) { var r = get(id); if (r && r.grid) layoutGrid(r); },
    playParticles: playParticles, stopParticles: stopParticles,
    register: register, awakeAll: awakeAll, tickControllers: tickControllers,
    controllerStarted: controllerStarted,
    cssColor: css, dump: dump,
    scale: function () { return canvasScale; },
    stageSize: function () { return [stageW, stageH]; }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
