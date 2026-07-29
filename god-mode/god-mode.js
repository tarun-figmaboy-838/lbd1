/* ==========================================================================
 * god-mode.js -- controller: activation, shortcuts, screen flow, visual debug
 *
 * Everything here is reversible and removable. Delete the <link> and the six
 * <script> tags from index.html and the learner build is untouched; toggling God
 * Mode off at runtime tears down every overlay, class, edit and animation, so a
 * learner can never see a debug affordance.
 *
 * Load order: god-mode-utils.js first, this file last.
 * ======================================================================== */
'use strict';

window.LBD1GodMode = function (game) {
  var U = window.GodModeUtils;
  var E = window.Engine;

  var on = false;
  var editor = null, qa = null, ux = null, anim = null;
  var speed = 1;

  var DEBUG_CLASSES = ['godShowBounds', 'godShowSafeArea', 'godShowTextBoxes',
    'godShowHitAreas', 'godRevealInactive', 'godPauseAnimations'];

  // Nodes worth outlining when "Show bounds" is on.
  var BOUND_KINDS = function (r) { return !!(r.img || r.tmp || r.btn); };

  // ------------------------------------------------------------------- boot
  function init() {
    var root = document.createElement('div');
    root.id = 'godModeRoot';
    document.body.appendChild(root);

    injectPanel(root);
    (function () {
      editor = window.GodModeLiveEditor ? window.GodModeLiveEditor() : null;
      qa = window.GodModeQA ? window.GodModeQA() : null;
      ux = window.GodModeUXReview ? window.GodModeUXReview() : null;
      anim = window.GodModeAnimationBar ? window.GodModeAnimationBar() : null;
      if (editor) editor.init();
      if (qa) qa.init();
      if (ux) ux.init();
      if (anim) anim.init();
      buildSafeArea();
      buildRoundChips();
      bindPanel();
      makeDraggable();
      bindShortcuts();
      if (E && E.onTick) E.onTick(tickState);

      // Three ways in, so a swallowed keystroke is never a dead end: the
      // shortcut, a ?god=1 / ?debug=1 query flag (the same convention the debug
      // overlay spec uses), and window.god() from the console.
      window.god = function () { toggle(); return 'God Mode ' + (on ? 'ON' : 'OFF'); };
      if (/[?&](god|debug)=1/.test(location.search)) toggle(true);

      console.log('[God Mode] ready. Toggle with Shift+G, or append ?god=1 to the ' +
        'URL, or run god() here.');
    })();
  }

  /**
   * Synchronous and offline. god-mode-panel.js assigns the markup to
   * window.GOD_PANEL_HTML, so http:// and file:// behave identically; the old
   * fetch of god-mode-panel.html was blocked on file:// and silently dropped
   * users onto a stripped fallback panel.
   */
  function injectPanel(root) {
    if (window.GOD_PANEL_HTML) { root.innerHTML = window.GOD_PANEL_HTML; return; }
    root.innerHTML = FALLBACK_HTML();
    console.warn('[God Mode] god-mode-panel.js not loaded — minimal fallback in use');
  }

  // ------------------------------------------------------------- activation
  function toggle(force) {
    on = force == null ? !on : !!force;
    document.body.classList.toggle('godMode', on);
    if (!on) teardown();
    else U.toast('God Mode ON — Shift+G to exit');
  }

  /** Full teardown: nothing God Mode did may survive into the learner build. */
  function teardown() {
    DEBUG_CLASSES.forEach(function (c) { document.body.classList.remove(c); });
    U.qsa('#godPanel input[type=checkbox]').forEach(function (c) { c.checked = false; });
    U.qsa('.godBounds').forEach(function (el) {
      el.classList.remove('godBounds', 'godBoundsText');
    });
    setSpeed(1);
    if (editor) editor.resetAll();
    if (ux) ux.clear();
    if (anim) anim.reset();
    U.qsa('.godPanel').forEach(function (p) { p.classList.remove('godMin'); });
    var box = document.getElementById('godSelBox');
    if (box) box.classList.remove('on');
  }

  // -------------------------------------------------------------- game access
  function tutorial() {
    var g = U.game();
    return g && g.game ? g.game.tutorial : null;
  }
  function ensureLoaded() {
    var g = U.game();
    if (!g) return false;
    if (!g.isLoaded()) { E.unlockAudio(); g.loadGameplay(); }
    return true;
  }

  /**
   * Replay a round from its first line. The dialogue owns all state, so the jump
   * is done through its own showNextMessage() rather than by poking the DOM --
   * every objectsToEnable / objectsToDisable list still runs in order.
   */
  function gotoRound(index) {
    if (!ensureLoaded()) return;
    var t = tutorial();
    if (!t) return;
    t.typing.cancel();
    t.btnGroup.cancel();
    hideTransients();
    t.tutorialIndex = Math.max(0, Math.min(t.tutorials.length - 1, index));
    t.messageIndex = 0;
    t.Attemptnumber = 0;
    t.currentCollectedGemsIndex = t.tutorialIndex;
    t.applyButtonSet();
    t.showNextMessage();
    U.toast('Round ' + (t.tutorialIndex + 1));
  }

  /** Hide the per-round props so jumped-to screens never stack. */
  function hideTransients() {
    U.nodes().forEach(function (r) {
      var n = String(r.data.name || '');
      if (n === 'hand' || n === 'gem' || n === 'Button' || /^GlowEffect_/.test(n) ||
          n === 'complation panel' || n === 'Incorrect State' ||
          n === 'incorrectChatBox' || n === 'Final Bag') {
        if (r.activeSelf) E.setActive(r.id, false);
      }
    });
  }

  function jumpSplash() {
    var g = U.game();
    if (!g) return;
    (window.SPLASH_LAYOUT || []).forEach(function (r) { E.setActive(String(r.id), true); });
    (window.LAYOUT || []).forEach(function (r) { E.setActive(String(r.id), false); });
    E.relayout();
    U.toast('Splash');
  }

  function jumpGameplay() {
    if (!ensureLoaded()) return;
    gotoRound(0);
  }

  function jumpWrong() {
    if (!ensureLoaded()) return;
    var t = tutorial();
    if (!t) return;
    var g = U.game();
    // drive the real wrong-answer flow through a strip button's own controller
    var comp = Object.keys(g.game.buttonByComp)[4];
    var btn = g.game.buttonByComp[comp];
    if (!btn) { U.toast('no strip controller found'); return; }
    t.currentCollectedGemsIndex = 1;
    t.applyButtonSet();
    btn.validateClick();
    U.toast('Wrong feedback');
  }

  function jumpComplete() {
    if (!ensureLoaded()) return;
    var t = tutorial();
    if (!t) return;
    t.typing.cancel();
    hideTransients();
    t.currentCollectedGemsIndex = 9;
    t.applyButtonSet();
    t.tutorialIndex = t.tutorials.length - 1;
    t.messageIndex = t.tutorials[t.tutorialIndex].messages.length - 1;
    t.showNextMessage();
    U.toast('All collected');
  }

  function revealGem() {
    var t = tutorial();
    if (!t) return;
    var tut = t.tutorials[t.tutorialIndex];
    var msg = tut && tut.messages[t.messageIndex - 1];
    var id = msg && msg.inputButton && window.Game ? Game.go(msg.inputButton) : null;
    if (!id) { U.toast('no hotspot armed'); return; }
    t.handleNextClick(id);
    U.toast('Gem revealed');
  }

  function addGem(d) {
    var t = tutorial();
    if (!t) return;
    t.currentCollectedGemsIndex = Math.max(0, t.currentCollectedGemsIndex + d);
    t.applyButtonSet();
  }

  // -------------------------------------------------------- animation speed
  function setSpeed(v) {
    speed = v;
    document.documentElement.style.setProperty('--god-animation-speed', String(v));
    document.body.classList.toggle('godPauseAnimations', v === 0);
    if (document.getAnimations) {
      document.getAnimations().forEach(function (a) {
        try { a.playbackRate = v === 0 ? 0 : v; } catch (e) { /* finished */ }
      });
    }
    U.qsa('#godPanel [data-speed]').forEach(function (b) {
      b.classList.toggle('godOn', parseFloat(b.dataset.speed) === v);
    });
  }

  // ---------------------------------------------------------- visual debug
  function setBounds(state) {
    document.body.classList.toggle('godShowBounds', state);
    U.qsa('.godBounds').forEach(function (el) {
      el.classList.remove('godBounds', 'godBoundsText');
    });
    if (!state) return;
    U.nodes().filter(BOUND_KINDS).forEach(function (r) {
      r.el.classList.add('godBounds');
      if (r.tmp) r.el.classList.add('godBoundsText');
    });
  }

  function buildSafeArea() {
    var stage = U.getStage();
    if (!stage || document.getElementById('godSafeArea')) return;
    var d = document.createElement('div');
    d.id = 'godSafeArea';
    d.innerHTML = '<div class="sa16"></div><div class="saTitle"></div>' +
      '<div class="saMid"></div><div class="saMidH"></div>';
    stage.appendChild(d);
    var fit = function () {
      var s = E.stageSize();
      d.style.width = s[0] + 'px';
      d.style.height = s[1] + 'px';
    };
    fit();
    if (E.onResize) E.onResize(fit);
  }

  /** Make every inactive node faintly visible so layout can be checked. */
  function revealInactive(state) {
    document.body.classList.toggle('godRevealInactive', state);
    U.nodes().forEach(function (r) {
      if (r.activeSelf) return;
      if (state) {
        r.el.style.display = 'block';
        r.el.style.opacity = '0.32';
        r.el.style.outline = '1px dashed rgba(255,111,216,.7)';
        r.el.dataset.godRevealed = '1';
      } else if (r.el.dataset.godRevealed) {
        r.el.style.display = '';
        r.el.style.opacity = '';
        r.el.style.outline = '';
        delete r.el.dataset.godRevealed;
      }
    });
  }

  // ------------------------------------------------------------------- panel
  function buildRoundChips() {
    var host = document.getElementById('godRoundChips');
    if (!host) return;
    host.innerHTML = '';
    for (var i = 0; i < 9; i++) {
      (function (n) {
        var c = document.createElement('button');
        c.className = 'godChip';
        c.textContent = String(n + 1);
        c.addEventListener('click', function () { gotoRound(n); });
        host.appendChild(c);
      })(i);
    }
  }

  function bindPanel() {
    var click = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    var check = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () { fn(el.checked); });
    };

    click('godMinPanel', function () { minimise('godPanel'); });
    click('godMinEditor', function () { minimise('godEditor'); });
    click('godMinReview', function () { minimise('godReview'); });

    click('godGoSplash', jumpSplash);
    click('godGoGameplay', jumpGameplay);
    click('godGoWrong', jumpWrong);
    click('godGoComplete', jumpComplete);

    click('godPrevRound', function () { var t = tutorial(); if (t) gotoRound(t.tutorialIndex - 1); });
    click('godNextRound', function () { var t = tutorial(); if (t) gotoRound(t.tutorialIndex + 1); });
    click('godRestartRound', function () { var t = tutorial(); if (t) gotoRound(t.tutorialIndex); });
    click('godRevealGem', revealGem);
    click('godSkipLine', function () { var t = tutorial(); if (t) t.showNextMessage(); });
    click('godTriggerWrong', jumpWrong);
    click('godShakeBg', function () {
      var g = U.game();
      if (g && g.game.cameraShake) g.game.cameraShake.onClickShakeBox();
    });

    click('godGemPlus', function () { addGem(1); });
    click('godGemMinus', function () { addGem(-1); });
    click('godGemNine', function () {
      var t = tutorial(); if (t) { t.currentCollectedGemsIndex = 9; t.applyButtonSet(); }
    });
    click('godEnableButtons', function () {
      var t = tutorial();
      if (t) t.Number_btn.forEach(function (id) { E.setInteractable(id, true); });
    });
    click('godResetGems', function () {
      var t = tutorial();
      if (t) { t.currentCollectedGemsIndex = 0; t.Attemptnumber = 0; t.applyButtonSet(); }
    });

    U.qsa('#godPanel [data-speed]').forEach(function (b) {
      b.addEventListener('click', function () { setSpeed(parseFloat(b.dataset.speed)); });
    });

    check('godChkBounds', setBounds);
    check('godChkSafe', function (v) { document.body.classList.toggle('godShowSafeArea', v); });
    check('godChkText', function (v) { document.body.classList.toggle('godShowTextBoxes', v); });
    check('godChkHit', function (v) { document.body.classList.toggle('godShowHitAreas', v); });
    check('godChkInactive', revealInactive);

    if (qa) {
      click('qaAll', qa.runAll); click('qaSmoke', qa.smoke);
      click('qaCaptions', qa.captions); click('qaSprites', qa.sprites);
      click('qaRounds', qa.roundData); click('qaInteraction', qa.interaction);
      click('qaResponsive', qa.responsive); click('qaLoading', qa.loading);
      click('qaAnalytics', qa.analytics); click('qaCopy', qa.copyReport);
    }
    if (ux) {
      click('uxAll', ux.runAll); click('uxTap', ux.tapTargets);
      click('uxText', ux.textReadability); click('uxHier', ux.hierarchy);
      click('uxClutter', ux.clutter); click('uxKid', ux.kidFriendly);
      click('uxAudio', ux.audioPairing);
      click('uxClear', ux.clear); click('uxClear2', ux.clear);
      click('uxCopy', ux.copyReport);
    }
  }

  function minimise(id) {
    var p = document.getElementById(id);
    if (p) p.classList.toggle('godMin');
  }

  function tickState() {
    if (!on) return;
    var el = document.getElementById('godGemState');
    if (!el) return;
    var t = tutorial();
    if (!t) { el.textContent = 'gameplay not loaded'; return; }
    el.textContent = 'gems ' + t.currentCollectedGemsIndex +
      ' · round ' + (t.tutorialIndex + 1) + ' · line ' + t.messageIndex +
      ' · attempt ' + t.Attemptnumber + (t.isTyping ? ' · typing' : '');
  }

  // ------------------------------------------------------------- draggable
  function makeDraggable() {
    U.qsa('.godPanel').forEach(function (panel) {
      var head = panel.querySelector('.godHead');
      if (!head) return;
      var s = null;
      head.addEventListener('pointerdown', function (e) {
        if (e.target.classList.contains('godHeadBtn')) return;
        var r = panel.getBoundingClientRect();
        s = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        panel.style.left = r.left + 'px';
        panel.style.top = r.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        head.setPointerCapture(e.pointerId);
      });
      head.addEventListener('pointermove', function (e) {
        if (!s) return;
        var w = panel.offsetWidth, h = panel.offsetHeight;
        // clamp so a panel can never be dragged fully off-screen
        var x = Math.min(window.innerWidth - 40, Math.max(40 - w, e.clientX - s.dx));
        var y = Math.min(window.innerHeight - 34, Math.max(0, e.clientY - s.dy));
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
      });
      head.addEventListener('pointerup', function () { s = null; });
      head.addEventListener('pointercancel', function () { s = null; });
    });
  }

  // ------------------------------------------------------------- shortcuts
  /**
   * Match on e.code first and fall back to a case-insensitive e.key. The old
   * strict `e.key === 'G'` test silently failed whenever CapsLock was on (Shift+G
   * then reports a lowercase 'g') and on layouts that don't produce 'G' at all.
   */
  function isKey(e, code, letter) {
    if (e.code === code) return true;
    return typeof e.key === 'string' && e.key.toLowerCase() === letter;
  }

  function bindShortcuts() {
    window.addEventListener('keydown', function (e) {
      if (e.shiftKey && isKey(e, 'KeyG', 'g') && !U.isTypingInField(e)) {
        e.preventDefault();
        toggle();
        return;
      }
      if (!on || U.isTypingInField(e)) return;

      var sel = editor && editor.selected();
      if (e.key.indexOf('Arrow') === 0 && sel) {
        var map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
        var d = map[e.key];
        // Unity Y is up, so ArrowUp raises anchoredPosition.y
        if (d && editor.nudge(d[0], d[1], e.shiftKey)) { e.preventDefault(); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && editor) {
        editor.copySelected().then(function () { U.toast('Values copied'); });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && editor) {
        e.preventDefault();
        editor.copyAll().then(function () { U.toast('All edits copied'); });
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      var t = tutorial();
      switch (e.key.toLowerCase()) {
        case 'e': editor && editor.setCursorEdit(!editor.isCursorEdit()); break;
        case 'n': if (t) gotoRound(t.tutorialIndex + 1); break;
        case 'p': if (t) gotoRound(t.tutorialIndex - 1); break;
        case 'r': if (t) gotoRound(t.tutorialIndex); break;
        case 'w': jumpWrong(); break;
        case 'f': jumpComplete(); break;
        case 'g': addGem(1); break;
        case 'd': revealGem(); break;
        case 'b': toggleCheck('godChkBounds'); break;
        case 's': toggleCheck('godChkSafe'); break;
        case 'q': qa && qa.runAll(); break;
        case 'v': ux && ux.runAll(); break;
        case 'k': ux && ux.kidFriendly(); break;
        case 'x': ux && ux.clear(); break;
        case '1': setSpeed(0); break;
        case '2': setSpeed(0.25); break;
        case '3': setSpeed(0.5); break;
        case '4': setSpeed(1); break;
        case '5': setSpeed(1.5); break;
        case '6': setSpeed(2); break;
        default: return;
      }
      e.preventDefault();
    });
  }

  function toggleCheck(id) {
    var c = document.getElementById(id);
    if (!c) return;
    c.checked = !c.checked;
    c.dispatchEvent(new Event('change'));
  }

  // ------------------------------------------------------- inline fallback
  function FALLBACK_HTML() {
    return '<div id="godBadge">⚡ God Mode</div>' +
      '<div class="godPanel godOpen" id="godPanel"><div class="godHead">' +
      '<div class="godTitle">God Mode · Debug</div>' +
      '<button class="godHeadBtn" id="godMinPanel">−</button></div>' +
      '<div class="godBody"><div class="godSection">' +
      '<div class="godLabel">Panel template could not be fetched</div>' +
      '<div class="godHint">Serve the folder over http:// (for example ' +
      '<code>python3 -m http.server 8000</code>) to get the full panel. ' +
      'Keyboard shortcuts still work: Shift+G, E, N, P, R, W, F, Q, V, K, X, 1–6.' +
      '</div></div><div class="godOut" id="qaOutput"></div></div></div>' +
      '<div class="godPanel" id="godEditor"><div class="godHead">' +
      '<div class="godTitle">Layout Editor</div></div><div class="godBody">' +
      '<div class="godSelName" id="godSelInfo">nothing selected</div>' +
      '<div class="godField"><span>Element</span>' +
      '<select class="godSelect" id="godTargetSel"></select></div>' +
      '<div class="godRow godCols2">' +
      '<div class="godField"><span>X</span><input class="godInput" id="godX" type="number"></div>' +
      '<div class="godField"><span>Y</span><input class="godInput" id="godY" type="number"></div>' +
      '<div class="godField"><span>W</span><input class="godInput" id="godW" type="number"></div>' +
      '<div class="godField"><span>H</span><input class="godInput" id="godH" type="number"></div>' +
      '</div><div class="godRow godCols2">' +
      '<button class="godBtn" id="godCursorEdit">Cursor edit</button>' +
      '<button class="godBtn" id="godSnap">Snap</button>' +
      '<button class="godBtn" id="godExportJson">Layout JSON</button>' +
      '<button class="godBtn godWarn" id="godResetAll">Reset all</button>' +
      '</div><span id="godEditCount"></span></div></div>' +
      '<div class="godPanel" id="godReview"><div class="godHead">' +
      '<div class="godTitle">UI/UX Review</div></div>' +
      '<div class="godBody"><div class="godOut" id="uxOutput"></div></div></div>';
  }

  return {
    init: init, toggle: toggle, isOn: function () { return on; },
    gotoRound: gotoRound, jumpSplash: jumpSplash, jumpGameplay: jumpGameplay,
    jumpWrong: jumpWrong, jumpComplete: jumpComplete, revealGem: revealGem,
    setSpeed: setSpeed, setBounds: setBounds,
    editor: function () { return editor; }, qa: function () { return qa; },
    ux: function () { return ux; }, anim: function () { return anim; }
  };
};

document.addEventListener('DOMContentLoaded', function () {
  var start = function () {
    var g = window.lbd1Game || window.__game;
    if (!g || !window.Engine) {
      console.warn('[God Mode] no game instance found — aborting (learner build unaffected)');
      return;
    }
    window.BubbleDaysGodMode = window.LBD1GodModeInstance = window.LBD1GodMode(g);
    window.LBD1GodModeInstance.init();
  };
  // main.js runs at the end of <body>, so the handle exists by now; poll a few
  // frames anyway in case script order changes.
  var tries = 0;
  (function wait() {
    if (window.lbd1Game || window.__game || tries++ > 60) start();
    else requestAnimationFrame(wait);
  })();
});
