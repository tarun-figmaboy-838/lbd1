/* ==========================================================================
 * god-mode-ux-review.js -- kid-focused heuristics with on-screen highlighting
 *
 * All size checks run in STAGE space (the 1920x1080 design grid), so the
 * preview's scale-to-fit can never fake a pass or a failure. Offending nodes get
 * .uxIssue / .uxWarning / .uxGood so the problem is visible on the game itself,
 * not only in a list.
 * ======================================================================== */
'use strict';

window.GodModeUXReview = function () {
  var U = window.GodModeUtils;

  var LIMITS = {
    tapStage: 80,          // comfortable tap target for 5-7 year-olds
    tapCss: 44,            // platform minimum, measured on the real screen
    textStage: 24,         // readable body size on the design grid
    longString: 120,
    veryLongString: 140,
    contrastMin: 3.0       // large display text
  };

  var panel = null, out = null, marked = [];

  function init() {
    panel = document.getElementById('godReview');
    out = document.getElementById('uxOutput');
  }

  // ------------------------------------------------------------------ output
  var lines = [];
  function reset(t) { lines = []; head(t); show(); }
  function head(t) { lines.push({ k: 'head', t: t }); }
  function issue(t) { lines.push({ k: 'fail', t: '● ' + t }); }
  function maybe(t) { lines.push({ k: 'warn', t: '● ' + t }); }
  function good(t) { lines.push({ k: 'pass', t: '● ' + t }); }
  function note(t) { lines.push({ k: 'info', t: '   ' + t }); }
  function show() {
    if (panel) panel.classList.add('godOpen');
    if (!out) return;
    out.innerHTML = lines.map(function (l) {
      var esc = String(l.t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return l.k === 'info' ? esc : '<span class="' + l.k + '">' + esc + '</span>';
    }).join('\n');
  }

  function mark(el, cls) {
    if (!el) return;
    el.classList.add(cls);
    marked.push([el, cls]);
  }
  function clear() {
    marked.forEach(function (p) { p[0].classList.remove(p[1]); });
    marked = [];
    if (panel) panel.classList.remove('godOpen');
    lines = [];
    if (out) out.innerHTML = '';
  }

  function visibleNodes() {
    return U.nodes().filter(function (r) {
      return Engine.isActiveInHierarchy(r.id) && U.isVisible(r.el);
    });
  }

  // ----------------------------------------------------------- tap targets
  function tapTargets() {
    reset('TAP TARGETS  —  can a small finger hit it?');
    var btns = visibleNodes().filter(function (r) { return r.btn; });
    if (!btns.length) { note('no interactive elements on screen right now'); show(); return; }
    var bad = 0, tight = 0;
    btns.forEach(function (r) {
      var s = U.stageRectOf(r.el);
      var c = r.el.getBoundingClientRect();
      var name = U.pathOf(r);
      if (s.w < LIMITS.tapStage || s.h < LIMITS.tapStage) {
        issue(name + ' is ' + U.round(s.w, 0) + '×' + U.round(s.h, 0) +
          ' on the design grid — under ' + LIMITS.tapStage + 'px');
        mark(r.el, 'uxIssue'); bad++;
      } else if (c.width < LIMITS.tapCss || c.height < LIMITS.tapCss) {
        maybe(name + ' is only ' + U.round(c.width, 0) + '×' + U.round(c.height, 0) +
          ' real pixels here — fine in the design, too small on this screen');
        mark(r.el, 'uxWarning'); tight++;
      } else {
        mark(r.el, 'uxGood');
      }
    });
    if (!bad && !tight) good('all ' + btns.length + ' targets are comfortable');
    else note(btns.length + ' checked · ' + bad + ' too small by design · ' + tight + ' too small on this screen');
    show();
  }

  // -------------------------------------------------------- text readability
  function textReadability() {
    reset('TEXT  —  is it big enough, and does it fit?');
    var texts = visibleNodes().filter(function (r) {
      return r.tmpEl && r.tmpEl.textContent.trim().length > 0;
    });
    if (!texts.length) { note('no visible text on screen right now'); show(); return; }
    var problems = 0;
    texts.forEach(function (r) {
      var name = U.pathOf(r);
      var str = r.tmpEl.textContent;
      var fs = parseFloat(getComputedStyle(r.tmpEl).fontSize) / U.stageScale();
      if (fs < LIMITS.textStage) {
        issue(name + ' renders at ' + U.round(fs, 1) + 'px on the design grid — under ' +
          LIMITS.textStage + 'px');
        mark(r.el, 'uxIssue'); problems++;
      }
      var inner = r.tmpEl;
      if (inner.scrollWidth > r.el.clientWidth + 2 ||
          inner.scrollHeight > r.el.clientHeight + 2) {
        issue(name + ' overflows its box (' + inner.scrollWidth + '×' + inner.scrollHeight +
          ' inside ' + r.el.clientWidth + '×' + r.el.clientHeight + ')');
        mark(r.el, 'uxIssue'); problems++;
      }
      if (str.length > LIMITS.longString) {
        maybe(name + ' is ' + str.length + ' characters — long for a 5-7 year-old');
        mark(r.el, 'uxWarning'); problems++;
      }
      if (/ {2,}/.test(str)) {
        maybe(name + ' contains a double space: "' + str.trim().slice(0, 48) + '"');
        mark(r.el, 'uxWarning'); problems++;
      }
      if (/\r/.test(str)) {
        maybe(name + ' contains a stray carriage return');
        mark(r.el, 'uxWarning'); problems++;
      }
      if (!problems) mark(r.el, 'uxGood');
    });
    if (!problems) good('all ' + texts.length + ' text blocks are readable and fit');
    show();
  }

  // ------------------------------------------------------ visual hierarchy
  function hierarchy() {
    reset('HIERARCHY  —  does the eye land in the right place?');
    var vis = visibleNodes();
    var stage = U.stageSize();
    var full = vis.filter(function (r) {
      var s = U.stageRectOf(r.el);
      return s.w >= stage[0] * 0.97 && s.h >= stage[1] * 0.97;
    });
    note(full.length + ' full-bleed layer(s): ' +
      (full.map(function (r) { return r.data.name; }).join(', ') || 'none'));

    var g = U.game();
    var t = g && g.game ? g.game.tutorial : null;
    if (t) {
      var caption = Engine.get(t.dialogueText);
      if (caption && Engine.isActiveInHierarchy(t.dialogueText)) {
        var cs = U.stageRectOf(caption.el);
        good('caption is on screen at ' + U.round(cs.x, 0) + ', ' + U.round(cs.y, 0));
        mark(caption.el, 'uxGood');
        if (cs.y > stage[1] * 0.5) {
          maybe('the caption sits in the lower half — instructions usually read better up top');
        }
      } else {
        issue('the caption node is not visible — instruction text will not be read');
      }
      var strip = t.Number_btn.map(function (id) { return U.stageRectOf(Engine.get(id).el); });
      var avg = strip.reduce(function (a, r) { return a + r.w * r.h; }, 0) / strip.length;
      note('average strip button area ' + U.round(avg, 0) + 'px² on the design grid');
    }

    var offStage = vis.filter(function (r) {
      var s = U.stageRectOf(r.el);
      return s.x < -4 || s.y < -4 || s.x + s.w > stage[0] + 4 || s.y + s.h > stage[1] + 4;
    });
    offStage.forEach(function (r) {
      var s = U.stageRectOf(r.el);
      maybe(U.pathOf(r) + ' extends past the canvas edge (' +
        U.round(s.x, 0) + ', ' + U.round(s.y, 0) + ' ' +
        U.round(s.w, 0) + '×' + U.round(s.h, 0) + ')');
      mark(r.el, 'uxWarning');
    });
    if (!offStage.length) good('nothing spills past the canvas edge');
    show();
  }

  // ------------------------------------------------------------- clutter
  function clutter() {
    reset('CLUTTER  —  how much is competing for attention?');
    var vis = visibleNodes();
    var art = vis.filter(function (r) { return r.img && r.img.sprite && r.img.sprite.path; });
    note(vis.length + ' visible nodes · ' + art.length + ' with artwork');
    var btns = vis.filter(function (r) { return r.btn && Engine.isInteractable(r.id); });
    note(btns.length + ' element(s) tappable right now');
    if (btns.length > 12) {
      maybe(btns.length + ' tappable elements at once is a lot of choice for this age');
    } else {
      good('the number of live choices is manageable');
    }

    var g = U.game();
    var t = g && g.game ? g.game.tutorial : null;
    if (t) {
      var boxes = [t.CorrectTextobject, t.incorrectTextobject].filter(function (id) {
        return id && Engine.isActiveInHierarchy(id);
      });
      if (boxes.length > 1) {
        issue('both the caption panel and the "count carefully" panel are showing at once');
        boxes.forEach(function (id) { mark(Engine.get(id).el, 'uxIssue'); });
      } else {
        good('exactly ' + boxes.length + ' message panel visible');
      }
      var hands = vis.filter(function (r) { return r.data.name === 'hand'; });
      if (hands.length > 1) {
        maybe(hands.length + ' tap hints pointing at once');
        hands.forEach(function (r) { mark(r.el, 'uxWarning'); });
      }
    }
    show();
  }

  // --------------------------------------------------------- kid-friendly
  function kidFriendly() {
    reset('KID-FRIENDLY  —  wording a 5-7 year-old can follow');
    var g = U.game();
    var t = g && g.game ? g.game.tutorial : null;
    if (!t) { note('load gameplay first'); show(); return; }
    var problems = 0;
    var GAMEY = /\b(score|final score|level \d|round \d|combo|xp|points?)\b/i;
    t.tutorials.forEach(function (tut, ti) {
      (tut.messages || []).forEach(function (m, mi) {
        var txt = String(m.message == null ? '' : m.message);
        var tag = 'round ' + (ti + 1) + ', line ' + (mi + 1);
        if (GAMEY.test(txt)) {
          issue(tag + ' uses gamey wording: "' + txt.trim() + '"'); problems++;
        }
        if (txt.length > LIMITS.veryLongString) {
          issue(tag + ' is ' + txt.length + ' characters'); problems++;
        }
        if (/\d/.test(txt)) {
          maybe(tag + ' contains a digit — this game teaches counting by word: "' +
            txt.trim() + '"');
          problems++;
        }
      });
    });
    var strings = visibleNodes().filter(function (r) { return r.tmpEl; })
      .map(function (r) { return r.tmpEl.textContent; });
    strings.forEach(function (s) {
      if (GAMEY.test(s)) { issue('on-screen text uses gamey wording: "' + s.trim() + '"'); problems++; }
    });
    if (!problems) good('every line reads as plain, friendly instruction');
    else note(problems + ' wording issue(s) found');
    show();
  }

  // --------------------------------------------------------- audio/caption
  function audioPairing() {
    reset('VOICE-OVER  —  does the child hear what they see?');
    var g = U.game();
    var t = g && g.game ? g.game.tutorial : null;
    if (!t) { note('load gameplay first'); show(); return; }
    var durs = window.AUDIO_DURATIONS || {};
    if (!Object.keys(durs).length) {
      maybe('no VO durations cached — the preloader has not run, so captions cannot be timed');
      show(); return;
    }
    var silent = 0, drifted = 0;
    t.tutorials.forEach(function (tut, ti) {
      (tut.messages || []).forEach(function (m, mi) {
        var tag = 'round ' + (ti + 1) + ', line ' + (mi + 1);
        var txt = String(m.message == null ? '' : m.message);
        var idx = m.__voIndex != null ? m.__voIndex : m.audioIndex;
        if (idx < 0) {
          if (!m.isRandom) { maybe(tag + ' has no voice-over: "' + txt.trim() + '"'); silent++; }
          return;
        }
        var clip = t.clips[idx];
        var dur = clip ? durs[clip] : null;
        if (!dur) return;
        var typed = txt.length * t.charDelay(m, txt.length);
        if (Math.abs(typed - dur) > 0.25) {
          maybe(tag + ' caption takes ' + U.round(typed, 2) + 's against a ' +
            U.round(dur, 2) + 's clip');
          drifted++;
        }
      });
    });
    if (!silent) good('every spoken line has a caption and vice versa');
    if (!drifted) good('captions finish with their voice-over on every line');
    show();
  }

  function runAll() {
    var all = [];
    [tapTargets, textReadability, hierarchy, clutter, kidFriendly, audioPairing]
      .forEach(function (fn) { fn(); all = all.concat(lines); });
    lines = all;
    lines.unshift({ k: 'head', t: 'FULL UI/UX REVIEW — ' + new Date().toLocaleTimeString() });
    show();
  }

  function copyReport() {
    var text = 'Hidden Gem Sequence (lbd1) — UI/UX review\n' +
      new Date().toISOString() + '\nviewport ' +
      window.innerWidth + '×' + window.innerHeight + '\n\n' +
      lines.map(function (l) { return l.t; }).join('\n');
    return U.copyText(text).then(function () { U.toast('UX report copied'); });
  }

  return {
    init: init, runAll: runAll, clear: clear, copyReport: copyReport,
    tapTargets: tapTargets, textReadability: textReadability,
    hierarchy: hierarchy, clutter: clutter, kidFriendly: kidFriendly,
    audioPairing: audioPairing
  };
};
