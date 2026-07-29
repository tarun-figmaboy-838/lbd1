/* ==========================================================================
 * preloader.js -- gate the first frame on decoded artwork
 *
 * The build ships ~11 MB of PNGs and nothing used to wait for them: on a slow
 * connection the splash was black for seconds and the gameplay screen painted
 * one prop at a time. Every sprite path is walked out of window.LAYOUT /
 * SPLASH_LAYOUT and every clip out of window.CONFIG, decoded up front behind a
 * progress bar, and the game boots only once that finishes.
 *
 * Side effect the dialogue depends on: audio metadata is read during the same
 * pass and cached as window.AUDIO_DURATIONS, which is what lets the typewriter
 * match a caption to the length of its voice-over synchronously.
 *
 * The game still boots immediately -- it just boots underneath an opaque veil,
 * so nothing half-painted is ever on screen. Removing the <script> tag restores
 * the original un-gated boot exactly; main.js only calls hold() if it exists.
 * ======================================================================== */
'use strict';

var Preloader = (function () {

  var IMG_RE = /\.(png|jpe?g|webp|gif)$/i;
  var AUDIO_RE = /\.(ogg|mp3|wav|m4a)$/i;

  // A hard ceiling so a dead asset host can never leave a child on a spinner.
  var TIMING = { assetTimeout: 12000, metaTimeout: 2500, fadeOut: 380 };

  window.AUDIO_DURATIONS = window.AUDIO_DURATIONS || Object.create(null);

  // ------------------------------------------------------------- collection
  function walkSprites(nodes, out) {
    (nodes || []).forEach(function walk(n) {
      (n.components || []).forEach(function (c) {
        if (c.sprite && c.sprite.path) out[c.sprite.path] = 1;
        if (c.font && c.font.path) out[c.font.path] = 1;
      });
      (n.children || []).forEach(walk);
    });
  }

  function walkClips(value, out, depth) {
    if (!value || depth > 6) return;
    if (typeof value === 'object') {
      if (typeof value.__audio === 'string') { out[value.__audio] = 1; return; }
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length; i++) walkClips(value[keys[i]], out, depth + 1);
    }
  }

  function manifest() {
    var imgs = Object.create(null), auds = Object.create(null);
    walkSprites(window.SPLASH_LAYOUT, imgs);
    walkSprites(window.LAYOUT, imgs);
    walkClips(window.CONFIG, auds, 0);
    return {
      images: Object.keys(imgs).filter(function (p) { return IMG_RE.test(p); }),
      audio: Object.keys(auds).filter(function (p) { return AUDIO_RE.test(p); })
    };
  }

  // ------------------------------------------------------------------- view
  function buildOverlay() {
    var root = document.createElement('div');
    root.id = 'preloader';
    root.innerHTML =
      '<div class="pl-inner">' +
      '<div class="pl-title">Loading</div>' +
      '<div class="pl-track"><div class="pl-fill" id="plFill"></div></div>' +
      '<div class="pl-pct" id="plPct">0%</div>' +
      '</div>';
    document.body.appendChild(root);
    return {
      root: root,
      fill: root.querySelector('#plFill'),
      pct: root.querySelector('#plPct')
    };
  }

  // ------------------------------------------------------------ decode work
  /** Resolves once the bitmap is decoded, or on error/timeout -- never rejects. */
  function loadImage(src) {
    return new Promise(function (res) {
      var done = false;
      function finish() { if (!done) { done = true; res(src); } }
      var im = new Image();
      im.onload = function () {
        // decode() moves the rasterise cost off the first animation frame
        if (im.decode) im.decode().then(finish, finish); else finish();
      };
      im.onerror = finish;
      im.src = src;
      setTimeout(finish, TIMING.assetTimeout);
    });
  }

  /** Reads duration metadata; caches it for the caption/VO sync. */
  function loadAudioMeta(src) {
    return new Promise(function (res) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        if (isFinite(a.duration) && a.duration > 0) window.AUDIO_DURATIONS[src] = a.duration;
        res(src);
      }
      var a = new Audio();
      a.preload = 'auto';
      a.addEventListener('loadedmetadata', finish, { once: true });
      a.addEventListener('error', finish, { once: true });
      a.src = src;
      setTimeout(finish, TIMING.metaTimeout);
    });
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    return Promise.race([
      document.fonts.ready,
      new Promise(function (r) { setTimeout(r, TIMING.metaTimeout); })
    ]);
  }

  // ------------------------------------------------------------------- run
  /**
   * Raise an opaque veil, decode everything behind it, then fade it out. The
   * game boots as usual underneath, so the frame revealed is already complete.
   */
  function hold(onReady) {
    var list = manifest();
    var jobs = list.images.map(function (p) { return { kind: 'img', src: p }; })
      .concat(list.audio.map(function (p) { return { kind: 'aud', src: p }; }));
    var total = jobs.length + 1;             // +1 for the font pass
    var done = 0;
    var view = buildOverlay();

    function tick() {
      done++;
      var pctVal = Math.min(100, Math.round(done / total * 100));
      view.fill.style.width = pctVal + '%';
      view.pct.textContent = pctVal + '%';
    }

    var work = jobs.map(function (j) {
      return (j.kind === 'img' ? loadImage(j.src) : loadAudioMeta(j.src)).then(tick);
    });
    work.push(fontsReady().then(tick));

    return Promise.all(work).then(function () {
      view.root.classList.add('pl-gone');
      if (onReady) onReady();
      setTimeout(function () {
        if (view.root.parentNode) view.root.parentNode.removeChild(view.root);
      }, TIMING.fadeOut + 60);
    });
  }

  return { hold: hold, manifest: manifest };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Preloader;
