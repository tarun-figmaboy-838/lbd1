# Known approximations

Everything below is a place where this hand re-implementation cannot be
bit-identical to Unity, or where the original project itself contains something
odd that has been reproduced rather than corrected.

## Rendering

| Area | What Unity does | What this build does |
|---|---|---|
| ParticleSystem | Full GPU simulation from ~4,700 lines of serialized modules per system | A Canvas 2D approximation driven by the extracted emission rate, lifetime, start size/speed/colour, **shape type and shape scale**. Emission area is converted from world units at `stageH / 10` px per unit (orthographicSize 5) and multiplied by the node's accumulated `localScale`; Box shapes fill their `shapeScale` rect, sphere/circle shapes use `shapeRadius` with an even area distribution. Particles above 10 px draw a cached radial-gradient puff rather than a flat disc. `startSize` is scaled by `PARTICLE_SIZE_K = 0.06` because a Unity particle sprite is a soft dot filling only part of its quad, floored at 2.5 px and clamped at 90 px. Stationary emitters are drawn as continuous glow instead of particles — see *Deliberate departures*. Individual particle paths are still not identical. |
| Animator / AnimationClip | State machine with curves | Only the states actually reached by these scenes are reproduced, as explicit tweens. No generic bounce has been substituted for a real clip. |
| TextMeshPro glyph layout | SDF text with font-intrinsic metrics, per-glyph kerning | Browser text layout with the original TTF, `letter-spacing` from `m_characterSpacing` and `line-height` from `m_lineSpacing`. Sub-pixel baseline and wrap points can differ by a pixel or two. |
| 9-sliced sprite with a non-white tint | Multiplies the sliced sprite by the colour | `border-image` cannot blend with a background colour, so a tint on a 9-sliced sprite is applied as opacity only. Only one sliced sprite exists in these projects and it is untinted, so this path is currently unused. |
| Linear colour space | Composites in linear, converts on output | Serialized colours are converted linear to sRGB before being emitted as `rgba()`, so tints match. Blending of overlapping translucent layers still happens in the browser's sRGB pipeline. |

## Reproduced original quirks

These are faithful to the Unity project and are deliberately **not** "fixed".

- `CameraAutoResize.cs` exists in the project but its GUID appears in **no** scene or prefab, so it never runs. There is therefore no 16:9 letterbox/pillarbox stage; the CanvasScaler alone governs framing, and this build matches that.
- `typingSpeed` is **0.06** s per character in the scene, not the 0.05 default in the script.
- `CameraShake.rightSideBox` is serialized as `/GamePlay/BackGround` — the whole background shakes and tints, not a single box. The field named `lightRed` holds a dark blue-grey (0.102, 0.275, 0.353). Both reproduced as serialized.
- There are two `TutorialDialogue` components in the scene. The one on the inactive `/GameObject` root never runs; the live one is on `/GamePlay/BackGround/Top/ChatBox` and carries 23 clips and the `Awesome!` / `Great Job!` / `Well Done!` pool.
- `HandleNextClick` can advance the dialogue twice for a non-`waitForInput` message: it starts `AutoAdvanceAfterDelay` and then falls straight into the `hasFinishedTypingMessage` branch. Preserved.
- `CallSetButtonSetWhenActive` waits 1.4 s and then starts a coroutine that waits another 1.4 s, so the number buttons re-enable 2.8 s after a gem lands.
- Four `m_SpriteState` slots reference sprites that are missing from the project. The buttons use ColorTint transition, so Unity ignores them; this build ignores them too.
- Nine Image components use Unity's built-in `UISprite` at alpha 0 — invisible hit areas. Rendered as transparent, still clickable.
- `/GamePlay/BackGround/Gameplay/BgImage` has no sprite and a black 41% colour. A Unity Image with a null sprite draws a plain colour quad, which is what this build does.
- The winner text for gem 5 reads `Five  gems collected!` with two spaces. Left exactly as authored.
- `/GamePlay/BackGround/Top/ChatBox` is authored with `Group_7.png` at alpha **0**.
  That one is **not** reproduced — see *Deliberate departures* below. Its text is
  left-aligned in a 1261×103 box, which is kept as authored.
- The gem bag overhangs the right canvas edge by about 9 px
  (`anchoredPosition.x` 802.6 against a 332-wide rect). Authored that way.
- `assets/img/frame_00_delay-0.02s.gif` is a **single-frame** GIF, so the sprite
  itself cannot animate; Unity drove an animated sequence here. A CSS tap pulse
  stands in (see below). Replacing the asset with a multi-frame GIF or sprite
  sheet would restore the original motion.
- The hand artwork is only **276×347 px of content inside a 1200×1200 mostly
  transparent sprite** (23% of the width). The element box is therefore a poor
  proxy for the visible hand — at `localScale` 0.2 the box is 240 px but the hand
  is 55×69 px. Measure the artwork, not the rect, before judging its size.

## Deliberate departures from the Unity scene

Unlike everything above, these are changes, made because the faithful reading was
a defect for the learner or did not match the shipped Unity build. Each is a
one-line revert, and each names the dial or the field to change.

| Change | Was | Why |
|---|---|---|
| The caption node and its panel are activated when a message types (`TutorialDialogue.showCaption`, wired through the serialized-but-unused `CorrectTextobject` field). | `ChatText` is serialized inactive and no message's `objectsToEnable` list ever turns it on, so all 39 instruction lines typed into a `display:none` node and no caption was ever visible. | A tutorial that speaks with no on-screen text is unusable for an early reader. |
| Per-character typing speed is scaled so a caption finishes with its clip (`TutorialDialogue.charDelay`). | A fixed 0.06 s/char, which drifted up to 1.14 s from the recording and finished 0.54 s *after* the voice on the "Click on the number…" line. | Caption and voice must land together for a 5–7 year-old following along. |
| The final line plays clip 22 `Well_Done_You_collected_all_the_gems.ogg`. | Clip 16 `OLD_16_all_gems_collected.ogg`. Clip 22 is a word-for-word match for the caption and was referenced by nothing. | The `OLD_` prefix marks clip 16 as a superseded take. Revert by setting `audioIndex` back to 16 in `js/data.js`. |
| `ChatBox`'s Image alpha is 1, so the instruction panel is visible. | Alpha 0 — the panel was invisible and only white text floated over the scene. | `incorrectChatBox` is the same sprite (`Group_7.png`) at the same rect with the same child text rect, at alpha **1**. One of the twins being at 0 is an authoring slip, not a design: the error panel had a frame and the instruction panel did not. Revert by setting that Image's colour alpha back to `0.0`. |
| The three caption slots (`ChatText`, `ChatTextEnd`, `incoorect_text`) sit at `anchoredPosition [-48.83, 22]`. | `[-17.83, 32]` on all three. | Re-aligned from a God Mode measurement. All three share one panel slot, so they are moved together — leaving one behind would make the text jump between the normal, end and error states. |
| The tap hand's `localScale` is 0.2 and its `anchoredPosition` is set at runtime by `js/hint.js` so the fingertip lands on the round's glow. | Scale 0.3, and a serialized position independent of the glow — for `1_statue` the finger ended up ~70 px below and 46 px to the side of the glowing spot, pointing at bare ground. | The hand, the glow and the tappable area are one instruction to a five-year-old; they have to coincide. Remove the `js/hint.js` tag to fall back to the serialized positions. |
| The hand pulses (CSS `hintTap` on its sprite layer). | Motionless. | Its Unity Animator was never ported and the GIF is single-frame, so without this the hint is a static picture. The animation is on the `.un-img` child, not the node, so it composes with `applyTransform`'s inline transform instead of overriding it. |
| Glow spots render as one continuous breathing radial glow, centred on the emitter's child point marker. | Discrete particles spawning and dying at the container's centre. | The `GlowEffect_*` parents are serialized with **`startSpeed: 0`** and `startSize` 1.2 — a stationary halo, not a spray — and Unity keeps ~8 of them alive on the same spot, so the accumulated result is a smooth lit patch. Simulating that as individual spawns read as dots popping on and off, which the Unity build does not show. Their single child is a **point** emitter (`shapeRadius` 0.0001) offset onto the hiding place, so it is the glow's true visual centre and is folded into the same field rather than drawn as its own spray. Dials: `GLOW_SIZE_K`, `GLOW_ALPHA_GAIN`, `GLOW_BREATHE_HZ` in `js/engine.js`. |
| `CrystalGlowParticles.shapeScale` is `[12, 10, 1]`, so the ambient sparkle covers the whole play area. | `[10, 3, 1]` — a 1620×324 px band across the middle only. | Matched to the Unity build, which shows fine sparkle from the ceiling to the floor. Combined with `PARTICLE_SIZE_K` 0.06 the dots are ~6 px: visible without cluttering. |
| Glow carries a small near-white specular glint (`GLOW_GLINT_K`), so it reads as a stone catching light. | A flat coloured blob. | The gold props (lantern, scroll, treasure) already read as treasure because their hue is warm; the green and pink ones read as painted light. A hotspot at ~16% of the radius costs one extra draw and makes all nine read as gems. |
| After the tutorial round, a tap hint appears only once the learner has been **idle for 5 s**, and hides again on any tap (`IDLE_MS` in `js/hint.js`). | A fixed 8 s delay from the message's `objectsToEnable` list (7 s for the number strip), regardless of what the learner was doing. | The fixed timer nagged a child already reaching for the answer and did nothing for one who was stuck. Round 1 is exempt — that hint *is* the tutorial, so it shows immediately. Visibility only: the dialogue still owns `activeSelf`, the gate is a CSS class, so the two never fight. |
| The splash build-version watermark `vMT_01_02` is inactive. | A `Text (TMP)` node on `/GamePlay` (splash scene), bottom-left, rendering `vMT_01_02` at 32.68 px over the title art. | A Unity build stamp, not learner-facing content. Revert by setting that node's `active` back to `1` in `js/data.js` — it is the only inactive node in `SPLASH_LAYOUT`, so it is easy to find. |
| Glow is built from a hued halo, four soft blooming streaks, five drifting twinkles and a near-white core. | A plain halo. | A halo alone read as painted light. An intermediate version used filled triangles for the rays, which gave crisp polygon edges — a laser rather than magic, and far too hard for a young child. Each streak is now the radial-gradient puff stretched into a long thin ellipse, so it is soft on every edge by construction, and five sparks drift on golden-angle phases the way the splash art scatters them around its gem. Dials: `GLOW_SIZE_K`, `GLOW_ALPHA_GAIN`, `GLOW_GLINT_K`, `GLOW_RAY_LONG`, `GLOW_RAY_SHORT`, `GLOW_RAY_SPIN`, `GLOW_TWINKLES`, `GLOW_BREATHE_HZ`. |
| The tap hint draws as a single `#hintHand` overlay inside `#stage` at z-index 10000, and the scene's own `hand` nodes are hidden. | Each scene `hand` node drew itself. | The glow lives on the FX canvas at z-index **9999**, so it painted over the finger — measured glow alpha of 48/255 across the hand's artwork — and the hint read as sitting *behind* the light. A z-index on the scene node cannot fix it: `rock crevice` (1.1), `treasure box` (1.5) and `floor crack` (1.3) carry a `localScale`, which engine.js applies as `transform: scale()`, and a transform creates a stacking context its children can never escape. A canvas is one flat layer, so it cannot be interleaved between a prop and that prop's own children either. Lifting the hint out of the prop subtree is the only placement that works for all nine. The overlay positions in plain stage coordinates, so no anchor/pivot maths and no ancestor scale can throw it off. Serialized hand geometry is untouched — remove `js/hint.js` and the original nodes draw again. |
| The glow's halo blends **normally**; only its rays and glint are additive. | Everything additive (`lighter`). | Additive light clips to white on a pale prop: over the cyan lake the whole glow measured `rgb(255,255,255)` and vanished into the water, while reading correctly on the dark statue. Normal blending keeps the hue whatever it sits on, so one set of values works for all nine props. `whiten()` also lifts the glint 45% toward white rather than 72%, so the hotspot stays green/gold/pink instead of going flat white. |
| The three caption slots sit at `anchoredPosition [-48.83, 0]`. | `[-48.83, 22]`, from a value dragged by eye. | The node is centre-anchored with a centre pivot, so "vertically centred in the panel" is exactly `y == 0`; at `y: 22` the glyphs sat 22 px above the panel's centre and read as misaligned against its border. Three QA assertions now guard this: centred in panel, `ap.y == 0`, and all three slots agreeing. |
