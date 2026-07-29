/* ==========================================================================
 * touch.js -- guarantee a minimum touch target on small screens
 *
 * The CanvasScaler runs in Expand mode, so every tappable thing shrinks with the
 * viewport. Measured on real device viewports, the nine number-strip buttons are
 * 108x105 stage px, which comes out as:
 *
 *     740x360  (Galaxy S8 landscape)   scale 0.333   ->  35.0 CSS px
 *     667x375  (iPhone SE landscape)   scale 0.347   ->  36.5 CSS px
 *     844x390  (iPhone 12 landscape)   scale 0.361   ->  37.9 CSS px
 *     932x430  (iPhone 14 PM land.)    scale 0.398   ->  41.8 CSS px
 *     768x1024 (iPad mini portrait)    scale 0.400   ->  42.0 CSS px
 *
 * All of those are under the 44 px Apple asks for and the 48 dp Google asks for,
 * and this game is aimed at five-year-olds, whose aim is worse than an adult's.
 *
 * Rather than enlarge the art per device -- which would change the composition the
 * scene was authored with -- each button grows an invisible `::before` that extends
 * its hit area outward until it reaches TARGET_CSS. Nothing moves and nothing
 * repaints: the picture is identical, the catchable area is bigger.
 *
 * The expansion is capped at just under half the clear distance to the nearest
 * button that is tappable at the same moment, so a near-miss always resolves to the
 * closest button and never to its neighbour. That distance is measured live rather
 * than hardcoded, so the cap stays correct if the strip is ever re-laid-out.
 *
 * Deleting the <script> and the `.un-hit` rules in css/style.css restores the
 * previous behaviour exactly; no scene data is touched.
 * ======================================================================== */
'use strict';

var TouchTargets = (function () {

  // 48 is Material's minimum; Apple's is 44. Use the stricter of the two.
  var TARGET_CSS = 48;
  // Keep this much clear space (CSS px) between two expanded areas.
  var NEIGHBOUR_MARGIN = 1;
  // With no neighbour on an axis, never grow by more than this fraction of the
  // element's own size on that axis -- an unbounded pad would swallow the scene.
  var LONE_AXIS_FRACTION = 0.5;

  var E = null;

  function scale() {
    var d = E.dump ? E.dump() : null;
    return d && d.canvasScale ? d.canvasScale : 1;
  }

  /** Every button a learner could tap right now, with its painted CSS box. */
  function liveButtons() {
    var out = [], ids = E.order(), i;
    for (i = 0; i < ids.length; i++) {
      var rec = E.get(ids[i]);
      if (!rec || !rec.el || !rec.el.classList.contains('un-btn')) continue;
      if (!E.isActiveInHierarchy(ids[i])) continue;
      var b = rec.el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      out.push({ rec: rec, x: b.left, y: b.top, w: b.width, h: b.height,
        r: b.right, b: b.bottom });
    }
    return out;
  }

  /**
   * Clear distance, per axis, from `q` to the nearest other live button.
   * Two boxes are neighbours on x only when they overlap on y, and vice versa --
   * otherwise a button diagonally across the screen would cap the expansion.
   */
  function nearestGaps(q, all) {
    var gx = Infinity, gy = Infinity, i;
    for (i = 0; i < all.length; i++) {
      var o = all[i];
      if (o === q) continue;
      var overlapY = q.y < o.b && o.y < q.b;
      var overlapX = q.x < o.r && o.x < q.r;
      if (overlapY) {
        var dx = Math.max(o.x - q.r, q.x - o.r);
        if (dx >= 0 && dx < gx) gx = dx;
      }
      if (overlapX) {
        var dy = Math.max(o.y - q.b, q.y - o.b);
        if (dy >= 0 && dy < gy) gy = dy;
      }
    }
    return [gx, gy];
  }

  function padFor(q, all) {
    var needX = (TARGET_CSS - q.w) / 2;
    var needY = (TARGET_CSS - q.h) / 2;
    if (needX <= 0 && needY <= 0) return [0, 0];

    var g = nearestGaps(q, all);
    var capX = g[0] === Infinity ? q.w * LONE_AXIS_FRACTION
      : Math.max(0, g[0] / 2 - NEIGHBOUR_MARGIN);
    var capY = g[1] === Infinity ? q.h * LONE_AXIS_FRACTION
      : Math.max(0, g[1] / 2 - NEIGHBOUR_MARGIN);

    return [Math.max(0, Math.min(needX, capX)), Math.max(0, Math.min(needY, capY))];
  }

  var lastReport = null;

  function apply() {
    if (!E) return;
    var all = liveButtons(), s = scale(), i;
    var worstBefore = Infinity, worstAfter = Infinity, padded = 0;

    for (i = 0; i < all.length; i++) {
      var q = all[i], p = padFor(q, all), el = q.rec.el;
      // the ::before lives inside the scaled stage, so the inset is in stage px
      if (p[0] <= 0.5 && p[1] <= 0.5) {
        el.classList.remove('un-hit');
        el.style.removeProperty('--hitX');
        el.style.removeProperty('--hitY');
      } else {
        el.style.setProperty('--hitX', (p[0] / s).toFixed(2) + 'px');
        el.style.setProperty('--hitY', (p[1] / s).toFixed(2) + 'px');
        el.classList.add('un-hit');
        padded++;
      }
      worstBefore = Math.min(worstBefore, Math.min(q.w, q.h));
      worstAfter = Math.min(worstAfter, Math.min(q.w + 2 * p[0], q.h + 2 * p[1]));
    }

    lastReport = {
      buttons: all.length, padded: padded, scale: s,
      smallestBefore: all.length ? +worstBefore.toFixed(1) : null,
      smallestAfter: all.length ? +worstAfter.toFixed(1) : null,
      target: TARGET_CSS
    };
  }

  function init(engine) {
    E = engine || window.Engine;
    if (!E || !E.order) return;
    apply();
    if (E.onResize) E.onResize(apply);
    // buttons come and go with each round, so re-measure when the tree changes
    if (E.onActivated) E.onActivated(apply);
  }

  return { init: init, apply: apply, report: function () { return lastReport; },
    target: function () { return TARGET_CSS; } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TouchTargets;
