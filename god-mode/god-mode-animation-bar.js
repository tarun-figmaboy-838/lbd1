/* ==========================================================================
 * god-mode-animation-bar.js -- animation suggestions for the selected element
 *
 * Ideas are generated, not stored as presets: an idea bank keyed by element type
 * and trigger condition produces free-form labels, and an ordered keyword
 * resolver maps any label -- including a new one you invent -- onto one of the
 * gmAnim-* keyframe classes in god-mode.css. Preview plays live; Copy Code emits
 * standalone CSS + JS that does not depend on god-mode.css.
 * ======================================================================== */
'use strict';

window.GodModeAnimationBar = function () {
  var U = window.GodModeUtils;

  var sel = null, condition = null, applied = [], previewing = null;
  var ui = {};

  // ------------------------------------------------------------ classification
  function classify(rec) {
    if (!rec) return 'default';
    var name = String(rec.data.name || '').toLowerCase();
    var path = U.pathOf(rec).toLowerCase();
    var sprite = rec.img && rec.img.sprite ? rec.img.sprite.path.toLowerCase() : '';
    // Match the stem, not the extension -- assets moved from .png to .webp.
    if (/^gem$/.test(name) || /_gem\.|gem\.(png|webp)/.test(sprite)) return 'gem';
    if (/bag|sack/.test(name) || /sack|empty_sack/.test(sprite)) return 'bag';
    if (name === 'hand' || /hand|frame_00/.test(sprite)) return 'hint';
    if (/gloweffect|glow/.test(name)) return 'glow';
    if (/confet|rays|particle/.test(name)) return 'celebration';
    if (/chatbox|chattext|incoorect|incorrect/.test(path)) return 'panel';
    if (rec.tmp) return 'text';
    if (/^\d$/.test(name) || /strip/.test(path)) return 'numberButton';
    if (rec.btn) return 'hotspot';
    if (/background|bg/.test(name)) return 'backdrop';
    if (/statue|lantern|rock|lake|treasure|stalagmite|crack|scroll|mushroom/.test(name)) {
      return 'prop';
    }
    return 'default';
  }

  var CONDITIONS = ['On Idle', 'On Tap', 'On Correct Answer', 'On Wrong Answer',
    'On Reveal', 'On Gem Collected', 'On Round Start', 'On Round Complete',
    'On All Collected'];

  var DEFAULT_CONDITION = {
    gem: 'On Gem Collected', bag: 'On Gem Collected', hint: 'On Idle',
    glow: 'On Idle', celebration: 'On All Collected', panel: 'On Round Start',
    text: 'On Round Start', numberButton: 'On Tap', hotspot: 'On Idle',
    backdrop: 'On Wrong Answer', prop: 'On Idle', default: 'On Tap'
  };

  // ------------------------------------------------------------- idea bank
  var BANK = {
    gem: {
      'On Gem Collected': ['Crystal Fly To Bag', 'Sparkle Pop Burst', 'Rotate And Shrink',
        'Rainbow Ring Expand', 'Happy Jelly Bounce', 'Treasure Shine Flash'],
      'On Reveal': ['Emerge From Hiding', 'Twinkle Fade In', 'Scale Up Shine', 'Drop In Bounce'],
      'On Idle': ['Gentle Float', 'Slow Shine Pulse', 'Soft Drift']
    },
    bag: {
      'On Gem Collected': ['Bag Squish Catch', 'Fill Up Pop', 'Happy Jelly Bounce',
        'Golden Shine Flash'],
      'On All Collected': ['Overflow Burst', 'Treasure Confetti Pop', 'Grand Scale Up'],
      'On Idle': ['Soft Breathe', 'Slow Drift']
    },
    hint: {
      'On Idle': ['Tap Tap Bounce', 'Point And Wiggle', 'Pulse Glow Ring', 'Gentle Float',
        'Attention Wave'],
      'On Tap': ['Press Down Squish', 'Quick Fade Out']
    },
    glow: {
      'On Idle': ['Breathing Glow', 'Heartbeat Pulse', 'Slow Shine Sweep', 'Sparkle Drift'],
      'On Reveal': ['Burst Open', 'Ring Expand Out']
    },
    celebration: {
      'On All Collected': ['Confetti Rain', 'Star Burst Out', 'Rays Spin Slow',
        'Firework Pop', 'Cheer Jump'],
      'On Round Complete': ['Small Confetti Pop', 'Sparkle Shower']
    },
    panel: {
      'On Round Start': ['Slide Down In', 'Soft Fade In', 'Gentle Drop In'],
      'On Wrong Answer': ['Soft Wrong Shake', 'Red Edge Flash', 'Sad Wobble'],
      'On Round Complete': ['Slide Up Out', 'Fade Out Soft']
    },
    text: {
      'On Round Start': ['Letters Rise In', 'Soft Fade In', 'Slide In From Left'],
      'On Correct Answer': ['Happy Jump', 'Cheer Scale Pop', 'Rainbow Shine'],
      'On Wrong Answer': ['Gentle Shake', 'Sad Wobble'],
      'On All Collected': ['Grand Scale Up', 'Shine Sweep']
    },
    numberButton: {
      'On Tap': ['Press Squish', 'Boing Bounce', 'Quick Recoil'],
      'On Correct Answer': ['Green Pop Burst', 'Star Confetti Pop', 'Happy Jelly Bounce',
        'Ring Expand Out', 'Cheer Jump'],
      'On Wrong Answer': ['Soft Wrong Shake', 'Red Alert Ring', 'Squish Deny',
        'Sad Wobble', 'Gentle Freeze Pulse'],
      'On Idle': ['Soft Breathe', 'Invite Pulse Glow']
    },
    hotspot: {
      'On Idle': ['Invite Pulse Glow', 'Gentle Float', 'Soft Breathe', 'Sparkle Drift'],
      'On Tap': ['Press Squish', 'Burst Open', 'Smoke Puff', 'Recoil Bounce'],
      'On Reveal': ['Open Up Pop', 'Shine Flash']
    },
    backdrop: {
      'On Wrong Answer': ['Camera Shake', 'Red Edge Flash', 'Dim And Recover'],
      'On Idle': ['Slow Parallax Drift', 'Ambient Shine Sweep'],
      'On All Collected': ['Brighten Up', 'Warm Glow Wash']
    },
    prop: {
      'On Idle': ['Gentle Float', 'Slow Drift', 'Soft Breathe', 'Occasional Wiggle'],
      'On Reveal': ['Wiggle Notice', 'Shine Flash', 'Scale Up Pop'],
      'On Tap': ['Press Squish', 'Wobble Bump', 'Smoke Puff']
    },
    default: {
      'On Idle': ['Gentle Float', 'Soft Breathe', 'Slow Drift'],
      'On Tap': ['Press Squish', 'Soft Bounce', 'Quick Pop'],
      'On Correct Answer': ['Happy Bounce', 'Pop Burst'],
      'On Wrong Answer': ['Soft Shake', 'Sad Wobble']
    }
  };

  /** Ordered keyword resolver -- first match wins, so new labels still work. */
  var RESOLVER = [
    [/heartbeat|breath/i, 'gmAnim-heartbeat'],
    [/tick/i, 'gmAnim-tickShake'],
    [/edge ?flash|alert ?ring|red ?edge/i, 'gmAnim-edgeFlash'],
    [/shake|camera/i, 'gmAnim-shake'],
    [/ring|ripple|expand out/i, 'gmAnim-ringExpand'],
    [/jelly/i, 'gmAnim-jelly'],
    [/squish|squash|deny|press/i, 'gmAnim-squish'],
    [/confetti|firework|shower|rain/i, 'gmAnim-confetti'],
    [/burst|star burst|overflow/i, 'gmAnim-popBurst'],
    [/rotate|spin|rays/i, 'gmAnim-spin'],
    [/fly|collect|to bag|to hud/i, 'gmAnim-flyOff'],
    [/freeze|dim/i, 'gmAnim-freezePulse'],
    [/smoke|puff/i, 'gmAnim-smokePuff'],
    [/recoil/i, 'gmAnim-recoil'],
    [/shine|glow|sparkle|twinkle|brighten|warm/i, 'gmAnim-pulseGlow'],
    [/spark/i, 'gmAnim-sparkPop'],
    [/pop/i, 'gmAnim-popBurst'],
    [/drop/i, 'gmAnim-dropIn'],
    [/slide|rise|letters/i, 'gmAnim-slideRise'],
    [/flip/i, 'gmAnim-flip'],
    [/fade/i, 'gmAnim-fadeIn'],
    [/jump|cheer/i, 'gmAnim-cheerJump'],
    [/wave|attention/i, 'gmAnim-wave'],
    [/sad/i, 'gmAnim-sadWobble'],
    [/wiggle|wobble|bump|notice/i, 'gmAnim-wobble'],
    [/drift|parallax|float/i, 'gmAnim-drift'],
    [/scale|grand|emerge|open up/i, 'gmAnim-scaleUp'],
    [/bounce|boing|tap tap/i, 'gmAnim-softBounce']
  ];
  var LOOPING = ['gmAnim-heartbeat', 'gmAnim-pulseGlow', 'gmAnim-floatUp',
    'gmAnim-drift', 'gmAnim-tickShake', 'gmAnim-edgeFlash', 'gmAnim-freezePulse'];

  function resolve(label) {
    for (var i = 0; i < RESOLVER.length; i++) {
      if (RESOLVER[i][0].test(label)) return RESOLVER[i][1];
    }
    return 'gmAnim-softBounce';
  }
  function allClasses() {
    var s = {};
    RESOLVER.forEach(function (r) { s[r[1]] = 1; });
    s['gmAnim-floatUp'] = 1;
    return Object.keys(s);
  }

  function ideasFor(type, cond) {
    var b = BANK[type] || BANK.default;
    var list = (b[cond] || []).slice();
    // fall back to the generic bank so a condition is never empty
    if (list.length < 3) {
      var gen = (BANK.default[cond] || BANK.default['On Tap'] || []);
      gen.forEach(function (g) { if (list.indexOf(g) < 0) list.push(g); });
    }
    return list;
  }

  // ------------------------------------------------------------------- init
  function init() {
    ['gmSel', 'gmCondition', 'gmChips', 'gmCode', 'gmCodeBox'].forEach(function (id) {
      ui[id] = document.getElementById(id);
    });
    if (ui.gmCondition) {
      ui.gmCondition.innerHTML = CONDITIONS.map(function (c) {
        return '<option>' + c + '</option>';
      }).join('');
      ui.gmCondition.addEventListener('change', function () {
        condition = this.value; renderChips();
      });
    }
    var bind = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('gmPreview', function () { play(previewing || firstIdea()); });
    bind('gmApply', applyCurrent);
    bind('gmReset', function () { stripAll(); U.toast('Animations cleared'); });
    bind('gmCopyCode', function () { toggleCode(); });
    bind('gmCopyCss', function () { copyPart('css'); });
    bind('gmCopyJs', function () { copyPart('js'); });
    bind('gmCopyFull', function () { copyPart('full'); });

    document.addEventListener('godEditorSelectionChanged', function (e) {
      sel = window.Engine ? Engine.get(e.detail.id) : null;
      var type = classify(sel);
      condition = DEFAULT_CONDITION[type] || 'On Tap';
      if (ui.gmCondition) ui.gmCondition.value = condition;
      if (ui.gmSel) {
        ui.gmSel.textContent = 'Selected: ' + e.detail.name + '  ·  ' + type;
      }
      renderChips();
    });
  }

  function firstIdea() {
    var list = ideasFor(classify(sel), condition);
    return list[0] || 'Soft Bounce';
  }

  function renderChips() {
    if (!ui.gmChips) return;
    if (!sel) { ui.gmChips.innerHTML = '<div class="godHint">Select an element first.</div>'; return; }
    var list = ideasFor(classify(sel), condition);
    ui.gmChips.innerHTML = '';
    list.forEach(function (label) {
      var c = document.createElement('button');
      c.className = 'godChip';
      c.textContent = label;
      if (isApplied(sel.id, condition, label)) c.classList.add('godApplied');
      c.addEventListener('click', function () {
        previewing = label;
        U.qsa('.godChip', ui.gmChips).forEach(function (x) { x.classList.remove('godOn'); });
        c.classList.add('godOn');
        play(label);
      });
      ui.gmChips.appendChild(c);
    });
  }

  // ------------------------------------------------------------------ play
  function play(label) {
    if (!sel || !label) { U.toast('Select an element first'); return; }
    previewing = label;
    var cls = resolve(label);
    var el = sel.el;
    allClasses().forEach(function (c) { el.classList.remove(c); });
    void el.offsetWidth;                 // force reflow so it always replays
    el.classList.add(cls);
    el.dataset.gmAnimPreview = cls;
    U.toast(label + '  →  .' + cls);
  }

  function applyCurrent() {
    if (!sel || !previewing) { U.toast('Preview an idea first'); return; }
    sel.el.dataset.gmAnim = condition + ':' + previewing;
    applied.push({ id: sel.id, condition: condition, label: previewing,
                   cls: resolve(previewing) });
    renderChips();
    U.toast('Applied to ' + sel.data.name);
  }
  function isApplied(id, cond, label) {
    return applied.some(function (a) {
      return a.id === id && a.condition === cond && a.label === label;
    });
  }

  function stripAll() {
    var classes = allClasses();
    U.nodes().forEach(function (r) {
      classes.forEach(function (c) { r.el.classList.remove(c); });
      delete r.el.dataset.gmAnim;
      delete r.el.dataset.gmAnimPreview;
    });
    applied = [];
    previewing = null;
    renderChips();
  }

  // ------------------------------------------------------------ code export
  function kebab(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function camel(s) {
    var k = kebab(s).split('-');
    return k[0] + k.slice(1).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join('');
  }
  function pascal(s) {
    var c = camel(s);
    return c.charAt(0).toUpperCase() + c.slice(1);
  }

  /** Pull the keyframe body straight out of god-mode.css so exports stand alone. */
  function keyframesFor(cls) {
    var name = null;
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sheet = document.styleSheets[i], rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (r.type === CSSRule.STYLE_RULE && r.selectorText === '.' + cls) {
          var m = /animation:\s*([A-Za-z0-9_-]+)/.exec(r.style.animation || r.cssText);
          if (m) name = m[1];
        }
      }
      if (!name) continue;
      for (var k = 0; k < rules.length; k++) {
        if (rules[k].type === CSSRule.KEYFRAMES_RULE && rules[k].name === name) {
          return { name: name, text: rules[k].cssText };
        }
      }
    }
    return null;
  }

  function bestSelector() {
    if (!sel) return '.element';
    if (sel.el.id) return '#' + sel.el.id;
    return '[data-id="' + sel.id + '"]';   // engine stamps this on every node
  }

  function exportCode(label) {
    var cls = resolve(label);
    var kf = keyframesFor(cls);
    var animName = camel(label) + 'Anim';
    var cssClass = 'anim-' + kebab(label);
    var loop = LOOPING.indexOf(cls) >= 0;
    var body = kf ? kf.text.replace(new RegExp('\\b' + kf.name + '\\b'), animName)
      : '@keyframes ' + animName + ' { 0%,100% { transform: none; } 50% { transform: scale(1.06); } }';
    var duration = loop ? '1.6s' : '0.55s';
    var css = '/* ' + label + ' — generated by God Mode */\n' +
      body + '\n\n.' + cssClass + ' {\n' +
      '  animation: ' + animName + ' ' + duration +
      (loop ? ' ease-in-out infinite' : ' cubic-bezier(.34,1.56,.64,1) 1') + ';\n}\n';
    var js = '/* replay helper: removing the class + forcing a reflow restarts it */\n' +
      'function play' + pascal(label) + '(el) {\n' +
      '  if (!el) return;\n' +
      '  el.classList.remove("' + cssClass + '");\n' +
      '  void el.offsetWidth;\n' +
      '  el.classList.add("' + cssClass + '");\n}\n';
    var snippet = 'play' + pascal(label) + '(document.querySelector("' + bestSelector() + '"));';
    return { css: css, js: js, snippet: snippet, selector: bestSelector(),
             full: css + '\n' + js + '\n// ' + snippet + '\n' };
  }

  function toggleCode() {
    if (!ui.gmCodeBox) return;
    var open = ui.gmCodeBox.style.display !== 'none';
    if (open) { ui.gmCodeBox.style.display = 'none'; return; }
    if (!previewing) { U.toast('Preview an idea first'); return; }
    ui.gmCodeBox.style.display = 'block';
    if (ui.gmCode) ui.gmCode.textContent = exportCode(previewing).full;
  }

  function copyPart(which) {
    if (!previewing) { U.toast('Preview an idea first'); return; }
    var c = exportCode(previewing);
    U.copyText(c[which] || c.full).then(function () {
      U.toast(which.toUpperCase() + ' copied');
    });
  }

  return {
    init: init, play: play, reset: stripAll, refresh: renderChips,
    classify: classify, resolve: resolve, exportCode: exportCode
  };
};
