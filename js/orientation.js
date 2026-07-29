/* ==========================================================================
 * orientation.js -- portrait-phone guard
 *
 * The CanvasScaler runs in Expand mode, so a 1920x1080 design on a 390 px-wide
 * phone scales to 0.203: the number strip renders 22x21 CSS px and the hidden
 * object hit areas about 33x46. That is far under any comfortable touch target,
 * so on a narrow portrait screen the learner is asked to rotate instead.
 *
 * The scaler itself is untouched -- desktop and tablet framing stay identical.
 * Deleting the <script> and <link> restores the previous behaviour exactly.
 * ======================================================================== */
'use strict';

var Orientation = (function () {

  // Phones only. A 834x1112 tablet in portrait scales to 0.43 (about 47 px
  // buttons), which is playable, so it must not be nagged.
  var MAX_PHONE_SHORT_SIDE = 500;

  var overlay = null;

  function build() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'rotateVeil';
    overlay.setAttribute('role', 'alertdialog');
    overlay.innerHTML =
      '<div class="rv-inner">' +
      '<div class="rv-phone"><div class="rv-screen"></div></div>' +
      '<div class="rv-title">Please turn your device</div>' +
      '<div class="rv-sub">This game is played sideways.</div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function isBlockedPortrait() {
    var w = window.innerWidth, h = window.innerHeight;
    return h > w && w < MAX_PHONE_SHORT_SIDE;
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

  return { init: init, isBlockedPortrait: isBlockedPortrait };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Orientation;
