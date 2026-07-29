/* ==========================================================================
 * orientation.js -- too-small-to-play guard
 *
 * The canvas is locked to 16:9 (see computeScale in js/engine.js), so the scene is
 * pixel-identical on every screen and only its drawn size changes. That makes
 * orientation the wrong thing to gate on: an iPad in portrait draws the whole scene
 * correctly at 48 px touch targets and plays fine, while a 568x320 phone in
 * *landscape* is the tighter case. What actually decides playability is the canvas
 * scale, so that is what this checks.
 *
 * The number strip is 108x105 stage px and js/touch.js can pad it by at most half the
 * 47.5 px gap to its neighbour, so the largest reachable target is about
 * (105 + 45.4) * scale = 150.4 * scale CSS px. Apple's floor is 44 px, which needs
 * scale >= 0.293. Below that no amount of padding saves it and the learner is asked
 * for a bigger view instead.
 *
 *   390x844  portrait phone   scale 0.203  ->  ~30 px  -- blocked
 *   568x320  landscape phone  scale 0.296  ->  ~45 px  -- plays
 *   740x360  landscape phone  scale 0.333  ->   48 px  -- plays
 *   768x1024 portrait tablet  scale 0.400  ->   48 px  -- plays
 *
 * This replaced two earlier rules: a phones-only portrait guard (short side < 500 px)
 * and briefly a blanket portrait guard. Both keyed off orientation, which stopped
 * being the relevant axis once the canvas was locked.
 *
 * EMBEDS: in an app or LMS the host fixes the frame, so a child cannot rotate out of
 * it. Two things follow. The copy adapts -- a device that can rotate is asked to turn,
 * anything else is asked for a bigger frame -- and `?allowportrait=1` (or calling
 * `Orientation.allowPortrait()`) suppresses the gate entirely. Give that flag to any
 * host that cannot hand us a big enough frame and would rather show a small scene than
 * a prompt.
 *
 * The scaler itself is untouched. Deleting the <script> and <link> restores the
 * previous behaviour exactly.
 * ======================================================================== */
'use strict';

var Orientation = (function () {

  // Canvas scale below which even a fully padded touch target falls under Apple's
  // 44 px floor. See the header for the derivation. Set to 0 to disable the gate.
  var MIN_SCALE = 0.293;

  var overlay = null;
  var allowed = /[?&]allowportrait=1/.test(String(window.location.search || ''));

  /** True when turning the device is something the learner can actually do. */
  function canRotate() {
    if (!window.matchMedia) return false;
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  /** The canvas scale engine.js would pick, without depending on boot order. */
  function scaleOf(w, h) {
    return Math.min(w / 1920, h / 1080);
  }

  function build() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'rotateVeil';
    overlay.setAttribute('role', 'alertdialog');
    var turn = canRotate();
    overlay.innerHTML =
      '<div class="rv-inner">' +
      '<div class="rv-phone"><div class="rv-screen"></div></div>' +
      '<div class="rv-title">' +
      (turn ? 'Please turn your device' : 'Please make the window bigger') +
      '</div>' +
      '<div class="rv-sub">This game is played sideways.</div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function isBlockedPortrait() {
    if (allowed) return false;
    var w = window.innerWidth, h = window.innerHeight;
    return w > 0 && h > 0 && scaleOf(w, h) < MIN_SCALE;
  }

  function apply() {
    var blocked = isBlockedPortrait();
    build().classList.toggle('rv-on', blocked);
    document.body.classList.toggle('rotateBlocked', blocked);
  }

  function init() {
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', function () {
      // iOS reports the old size during the change event
      setTimeout(apply, 250);
    });
  }

  /** Escape hatch for hosts that cannot give us a landscape frame. */
  function allowPortrait(on) {
    allowed = on !== false;
    apply();
    return allowed;
  }

  return { init: init, apply: apply, isBlockedPortrait: isBlockedPortrait,
    allowPortrait: allowPortrait, canRotate: canRotate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Orientation;
