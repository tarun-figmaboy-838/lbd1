/* ==========================================================================
 * hint.js -- put the tap hand's fingertip on the spot it is pointing at
 *
 * The scene positions each hand independently of its glow, so the finger landed
 * in empty space: for 1_statue the glow sits 48 px below the prop centre while
 * the hand's fingertip ends up ~117 px below it, about 70 px lower and 46 px to
 * the side. The hand read as pointing at bare ground next to the glowing spot.
 *
 * Two measured facts drive the maths:
 *
 *   1. The hand artwork is only 276x347 px of content inside a 1200x1200 mostly
 *      transparent sprite (23% of the width). The element box is therefore a poor
 *      proxy for the hand -- at localScale 0.3 the box is 360 px but the visible
 *      hand is 83x104 px.
 *   2. The fingertip -- the topmost opaque pixel, centroid of the first rows --
 *      sits at (557, 619) of 1200x1200, i.e. fraction (0.4644, 0.5158).
 *
 * So the fingertip is offset from the element centre by
 * (frac - 0.5) * 1200 * localScale, and the hand's anchoredPosition is set so
 * that offset lands on the target.
 *
 * Target, in order of preference: the round's active GlowEffect_* emitter (the
 * thing the child is told to tap), else the sibling hit-area Button, else the
 * parent. Only one GlowEffect_* is ever active at a time, which is what makes the
 * lookup safe without a name-to-prop table -- the scene's names do not match
 * ("5_treasure box" vs "GlowEffect_trasurebox").
 *
 * Purely additive: remove the <script> tag and the hands fall back to their
 * serialized positions.
 * ======================================================================== */
'use strict';

var Hint = (function () {

  var E = null;

  // Measured from the tap-hand sprite (assets/img/frame_00_delay-0.02s.webp).
  var SPRITE = 1200;
  var TIP = { x: 0.4644, y: 0.5158 };

  // How long the learner may be idle before a hint is offered, once the tutorial
  // round has taught the mechanic. The scene's fixed 8 s delay nagged a child who
  // was already reaching for the answer and did nothing for one who was stuck;
  // gating on real inactivity is what "help me when I need it" actually means.
  var IDLE_MS = 5000;

  var idleTimer = null;
  var gated = [];               // hands currently held back waiting for idle

  // The hint is drawn as a single overlay stacked above the FX canvas rather than
  // as the scene's own `hand` node.
  //
  // Why it cannot just be a z-index on that node: the glow lives on the FX canvas
  // at z-index 9999, and three props (rock crevice 1.1, treasure box 1.5, floor
  // crack 1.3) carry a localScale, which engine.js applies as `transform: scale()`.
  // A transform creates a stacking context, so a hand nested inside one of those
  // props can never be raised above a canvas outside it -- the glow washed over
  // the finger and the hint read as sitting behind the light. A canvas is one flat
  // layer, so it cannot be interleaved between the props and their own children
  // either. Lifting the hint out of the prop subtree is the only placement that
  // works for all nine.
  var overlay = null;
  var overlaySprite = null;

  function isGlow(rec) {
    return /^GlowEffect_/.test(String(rec.data.name || ''));
  }

  /** The one glow emitter that is live for this round, if any. */
  function activeGlow() {
    var all = E.order();
    for (var i = 0; i < all.length; i++) {
      var r = E.get(all[i]);
      if (r && isGlow(r) && E.isActiveInHierarchy(r.id)) return r;
    }
    return null;
  }

  /** Stage-space point the finger should touch, for a hand under `parent`. */
  function targetFor(hand) {
    var parent = hand.parent;
    var glow = activeGlow();
    // A strip-button hand points at its own button, never at the round's glow.
    var onStrip = parent && /^[1-9]$/.test(String(parent.data.name));
    // glowCenterOf, not centerOf: a glow renders on its child point emitter,
    // which is offset onto the hiding place. Pointing at the container's centre
    // would put the finger beside the light rather than on it.
    if (glow && !onStrip) {
      return (E.glowCenterOf && E.glowCenterOf(glow.id)) || E.centerOf(glow.id);
    }
    var btn = null;
    if (parent) {
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i].data.name === 'Button') { btn = parent.children[i]; break; }
      }
    }
    return E.centerOf(btn ? btn.id : parent.id);
  }

  /** The fingertip's current position in stage px, read off the rendered box. */
  function renderedTip(hand) {
    var cs = E.scale() || 1;
    var st = document.getElementById('stage');
    if (!st) return null;
    var sr = st.getBoundingClientRect();
    var hr = hand.el.getBoundingClientRect();
    if (!hr.width || !hr.height) return null;
    return [
      (hr.left - sr.left) / cs + TIP.x * (hr.width / cs),
      (hr.top - sr.top) / cs + TIP.y * (hr.height / cs)
    ];
  }

  /** The overlay, created once, stacked above the FX canvas inside #stage. */
  function ensureOverlay(hand) {
    if (overlay) return overlay;
    var st = document.getElementById('stage');
    if (!st) return null;
    overlay = document.createElement('div');
    overlay.id = 'hintHand';
    overlaySprite = document.createElement('div');
    overlaySprite.className = 'hintHandArt';
    overlay.appendChild(overlaySprite);
    st.appendChild(overlay);
    var img = hand.img && hand.img.sprite ? hand.img.sprite.path : null;
    if (img) overlaySprite.style.backgroundImage = 'url("' + img + '")';
    return overlay;
  }

  /**
   * Size and place the overlay so its fingertip sits on `pt` (stage px). Both are
   * plain stage coordinates -- #stage's own scale transform maps them to the
   * screen -- so no anchor/pivot maths is needed and no ancestor scale can throw
   * it off. The scene's `hand` node keeps its serialized geometry untouched; it is
   * only hidden, so removing this file restores the original behaviour exactly.
   */
  function place(hand) {
    var pt = targetFor(hand);
    if (!pt) return;
    var el = ensureOverlay(hand);
    if (!el) return;
    // Size from the hand's OWN scale only -- deliberately not the ancestors'.
    // Matching the scene exactly meant inheriting each prop's localScale, so the
    // hint measured 240px on the statue but 264 on the rock crevice, 312 on the
    // floor crack and 360 on the treasure box. The hint is a piece of UI that
    // means one thing wherever it appears, so it is one size everywhere; the prop
    // it points at should not resize the instruction.
    var w = (hand.data.sizeDelta ? hand.data.sizeDelta[0] : SPRITE) * (hand.scale[0] || 1);
    var h = (hand.data.sizeDelta ? hand.data.sizeDelta[1] : SPRITE) * (hand.scale[1] || 1);
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = (pt[0] - TIP.x * w) + 'px';
    el.style.top = (pt[1] - TIP.y * h) + 'px';
  }

  function hideOverlay() {
    if (overlay) overlay.classList.remove('on');
  }
  function showOverlay() {
    if (overlay) overlay.classList.add('on');
  }

  /** Round 1 teaches the mechanic, so its hint is never gated. */
  function isTutorialRound() {
    var g = window.lbd1Game || window.__game;
    var t = g && g.game ? g.game.tutorial : null;
    return !t || t.tutorialIndex === 0;
  }

  function hold(hand) {
    hideOverlay();
    if (gated.indexOf(hand) < 0) gated.push(hand);
  }

  function reveal() {
    for (var i = 0; i < gated.length; i++) {
      if (!E.isActiveInHierarchy(gated[i].id)) continue;
      place(gated[i]);            // the glow may have moved since the hand was armed
      showOverlay();
    }
  }

  /** Any tap means the learner is engaged: hide the hint and start counting again. */
  function bumpIdle() {
    if (gated.length) hideOverlay();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(reveal, IDLE_MS);
  }

  function init() {
    E = window.Engine;
    if (!E) return;
    // The dialogue reveals hands through objectsToEnable, so activation is the
    // only reliable moment at which both the hand and its glow are live.
    E.onActivated(function (rec, on) {
      if (String(rec.data.name) !== 'hand') return;
      // The scene's own hand never draws -- the overlay stands in for it.
      rec.el.classList.add('hintHidden');
      if (!on) {
        var i = gated.indexOf(rec);
        if (i >= 0) gated.splice(i, 1);
        if (!gated.length) hideOverlay();
        return;
      }
      place(rec);
      if (isTutorialRound()) { showOverlay(); return; }
      hold(rec);
      bumpIdle();
    });

    ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
      window.addEventListener(ev, bumpIdle, { passive: true, capture: true });
    });
    // A viewport change re-runs layout from the serialized values, so any visible
    // hand has to be re-placed afterwards.
    E.onResize(function () {
      var all = E.order();
      for (var i = 0; i < all.length; i++) {
        var r = E.get(all[i]);
        if (r && String(r.data.name) === 'hand' && E.isActiveInHierarchy(r.id)) place(r);
      }
    });
    // The glow breathes and a round can move it, so keep the overlay tracking.
    E.onTick(function () {
      for (var i = 0; i < gated.length; i++) {
        if (E.isActiveInHierarchy(gated[i].id)) { place(gated[i]); return; }
      }
    });
  }

  return { init: init, place: place, tipFraction: TIP,
           idleMs: function () { return IDLE_MS; },
           gatedCount: function () { return gated.length; },
           revealNow: reveal };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Hint;
