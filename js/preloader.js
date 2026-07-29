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

  function listOf(imgs, auds) {
    return {
      images: Object.keys(imgs).filter(function (p) { return IMG_RE.test(p); }),
      audio: Object.keys(auds).filter(function (p) { return AUDIO_RE.test(p); })
    };
  }

  /** Everything, in one list -- what the QA loading test asserts against. */
  function manifest() {
    var imgs = Object.create(null), auds = Object.create(null);
    walkSprites(window.SPLASH_LAYOUT, imgs);
    walkSprites(window.LAYOUT, imgs);
    walkClips(window.CONFIG, auds, 0);
    return listOf(imgs, auds);
  }

  /**
   * Split by scene, because gating the first frame on the whole 4 MB payload cost
   * 12.7 s on a 1.5 Mbps line -- most of it gameplay art the child cannot see yet.
   * The splash needs a few hundred KB; the rest loads behind it while they look at
   * the title and reach for "Let's Go", which is several seconds of real time.
   */
  function splitManifest() {
    var sImg = Object.create(null), sAud = Object.create(null);
    walkSprites(window.SPLASH_LAYOUT, sImg);
    walkClips(window.CONFIG.splashScripts, sAud, 0);

    var allImg = Object.create(null), allAud = Object.create(null);
    walkSprites(window.SPLASH_LAYOUT, allImg);
    walkSprites(window.LAYOUT, allImg);
    walkClips(window.CONFIG, allAud, 0);

    var splash = listOf(sImg, sAud);
    var everything = listOf(allImg, allAud);
    var isSplash = function (p) { return splash.images.indexOf(p) >= 0; };
    var isSplashAudio = function (p) { return splash.audio.indexOf(p) >= 0; };
    return {
      splash: splash,
      rest: {
        images: everything.images.filter(function (p) { return !isSplash(p); }),
        audio: everything.audio.filter(function (p) { return !isSplashAudio(p); })
      }
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
  function runJobs(list, onTick) {
    var jobs = list.images.map(function (p) { return { kind: 'img', src: p }; })
      .concat(list.audio.map(function (p) { return { kind: 'aud', src: p }; }));
    return jobs.map(function (j) {
      var t = j.kind === 'img' ? loadImage(j.src) : loadAudioMeta(j.src);
      return onTick ? t.then(onTick) : t;
    });
  }

  var restReady = null;       // resolves when the gameplay payload is in cache
  var restDone = false;

  /**
   * Raise an opaque veil, decode the SPLASH assets behind it, then fade out. The
   * gameplay payload keeps loading afterwards, so the title appears in about a
   * fifth of the time while nothing the child can reach is missing.
   */
  function hold(onReady) {
    var split = splitManifest();
    var total = split.splash.images.length + split.splash.audio.length + 1;
    var done = 0;
    var view = buildOverlay();

    function tick() {
      done++;
      var pctVal = Math.min(100, Math.round(done / total * 100));
      view.fill.style.width = pctVal + '%';
      view.pct.textContent = pctVal + '%';
    }

    var work = runJobs(split.splash, tick);
    work.push(fontsReady().then(tick));

    return Promise.all(work).then(function () {
      view.root.classList.add('pl-gone');
      if (onReady) onReady();
      setTimeout(function () {
        if (view.root.parentNode) view.root.parentNode.removeChild(view.root);
      }, TIMING.fadeOut + 60);

      // Only now start the gameplay payload. Kicking it off in parallel with the
      // splash assets looked like a free win but the browser shares its handful of
      // connections between them, so the 389 KB the veil was actually waiting on
      // arrived at a fraction of the line rate -- ready-to-play measured 9.4 s
      // instead of the ~3 s the split was supposed to buy.
      restReady = Promise.all(runJobs(split.rest, null)).then(function () {
        restDone = true;
      });
    });
  }

  /**
   * Run `fn` once the gameplay payload is decoded. Normally it already is by the
   * time the child taps, so this is a straight call with no veil and no delay; on
   * a slow line it shows the progress veil rather than letting the scene pop in.
   */
  function gate(fn) {
    if (restDone || !restReady) { fn(); return; }
    var split = splitManifest();
    var total = split.rest.images.length + split.rest.audio.length;
    var view = buildOverlay();
    view.root.classList.remove('pl-gone');
    var poll = setInterval(function () {
      // approximate progress from what the browser has already cached
      var got = split.rest.images.filter(function (s) {
        var im = new Image(); im.src = s; return im.complete;
      }).length;
      var pctVal = Math.min(99, Math.round(got / Math.max(1, total) * 100));
      view.fill.style.width = pctVal + '%';
      view.pct.textContent = pctVal + '%';
    }, 200);
    restReady.then(function () {
      clearInterval(poll);
      view.fill.style.width = '100%';
      view.pct.textContent = '100%';
      view.root.classList.add('pl-gone');
      fn();
      setTimeout(function () {
        if (view.root.parentNode) view.root.parentNode.removeChild(view.root);
      }, TIMING.fadeOut + 60);
    });
  }

  return { hold: hold, gate: gate, manifest: manifest,
           splitManifest: splitManifest,
           isRestReady: function () { return restDone; } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Preloader;
