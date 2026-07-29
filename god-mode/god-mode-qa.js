/* ==========================================================================
 * god-mode-qa.js -- automated checks against the live game and the real DOM
 *
 * Every assertion reads the running instance, never a fixture, so a regression
 * in engine.js or data.js shows up here. The regressions these were written
 * against are called out on the individual tests.
 * ======================================================================== */
'use strict';

window.GodModeQA = function () {
  var U = window.GodModeUtils;
  var out = null, lines = [];

  var EXPECTED = {
    rounds: 9,               // nine hidden-object targets
    stripButtons: 9,
    clips: 23,
    minTapStage: 80          // stage px, kid-comfortable
  };

  function init() { out = document.getElementById('qaOutput'); }

  // ------------------------------------------------------------------ output
  function reset(title) {
    lines = [];
    head(title);
  }
  function head(t) { lines.push({ k: 'head', t: t }); flush(); }
  function pass(t) { lines.push({ k: 'pass', t: 'PASS  ' + t }); flush(); }
  function fail(t) { lines.push({ k: 'fail', t: 'FAIL  ' + t }); flush(); }
  function warn(t) { lines.push({ k: 'warn', t: 'WARN  ' + t }); flush(); }
  function info(t) { lines.push({ k: 'info', t: '      ' + t }); flush(); }
  function assert(ok, msg) { if (ok) pass(msg); else fail(msg); return !!ok; }

  function flush() {
    if (!out) return;
    out.innerHTML = lines.map(function (l) {
      var esc = String(l.t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return l.k === 'info' ? esc : '<span class="' + l.k + '">' + esc + '</span>';
    }).join('\n');
    out.scrollTop = out.scrollHeight;
  }

  function tally() {
    var f = lines.filter(function (l) { return l.k === 'fail'; }).length;
    var p = lines.filter(function (l) { return l.k === 'pass'; }).length;
    var w = lines.filter(function (l) { return l.k === 'warn'; }).length;
    head((f ? '✗ ' : '✓ ') + p + ' passed, ' + f + ' failed, ' + w + ' warnings');
    return { pass: p, fail: f, warn: w };
  }

  function td() {
    var g = U.game();
    return g && g.game ? g.game.tutorial : null;
  }

  // ------------------------------------------------------------ smoke test
  function smoke() {
    reset('SMOKE TEST');
    var g = U.game();
    if (!assert(!!g, 'game handle exposed (window.lbd1Game)')) return tally();
    assert(!!window.Engine, 'Engine present');
    assert(!!window.LAYOUT && !!window.SPLASH_LAYOUT, 'LAYOUT + SPLASH_LAYOUT embedded');
    assert(!!window.CONFIG, 'CONFIG embedded');
    assert(!!window.Analytics, 'Analytics wrapper present');

    ['setSprite', 'setImageColor', 'setActive', 'setAnchoredPos', 'setSizeDelta',
     'setText', 'relayout', 'stageSize'].forEach(function (m) {
      assert(typeof Engine[m] === 'function', 'Engine.' + m + '()');
    });

    // The bug this exists for: engine.js used to declare setSprite twice, and
    // the hoisted duplicate painted rec.el instead of the .un-img layer, so no
    // runtime sprite swap was ever visible.
    var src = Engine.setSprite.toString();
    assert(src.indexOf('paintImage') >= 0,
      'setSprite routes through paintImage (no duplicate declaration)');
    assert(Engine.setImageColor.toString().indexOf('paintImage') >= 0,
      'setImageColor routes through paintImage');

    var t = td();
    if (!t) { warn('gameplay not loaded yet — tap the splash, then re-run'); return tally(); }
    ['showNextMessage', 'typeText', 'handleNextClick', 'showCaption',
     'applyButtonSet', 'charDelay'].forEach(function (m) {
      assert(typeof t[m] === 'function', 'TutorialDialogue.' + m + '()');
    });
    assert(t.tutorials.length === EXPECTED.rounds,
      EXPECTED.rounds + ' tutorial sets (found ' + t.tutorials.length + ')');
    assert(t.Number_btn.length === EXPECTED.stripButtons,
      EXPECTED.stripButtons + ' strip buttons');
    assert(t.clips.length === EXPECTED.clips,
      EXPECTED.clips + ' audio clips (found ' + t.clips.length + ')');
    assert(!!t.dialogueText && !!Engine.get(t.dialogueText),
      'dialogueText node resolves');
    return tally();
  }

  // -------------------------------------------------------- caption test
  /**
   * ChatText ships inactive and no message enables it, so the typewriter used to
   * write every line into a display:none node -- the whole tutorial played with
   * no captions. This asserts the caption is genuinely on screen.
   */
  function captions() {
    reset('CAPTION / VO TEST');
    var t = td();
    if (!t) { warn('load gameplay first'); return tally(); }
    var rec = Engine.get(t.dialogueText);
    assert(!!rec, 'caption node exists');
    if (!rec) return tally();
    assert(Engine.isActiveInHierarchy(t.dialogueText),
      'caption node is active in hierarchy');
    assert(getComputedStyle(rec.el).display !== 'none',
      'caption node is not display:none');
    var r = U.stageRectOf(rec.el);
    assert(r.w > 100 && r.h > 20,
      'caption box has area (' + U.round(r.w, 0) + '×' + U.round(r.h, 0) + ' stage px)');
    assert(r.y >= -2 && r.y + r.h <= U.stageSize()[1] + 2,
      'caption box is inside the canvas vertically');

    /*
     * The caption must sit in the panel graphic's INNER FIELD, not in the centre
     * of its rect. Group_7.png is 1536x237 stretched to 1871x306, and its
     * recessed field occupies rows 34-151 of 237 -- i.e. 14.3% to 64.1% of the
     * panel's height, well above the rect's midpoint, because the sprite carries
     * a deep bottom lip. Centring on the rect (anchoredPosition.y == 0) drops the
     * text about 33px below the field and reads as misaligned; the scene's own
     * authored 32 is almost exactly the field centre.
     *
     * An earlier version of this test asserted ap.y == 0 and would have rejected
     * a correct value. Measure against the artwork, not the box.
     */
    var FIELD_TOP = 0.143, FIELD_BOTTOM = 0.641;
    var panel = rec.parent;
    if (panel) {
      var pr = U.stageRectOf(panel.el);
      var fieldTop = pr.y + pr.h * FIELD_TOP;
      var fieldBottom = pr.y + pr.h * FIELD_BOTTOM;
      var glyphMid = r.y + r.h / 2;
      assert(glyphMid > fieldTop && glyphMid < fieldBottom,
        'caption sits inside the panel\'s inner field (' +
        U.round(fieldTop, 0) + '-' + U.round(fieldBottom, 0) + ', is ' +
        U.round(glyphMid, 0) + ')');
      var off = glyphMid - (fieldTop + fieldBottom) / 2;
      if (Math.abs(off) > 22) {
        fail('caption is ' + U.round(off, 1) + 'px off the inner field centre');
      } else {
        pass('caption is centred on the panel\'s inner field (off by ' +
          U.round(off, 1) + 'px)');
      }
    }
    // and the three caption slots must agree, or text jumps between states
    var slots = ['ChatText', 'ChatTextEnd', 'incoorect_text'].map(function (n) {
      return U.nodes().filter(function (x) { return x.data.name === n; })[0];
    }).filter(Boolean);
    var same = slots.every(function (s) {
      return s.data.anchoredPosition[0] === slots[0].data.anchoredPosition[0] &&
             s.data.anchoredPosition[1] === slots[0].data.anchoredPosition[1];
    });
    assert(same, 'all ' + slots.length +
      ' caption slots share one position (normal / end / error do not jump)');

    var durs = window.AUDIO_DURATIONS || {};
    assert(Object.keys(durs).length > 0,
      'VO durations cached by the preloader (' + Object.keys(durs).length + ' clips)');

    var drift = [], missing = [], mismatch = 0;
    t.tutorials.forEach(function (tut, ti) {
      (tut.messages || []).forEach(function (m, mi) {
        var txt = String(m.message == null ? '' : m.message);
        var idx = m.__voIndex != null ? m.__voIndex : m.audioIndex;
        if (idx < 0) return;
        var clip = t.clips[idx];
        if (!clip) { missing.push(ti + '.' + mi); return; }
        var dur = durs[clip];
        if (!dur) return;
        var typed = txt.length * t.charDelay(m, txt.length);
        var d = Math.abs(typed - dur);
        if (d > 0.25) drift.push(ti + '.' + mi + ' ' + U.round(d, 2) + 's');
        // a loose word-overlap check between the caption and the clip filename
        var slug = clip.split('/').pop().replace(/\.(ogg|mp3|wav)$/i, '')
          .replace(/^OLD_\d*_?/, '').replace(/_/g, ' ').toLowerCase();
        var words = txt.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/)
          .filter(function (w) { return w.length > 3; });
        var hit = words.filter(function (w) { return slug.indexOf(w) >= 0; }).length;
        if (words.length && hit / words.length < 0.5) {
          mismatch++;
          warn('caption/clip wording differs at ' + ti + '.' + mi +
            ' — "' + txt.trim().slice(0, 40) + '" vs ' + clip.split('/').pop());
        }
      });
    });
    assert(!missing.length, 'every audioIndex resolves to a clip' +
      (missing.length ? ' (broken: ' + missing.join(', ') + ')' : ''));
    assert(!drift.length, 'typing duration matches VO within 0.25s' +
      (drift.length ? ' (drift: ' + drift.slice(0, 6).join(', ') + ')' : ''));
    if (!mismatch) pass('caption wording overlaps its clip filename on every line');
    return tally();
  }

  // ------------------------------------------------------- round data test
  function roundData() {
    reset('ROUND DATA TEST');
    var t = td();
    if (!t) { warn('load gameplay first'); return tally(); }
    var ok = true;
    t.tutorials.forEach(function (tut, i) {
      var msgs = tut.messages || [];
      if (!msgs.length) { fail('round ' + (i + 1) + ' has no messages'); ok = false; return; }
      var hasHotspot = msgs.some(function (m) {
        var id = m.inputButton && window.Game ? Game.go(m.inputButton) : null;
        return id && Engine.get(id) && Engine.get(id).data.name === 'Button';
      });
      var hasStrip = msgs.some(function (m) {
        var id = m.inputButton && window.Game ? Game.go(m.inputButton) : null;
        return id && t.Number_btn.indexOf(id) >= 0;
      });
      if (!hasHotspot) { fail('round ' + (i + 1) + ' has no hidden-object hotspot'); ok = false; }
      if (!hasStrip) { fail('round ' + (i + 1) + ' has no strip-button prompt'); ok = false; }
      msgs.forEach(function (m, mi) {
        var txt = String(m.message == null ? '' : m.message);
        if (/\b(score|level \d|round \d|combo)\b/i.test(txt)) {
          warn('round ' + (i + 1) + '.' + mi + ' uses gamey wording: "' + txt.trim() + '"');
        }
        if (txt.length > 140) {
          warn('round ' + (i + 1) + '.' + mi + ' is ' + txt.length + ' chars (long for 5-7s)');
        }
        if (/ {2,}/.test(txt)) {
          warn('round ' + (i + 1) + '.' + mi + ' has a double space: "' + txt.trim() + '"');
        }
      });
    });
    if (ok) pass('all ' + t.tutorials.length + ' rounds have a hotspot and a strip prompt');
    assert(t.Number_btn.every(function (id) { return !!Engine.get(id); }),
      'all 9 strip buttons resolve to live nodes');
    return tally();
  }

  // ---------------------------------------------------------- sprite test
  /**
   * Walks every node with an Image and asserts the sprite recorded in the model
   * is the one actually painted on the .un-img layer -- the direct assertion
   * against the duplicate-declaration bug (bag stuck on empty_sack, number
   * buttons never turning green/red, the shake tint silhouetting the cave).
   */
  function sprites() {
    reset('SPRITE INTEGRITY TEST');
    var bad = [], leak = [], noLayer = [];
    U.nodes().forEach(function (r) {
      if (!r.img || !r.img.enabled) return;
      var layer = r.el.querySelector(':scope > .un-img');
      var s = r.img.sprite;
      if (!s || !s.path) return;
      if (!layer) { noLayer.push(U.pathOf(r)); return; }
      if (r.sliced) return;                       // border-image path, no bg url
      if (layer.style.backgroundImage.indexOf(s.path) < 0) {
        bad.push(U.pathOf(r) + ' → model ' + s.path.split('/').pop() +
          ', painted ' + (layer.style.backgroundImage || '(none)'));
      }
      var m = r.el.style.maskImage || r.el.style.webkitMaskImage;
      if (m) leak.push(U.pathOf(r) + ' has mask-image: ' + m);
    });
    assert(!bad.length, 'painted sprite matches the model on every Image' +
      (bad.length ? ' (' + bad.length + ' mismatched)' : ''));
    bad.slice(0, 8).forEach(function (b) { info(b); });
    assert(!leak.length, 'no mask-image leaks onto a node subtree' +
      (leak.length ? ' (' + leak.length + ' found)' : ''));
    leak.slice(0, 5).forEach(function (b) { info(b); });
    if (noLayer.length) warn(noLayer.length + ' Image node(s) without a .un-img layer');
    return tally();
  }

  // ----------------------------------------------------- interaction test
  function interaction() {
    reset('INTERACTION TEST');
    var t = td();
    if (!t) { warn('load gameplay first'); return tally(); }
    var btns = U.nodes().filter(function (r) { return r.btn; });
    assert(btns.length > 0, btns.length + ' Button nodes bound');
    assert(btns.every(function (r) { return r._clickBound; }),
      'every Button has its pointer handlers attached');
    assert(t.Number_btn.every(function (id) {
      var r = Engine.get(id);
      return r && r._persist && r._persist.length > 0;
    }), 'all 9 strip buttons carry a persistent onClick (ValidateClick)');

    // stale-tap guard: handleNextClick used to index past the end of `tutorials`
    var savedT = t.tutorialIndex, savedM = t.messageIndex;
    var threw = false;
    try {
      t.tutorialIndex = t.tutorials.length;
      t.messageIndex = 0;
      t.handleNextClick();
    } catch (e) { threw = true; }
    t.tutorialIndex = savedT;
    t.messageIndex = savedM;
    assert(!threw, 'handleNextClick survives a tap after the final line');

    var small = t.Number_btn.filter(function (id) {
      var r = U.stageRectOf(Engine.get(id).el);
      return r.w < EXPECTED.minTapStage || r.h < EXPECTED.minTapStage;
    });
    if (small.length) {
      warn(small.length + ' strip button(s) under ' + EXPECTED.minTapStage +
        'px in stage space (authored at 108×105 — expected)');
    } else {
      pass('strip buttons meet the ' + EXPECTED.minTapStage + 'px stage target');
    }
    return tally();
  }

  // ------------------------------------------------------ responsive test
  function responsive() {
    reset('RESPONSIVE / SCALE TEST');
    var s = Engine.scale(), size = Engine.stageSize();
    info('viewport ' + window.innerWidth + '×' + window.innerHeight +
      '  scale ' + U.round(s, 4) + '  canvas ' + U.round(size[0], 1) + '×' + U.round(size[1], 1));
    assert(s > 0, 'canvas scale is positive');
    assert(Math.abs(s - Math.min(window.innerWidth / 1920, window.innerHeight / 1080)) < 1e-6,
      'scale equals min(w/1920, h/1080) — CanvasScaler Expand');
    assert(document.documentElement.scrollWidth <= window.innerWidth + 1,
      'no horizontal page scroll');
    assert(document.documentElement.scrollHeight <= window.innerHeight + 1,
      'no vertical page scroll');

    var t = td();
    if (t) {
      var cssPx = t.Number_btn.map(function (id) {
        return Engine.get(id).el.getBoundingClientRect().width;
      });
      var min = Math.min.apply(null, cssPx);
      info('smallest strip button on screen: ' + U.round(min, 1) + ' CSS px');
      if (min < 44) {
        warn('strip buttons are under the 44px touch minimum at this viewport' +
          (window.Orientation && Orientation.isBlockedPortrait()
            ? ' (portrait guard is active, so a learner never sees this)'
            : ' — rotate or widen the window'));
      } else {
        pass('strip buttons clear the 44px touch minimum');
      }
    }
    if (window.Orientation) {
      pass('portrait guard installed (blocked here: ' + Orientation.isBlockedPortrait() + ')');
    } else {
      warn('js/orientation.js not loaded');
    }
    return tally();
  }

  // --------------------------------------------------------- loading test
  function loading() {
    reset('LOADING TEST');
    if (!window.Preloader) { warn('js/preloader.js not loaded'); return tally(); }
    var m = Preloader.manifest();
    info(m.images.length + ' images, ' + m.audio.length + ' clips in the manifest');
    assert(m.images.length > 0, 'image manifest is non-empty');
    assert(m.audio.length > 0, 'audio manifest is non-empty');

    // Loading is two-phase: the veil only waits for the splash assets, and the
    // gameplay payload streams in behind it. Asserting the whole manifest is
    // cached is therefore only meaningful once phase 2 reports done -- before
    // that, cold images are correct behaviour, not a defect.
    var split = Preloader.splitManifest ? Preloader.splitManifest() : null;
    if (split) {
      info('phase 1 (veil waits): ' + split.splash.images.length + ' images, ' +
        split.splash.audio.length + ' clips');
      info('phase 2 (background): ' + split.rest.images.length + ' images, ' +
        split.rest.audio.length + ' clips');
      var coldSplash = split.splash.images.filter(function (src) {
        var im = new Image(); im.src = src; return !im.complete;
      });
      assert(!coldSplash.length, 'every splash image is in cache' +
        (coldSplash.length ? ' (' + coldSplash.length + ' cold)' : ''));
    }

    var restReady = Preloader.isRestReady ? Preloader.isRestReady() : true;
    var undecoded = m.images.filter(function (src) {
      var im = new Image(); im.src = src; return !im.complete;
    });
    if (restReady) {
      assert(!undecoded.length, 'every manifest image is in cache' +
        (undecoded.length ? ' (' + undecoded.length + ' cold)' : ''));
    } else {
      info('phase 2 still loading — ' + undecoded.length +
        ' image(s) not yet cached, which is expected at this point');
      pass('background payload is in flight (re-run once it settles)');
    }

    var durs = window.AUDIO_DURATIONS || {};
    // Caption pacing needs a duration for the clip it is about to speak; the
    // whole set only has to be there once phase 2 finishes.
    if (restReady) {
      assert(Object.keys(durs).length >= m.audio.length * 0.8,
        'VO metadata read for most clips (' + Object.keys(durs).length + '/' +
        m.audio.length + ')');
    } else {
      info('VO durations cached so far: ' + Object.keys(durs).length + '/' + m.audio.length);
    }

    assert(!document.getElementById('preloader'),
      'the loading veil has been torn down');
    return tally();
  }

  // ------------------------------------------------------- analytics test
  function analytics() {
    reset('ANALYTICS TEST');
    if (!window.Analytics) { fail('Analytics missing'); return tally(); }
    var log = Analytics.log();
    info(log.length + ' event(s) recorded this session');
    var bad = log.filter(function (r) {
      var a = r.args;
      return a.length !== 5 || typeof a[0] !== 'number' || typeof a[3] !== 'boolean';
    });
    assert(!bad.length, 'every event matches (q_id, selected, correct, isCorrect, attempt)');
    var dupes = Object.create(null), repeated = [];
    log.forEach(function (r) {
      var k = r.args.slice(0, 2).join('/');
      dupes[k] = (dupes[k] || 0) + 1;
    });
    Object.keys(dupes).forEach(function (k) {
      if (dupes[k] > 1) repeated.push(k + ' ×' + dupes[k]);
    });
    if (repeated.length) warn('repeated (question, answer) pairs: ' + repeated.join(', '));
    else pass('no duplicate submissions');
    if (typeof window.quizAnswerSubmitted !== 'function') {
      info('host hook window.quizAnswerSubmitted absent — console fallback in use');
    }
    return tally();
  }

  function runAll() {
    var totals = { pass: 0, fail: 0, warn: 0 };
    var all = [];
    [smoke, captions, roundData, sprites, interaction, responsive, loading, analytics]
      .forEach(function (fn) {
        var t = fn();
        all = all.concat(lines);
        totals.pass += t.pass; totals.fail += t.fail; totals.warn += t.warn;
      });
    lines = all;
    head('══ FULL SUITE: ' + totals.pass + ' passed, ' + totals.fail +
      ' failed, ' + totals.warn + ' warnings ══');
    return totals;
  }

  function copyReport() {
    var text = 'Hidden Gem Sequence (lbd1) — QA report\n' +
      new Date().toISOString() + '\n' +
      'viewport ' + window.innerWidth + '×' + window.innerHeight + '\n\n' +
      lines.map(function (l) { return l.t; }).join('\n');
    return U.copyText(text).then(function () { U.toast('QA report copied'); });
  }

  return {
    init: init, smoke: smoke, captions: captions, roundData: roundData,
    sprites: sprites, interaction: interaction, responsive: responsive,
    loading: loading, analytics: analytics, runAll: runAll, copyReport: copyReport
  };
};
