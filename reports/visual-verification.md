# Visual verification — lbd1

## What could not be done

The brief asks for a pixel diff against frames captured from the Unity original.
**That was not possible here and no such numbers are reported.** This environment
has no Unity Editor and no Unity licence, so ground-truth frames cannot be
produced, and a WebGL reference build cannot be made either. Any "diff score
against Unity" in this report would be invented, so there is none.

## What was done instead

1. **Layout verified against the algorithm, not against a screenshot.**
   RectTransform placement is computed as
   `size = (aMax-aMin)*P + sizeDelta` and
   `corner = aMin*P + anchoredPosition - sizeDelta*pivot`, per axis
   independently. Layout-group placement was hand-computed from Unity's
   `SetChildrenAlongAxis` / GridLayoutGroup source and compared with the
   rendered DOM.

   LBD-1's nine-button strip is the strongest check: a `HorizontalLayoutGroup`
   with spacing **-263.56**, `MiddleCenter` alignment and
   `ReverseArrangement: true`. Hand-computing Unity's algorithm gives button "1"
   at `left = 283.76`, a step of `+155.56`, `top = 32`, size `108×105`. The
   rendered build produces exactly those numbers for all nine buttons.

2. **State-machine coverage in real Chromium.** 9 states were driven
   and screenshotted, with assertions on counts, attempt numbers, analytics
   payloads and button availability. Screenshots are in the delivery under
   `reports/screenshots/`.

3. **Responsive matrix.** All eight required viewports were loaded and checked
   for page errors, scrolling and correct scale factor. Results are in
   `qa-checklist.md`.

4. **Regression signal for the sprite-tint path.** An earlier revision applied
   Unity's Image tint with `mask-image` plus a flat background colour. That
   replaced artwork with a silhouette and masked child objects — post-shake
   frames collapsed to 14–24 sampled colours. After switching to a dedicated
   sprite layer with `background-blend-mode: multiply`, the same frames carry
   1,944–6,696 unique colours. Colour diversity per state is used as a cheap
   guard against that class of failure returning.

## To close the remaining gap

Send screenshots of the Unity original at the states listed in the brief's
Phase 10.2, captured at 1920×1080, and they can be diffed against the matching
HTML states with per-region mismatch percentages and overlays. Sending a
screenshot of the original beside the HTML at the same state is also the fastest
way to get any specific mismatch fixed.
