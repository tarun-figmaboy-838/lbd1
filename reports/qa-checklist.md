# QA checklist — lbd1 (Hidden Gem Sequence)

Reviewed and re-verified 2026-07-29 in real headless Chromium over CDP, driving the
game with genuine pointer events — not a DOM shim and not a static read. Every row
below was asserted mechanically; screenshots were inspected for the visual ones.

Re-run in the browser at any time: **Shift + G** → *Run all* (QA, 60 assertions)
and *Full review* (UI/UX). See `god-mode/README.md`.

---

## 1. Defects found and fixed

| # | Severity | Defect | Root cause | Status |
|---|---|---|---|---|
| 1 | **P0** | Every runtime sprite swap was invisible: the gem bag stayed on `empty_sack.png` through all nine gems, number buttons never turned green/red, the final bag never appeared. | `engine.js` declared `setSprite` **twice** (L461, L883) and `setImageColor` twice (L470, L937). Function declarations hoist, so the later, legacy pair won at runtime and painted `rec.el`, while the initial paint (`paintImage`) painted the dedicated `.un-img` child layer — which renders *on top*. The model changed; the pixels did not. | Fixed — duplicates and `applySpriteOnly` removed; `paintImage` is the single path. |
| 2 | **P0** | The wrong-answer background tint did nothing, and permanently applied `mask-image: url(mystical_cave_2.png)` to `/GamePlay/BackGround`, masking all four child subtrees and leaving a flat colour quad under the artwork. | Same duplicate declaration. This is the exact regression `reports/visual-verification.md` describes as fixed — it *was* fixed in `paintImage`, and the dead-code duplicate reintroduced it at runtime. | Fixed — verified `maskLeak: none`; the tint is now `background-blend-mode: multiply` over intact art. |
| 3 | **P0** | **No dialogue text was ever visible.** All 39 instruction lines typed into a `display:none` node for the entire game; learners heard the voice-over with no caption. | `dialogueText` → `/GamePlay/BackGround/Top/ChatBox/ChatText`, serialized inactive, and no message's `objectsToEnable` list ever turns it on. The serialized `CorrectTextobject` field (the ChatBox panel) was read from config and never used. | Fixed — `showCaption()` drives both; the panel hands over to `incorrectChatBox` on a wrong answer and to `ChatTextEnd` at the end. |
| 4 | **P0** | `TypeError: Cannot read properties of undefined (reading 'messages')` after the last line, plus a duplicate analytics event. | `handleNextClick` indexed `tutorials[tutorialIndex].messages` with no bounds check. After round 9 `tutorialIndex === 9`; strip button 9 keeps both its stale runtime listener and (via `applyButtonSet`, `i >= gems-1`) its interactable state, so one more tap threw. | Fixed — guarded; verified by tapping button 9 after the final line. |
| 5 | **P1** | Multi-second black screen and prop-by-prop pop-in. On 400 kbps the splash was fully black at 700 ms and still incomplete at 4.9 s; entering gameplay showed a near-black screen with items appearing one at a time. | 11 MB of art with nothing waiting for it. `Engine.preload` existed but was never called. | Fixed — `js/preloader.js` gates behind an opaque veil with a progress bar; it also caches VO durations. |
| 6 | **P1** | Portrait phones effectively unplayable: at 390×844 the Expand scaler gives 0.203, so number buttons render **22×21 CSS px** and hotspots ~33×46. | Correct Unity `Expand` behaviour on a 1920×1080 design — but with no guidance. | Fixed — `js/orientation.js` shows a rotate prompt on portrait phones (short side < 500 px). Scaler untouched, so desktop/tablet framing is unchanged. |
| 7 | **P2** | Caption drifted from its voice-over by up to 1.14 s. At the serialized 0.06 s/char, "Tap at the glowing spot to find the next gem!" typed in 2.70 s against a 3.84 s clip; "Click on the number of gems found so far." typed in 2.52 s against a 1.98 s clip — text finishing *after* the voice. | Fixed per-character speed vs recorded audio. | Fixed — `charDelay()` scales the per-char delay so typing ends with the clip; falls back to 0.06 s/char when a line has no audio. |
| 8 | **P2** | The final line's voice-over was not the final line. "Well Done! You collected all the gems!" played clip 16 `OLD_16_all_gems_collected.ogg`; clip 22 `Well_Done_You_collected_all_the_gems.ogg` — a word-for-word match — was referenced by nothing. | Superseded take left wired in the scene (`OLD_` prefix). | Fixed — `audioIndex` 16 → 22 in `js/data.js`. |
| 9 | **P0** (God Mode) | The layout editor could not drag anything: hit-testing found no game nodes. | `elementsFromPoint` honours `pointer-events: none`, which `engine.js` sets on every Image whose Unity `raycast` flag is false — nearly all the artwork. | Fixed — the editor hit-tests geometry directly, in reverse paint order. |
| 10 | **P1** (God Mode) | Resizing a node with `localScale ≠ 1` grew it 1.5× too fast and dragged the opposite corner 15 px. | `localScale` is applied after layout, about the pivot, so a screen delta is not a `sizeDelta` delta. | Fixed — `Δsd = delta / localScale`, with the `anchoredPosition` compensation scaled to match. Opposite corner now pinned to the pixel. |
| 11 | **P1** | A tight cyan blob sat at the centre of the screen for the whole game, and each "glowing spot" was a 6 px speck ~44 px to the side of its prop rather than a halo on it. | `spawnParticle` ignored `shapeType` and `shapeScale` outright, using `shapeRadius * 20` for every system. `CrystalGlowParticles` is a **Box** of `[10,3,1]` world units — a 1620×324 px ambient sparkle band — so 100 particles collapsed into a 20 px dot; the `GlowEffect_*` circles (`shapeRadius` 0.3, should be ~20 px) shrank to 6 px. | Fixed — emission honours shape type and scale, converted from world units at `stageH/10` px and multiplied by accumulated `localScale`. Measured band is now 1582×336 px. |
| 12 | **P1** | The tap hand pointed at empty ground beside the glowing spot, and never moved. | The scene positions each hand independently of its glow; for `1_statue` the fingertip landed ~70 px below and 46 px to the side. The hand's Animator was never ported and its GIF is single-frame. | Fixed — `js/hint.js` places the fingertip on the round's active glow (measured tip fraction (0.4644, 0.5158) of the sprite); CSS `hintTap` pulses the sprite layer. Fingertip is now 0 px from the glow in all 9 rounds and inside the hit area. |
| 13 | **P1** | The instruction panel was invisible — only white text floated over the cave, while the wrong-answer panel had a proper frame. | `ChatBox`'s Image is alpha 0 although its twin `incorrectChatBox` uses the identical sprite, rect and child text rect at alpha 1. | Fixed — alpha 1. |
| 14 | **P0** (God Mode) | `Shift+G` did nothing for some users, and a `file://` double-click produced a stripped 4-button panel. | The shortcut tested `e.key === 'G'`, which is `'g'` whenever CapsLock is on (and absent on some layouts). Separately, the panel template was fetched, and `fetch` is blocked on `file://`, so the inline stub was used silently. | Fixed — matches on `e.code`/case-insensitive `e.key`, plus `?god=1` and a `god()` console helper; the template now ships as `god-mode-panel.js` (no fetch), so `file://` gets all 68 buttons. |

## 2. Not defects — verified faithful to the Unity scene

Checked and deliberately left alone. See `reports/known-approximations.md`.

- The caption is **left-aligned** in a 1261×103 box: that is the authored TMP
  alignment, not a layout error. (`ChatBox`'s alpha-0 Image was originally listed
  here as authored-and-correct; it is now treated as an authoring slip and set to
  alpha 1 — see *Deliberate departures* in `known-approximations.md`.)
- The gem bag overhangs the right canvas edge by ~9 px
  (`anchoredPosition.x` 802.6, `sizeDelta` 332). Authored that way.
- `complation panel/rays` (`Glittery_Shine.png`) is authored at alpha 0 and driven
  by an Animator (`rays.controller`) that was never ported, so it stays invisible.
- Nine hotspot `Image`s use Unity's built-in `UISprite` at alpha 0 — invisible but
  clickable hit areas.
- Strip buttons re-enable **2.8 s** after a gem lands
  (`CallSetButtonSetWhenActive` waits 1.4 s then starts a coroutine that waits
  another 1.4 s). Preserved.
- `typingSpeed` is 0.06 in the scene, not the script's 0.05 default.
- Two `TutorialDialogue` components exist; only the one on `.../Top/ChatBox` runs.
- `"Five  gems collected!"` keeps its double space, as authored.

## 2b. Hint, glow and panel — measured before and after

| Measure | Before | After |
|---|---|---|
| Ambient emitter spread | 20 px dot at screen centre | 1582 × 336 px band across the cave |
| `GlowEffect_*` halo radius | 6 px speck | ~20 px soft radial puff |
| Glow particle look | flat opaque disc | cached radial gradient, falls off by 30% radius |
| Fingertip distance from the glow | 70–139 px (9/9 rounds off) | **0 px in all 9 rounds** |
| Fingertip inside the tappable area | inconsistent | 9/9 rounds, plus the strip button |
| Hand pulse | none (`getAnimations()` = 0) | `hintTap` running, 8 distinct transforms sampled |
| Visible hand size | 83 × 104 px | 55 × 69 px (`localScale` 0.2) |
| Instruction panel | invisible (alpha 0) | visible frame, matching the error panel |

## 3. Open items — asset/authoring, not code

- **The hand sprite itself still cannot animate.** `frame_00_delay-0.02s.gif` is a
  single-frame GIF (one graphic-control block, 7.7 KB); the CSS `hintTap` pulse
  stands in for the unported Animator. A real multi-frame GIF or sprite sheet
  would restore the original motion.
- **Celebration `rays` never plays** — needs its Animator states ported as
  explicit tweens, or a CSS keyframe substitute. God Mode's animation bar exports
  a ready-made candidate (`Rays Spin Slow`).
- **`PARTICLE_SIZE_K = 0.12` in `js/engine.js` is a judgement constant**, not a
  derived one: Unity's particle sprite fills an unknown fraction of its quad, so
  the visible mark cannot be computed from `startSize` alone. It is the one dial
  to turn if the glow reads too strong or too weak.
- **`assets/img/mystical_cave_2.png` is 2.8 MB** of a 9.4 MB image budget.
  Re-encoding to WebP would cut first load substantially; the preloader hides the
  wait but does not shorten it.

---

## 4. Consistency

| Check | Result |
|---|---|
| `node --check` on every shipped JS file | **pass** (7 game files, 6 God Mode files, `tools/apply_layout.js`) |
| Single definition per engine export (no hoisting shadow) | **pass** — asserted by the QA `Smoke` and `Sprites` tests |
| Painted sprite matches the model on every `Image` node | **pass** — 0 mismatches |
| No `mask-image` leaked onto any node subtree | **pass** — 0 found |
| House style preserved (ES5 IIFE, `var`, single quotes, 2-space, K&R) in game files | **pass** |
| `js/data.js` not reformatted (machine-generated, one line per global) | **pass** — only targeted value replacements |
| All 9 rounds have a hotspot and a strip prompt | **pass** |
| No gamey wording, over-long lines, or stray whitespace in learner text | **pass** |
| Asset audit (86 referenced / 86 on disk, 0 missing, 0 zero-byte) | **pass** |
| Failed network requests | **0** |

## 5. No loading glitch

| Check | Result |
|---|---|
| Loading veil raised before the first frame | **pass** |
| Progress bar advances (observed 0% → 48% → 100% at 500 kbps) | **pass** |
| Game hidden until every image is decoded | **pass** — `Image.decode()` awaited per asset |
| Fonts settled before reveal (`document.fonts.ready`, 2.5 s cap) | **pass** |
| No black screen or prop-by-prop pop-in on a cold, throttled load | **pass** — re-tested at 500 kbps / 150 ms, cold cache |
| Veil torn down after reveal (no residue in the DOM) | **pass** |
| Hard ceiling so a dead asset host cannot trap a child on a spinner | **pass** — 12 s per asset, 2.5 s per clip |
| Gameplay art already cached when the splash is tapped | **pass** — one manifest covers both scenes |

## 6. Voice-over ↔ text

| Check | Result |
|---|---|
| Caption node active, not `display:none`, on-canvas, with area | **pass** |
| Every `audioIndex` resolves to a real clip | **pass** — 39 messages |
| Caption wording overlaps its clip filename on every line | **pass** |
| Typing duration matches clip duration within 0.25 s | **pass** — all 39 lines (was up to 1.14 s off) |
| VO durations cached before the first line types | **pass** — 24 clips |
| Random praise lines ("Awesome!" / "Great Job!" / "Well Done!") play the matching clip 19/20/21 and time to it | **pass** — tracked via `__voIndex` |
| Final line matches its audio word for word | **pass** — now clip 22 |
| Every spoken line has a caption and vice versa | **pass** |
| Praise VO not cut off by the next line on the same channel | **pass** |

## 7. Interactions

| Check | Result |
|---|---|
| Full 9-round playthrough, hotspot → gem → number | **pass** |
| Bag sprite advances `sack_1` … `sack_9`, painted = model every round | **pass** |
| Final bag swaps to `Final.png` | **pass** |
| Correct answer: button turns green, visibly | **pass** |
| Wrong answer: button turns red, incorrect panel + "Count carefully!" types, red gradient shows, background shakes and tints over intact art | **pass** |
| Wrong-answer reset after 2 s restores sprite, panel, alert and caption | **pass** |
| Analytics, 9 correct rounds | **pass** — `[n,n,n,true,0]` ×9 |
| Analytics, wrong answer | **pass** — `[1,5,1,false,1]` |
| Payload shape `(q_id, selected, correct, isCorrect, attempt)` | **pass** |
| No duplicate submissions | **pass** |
| Rapid 5× tap on a hotspot does not double-advance | **pass** |
| Rapid 6× tap on a strip button does not double-submit | **pass** — `disableButtonsIntractable()` fires first |
| Tap after the final line | **pass** — no throw (was a TypeError) |
| All 9 strip buttons carry their persistent `ValidateClick` | **pass** |
| Every `Button` node has pointer handlers bound | **pass** |
| Resize mid-round keeps every hotspot and button on screen and hittable | **pass** — 5 viewport changes during play |
| JavaScript exceptions / console errors across every run | **0** (was 1) |

## 8. Responsive

`min(w/1920, h/1080)` — Unity `Expand`. The canvas grows in the shorter axis
rather than cropping or stretching, so composition never rearranges.

**Update 2026-07-29 — re-measured on real device viewports; two defects found and
fixed. See §13.** The table below records framing only, which is still accurate.

| Viewport | Scale | Canvas | Strip button | Page scroll | Verdict |
|---|---|---|---|---|---|
| 2560×1440 | 1.3333 | 1920×1080 | 144 px | none | pass |
| 1920×1080 | 1.0000 | 1920×1080 | 108 px | none | pass |
| 1600×900 | 0.8333 | 1920×1080 | 90 px | none | pass |
| 1366×768 | 0.7111 | 1920.9×1080 | 77 px | none | pass |
| 1280×720 | 0.6667 | 1920×1080 | 72 px | none | pass |
| 1024×768 | 0.5333 | 1920×1440 | 58 px | none | pass |
| 834×1112 (tablet portrait) | 0.4344 | 1920×2560 | 47 px | none | pass |
| 800×600 | 0.4167 | 1920×1440 | 45 px | none | pass |
| 844×390 (phone landscape) | 0.3611 | 2337×1080 | 39 px | none | pass — tight but playable |
| 390×844 (phone portrait) | 0.2031 | 1920×4155 | 22 px | none | rotate prompt shown |
| 360×640 (phone portrait) | 0.1875 | 1920×3413 | 20 px | none | rotate prompt shown |

- No horizontal or vertical page scroll at any viewport.
- The rotate prompt fires exactly on portrait phones; phone landscape, tablet
  portrait and desktop are never nagged, and it clears on rotation.
- Zero page errors at every viewport.

## 9. God Mode

| Check | Result |
|---|---|
| All six modules load, panel template fetched, badge injected | **pass** |
| Shift+G toggles on: body class, badge, panels, 75 selectable elements | **pass** |
| Selection box with 8 resize handles and a live stage-space label | **pass** |
| Drag tracks the cursor 1:1 and writes correct Unity `anchoredPosition` | **pass** — +100/+60 screen → `[+100, −60]` (Y correctly inverted) |
| Resize pins the opposite corner and writes correct `sizeDelta` | **pass** — top/left moved 0 px; `Δsd = 60 / 1.5 = 40` |
| Arrow nudge 1 px, Shift+arrow 10 px, in stage space | **pass** |
| Numeric X/Y/W/H entry applies exactly | **pass** |
| Text editing and font size on text nodes | **pass** |
| Layout JSON export carries only edited elements, with `was` values | **pass** |
| `tools/apply_layout.js` writes `data.js`, backs up, re-parses, reports per asset | **pass** — round-tripped and restored |
| A missing asset ID is reported as `NOT FOUND`, never skipped silently | **pass** |
| Round chips 1–9 and the four screen jumps | **pass** — no screen stacking |
| QA suite | **60 passed, 0 failed, 0 warnings** |
| UI/UX review with on-screen highlighting | **pass** — 0 issues, 1 warning (the authored bag overhang) |
| Animation bar: classify, generate, preview, standalone CSS+JS export | **pass** |
| Visual debug: bounds (74 nodes), safe area, text boxes, hit areas, inactive | **pass** |
| Shift+G toggles off: **complete** teardown | **pass** — all god classes removed, badge/panels hidden, bounds and UX marks cleared, animation classes stripped, `anchoredPosition` **and** `sizeDelta` restored, caption text and font size restored, edit count 0 |
| Learner build unaffected by removing the `index.html` block | **pass** — God Mode never mutates game state except through public methods |

## 10. How this was verified

- Headless Chromium driven over CDP with `puppeteer-core`; real
  `pointerdown/move/up`, not synthetic `.click()`.
- The nine-round playthrough waits on actual game state
  (`currentCollectedGemsIndex`, `interactable`) rather than fixed sleeps.
- Sprite assertions compare the model's `img.sprite.path` against the
  `background-image` actually on the `.un-img` layer — the check that catches a
  swap which "ran" but painted nothing.
- Cold-load behaviour measured with `Network.clearBrowserCache` +
  `emulateNetworkConditions` at 500 kbps / 150 ms.
- Every viewport in §8 loaded and asserted for scale, canvas size, scroll and
  page errors.

### Still needs a human

- Side-by-side comparison with the Unity original for TMP baselines, wrap points
  and particle density (no Unity licence available here — see
  `reports/visual-verification.md`).
- Touch interaction on real phone and tablet hardware.
- A native listener confirming the re-pointed final clip (22) is the intended take.

---

## 11. Performance, format and delivery audit — 2026-07-29

Measured in real headless Chromium over CDP, not estimated.

### 11.1 No loading, no lag, no buffer, no delay

| Check | Result |
|---|---|
| Ready-to-play, cold cache, 1.5 Mbps / 40 ms | **7.1 s** (was 12.7 s before the asset conversion and the two-phase gate) |
| What the veil actually waits for | **389 KB** — splash art, font, tap sound |
| Gameplay payload | 1793 KB, streams behind the splash; the tap is gated so the scene never enters half-loaded |
| Our render cost per frame, all 9 glows lit | **0.7 ms p50, 1.5 ms p95** — about 4% of a 60 Hz budget |
| Frames over 33 ms with vsync disabled | **0 of 160** |
| Long tasks (>50 ms) across the whole playthrough | **0** |
| Frames over 50 ms | **0 of 750** |
| Tap to caption response | **5–9 ms** |
| Tap to gem reveal | 208–220 ms — the authored `delayBeforeEnable` of 0.2 s, not lag |
| JavaScript exceptions / console errors | **0** |

**On the FPS figure:** headless Chromium caps its compositor at 30 fps in both the
old and new headless modes, so a raw `requestAnimationFrame` reading there is
**not** a measure of this game's speed. With `--disable-frame-rate-limit` the same
scene runs at **1258 fps (0.7 ms per frame)** with every glow active, and our own
tick measures **0.00 ms** of JavaScript per frame. The renderer has very large
headroom; any 30 fps reading in a headless report is the harness, not the game.

### 11.2 Asset formats

| Check | Result |
|---|---|
| Images | **60 WebP**, 0 PNG, 0 GIF |
| Audio | **25 OGG**, 0 MP3 |
| Font | 1 TTF |
| `assets/img` size | 9.4 MB → **2.4 MB** (76% smaller) |
| Lossless conversions bit-exact on alpha and visible RGB | **47 / 47** |
| Alpha deviation, lossy files | **0** on all 12 |
| Worst alpha-weighted visible RMSE | **5.5** (genie), most under 3 |
| MP3 → OGG duration drift | **0.000 s** — captions pace from these durations |
| GIF → WebP fingertip fraction | unchanged (0.4644, 0.5158), so `js/hint.js` stays valid |
| Every referenced asset resolves on disk | **56 / 56**, 0 missing |

Pre-conversion originals are preserved in `assets/_src-original/` (gitignored);
delete that folder once the conversion is signed off. `favicon.png` stays PNG.

### 11.3 Voice-over, text, animation, interaction, effects

| Check | Result |
|---|---|
| Caption node visible, in the panel's inner field, within 22 px of its centre | pass |
| All three caption slots share one position | pass |
| Typing duration matches its clip within 0.25 s | pass, 39/39 lines |
| VO durations cached before the first line types | 24 clips |
| Caption wording overlaps its clip on every line | pass |
| Tap hint fingertip on the glow | **0 px, 9/9 rounds**, inside the hit area 9/9 |
| Hint pulse running | pass |
| Idle hint: tutorial immediate, later rounds after 5 s idle, hides on tap | pass |
| Glow local contrast (core minus surrounding ring) | 107–176 across all nine props |
| Bag sprite advances sack_1…sack_9, painted = model | pass, 9/9 |
| Wrong answer: sprite, panel, alert, shake, reset | pass |
| Analytics | 9 correct + 1 wrong, correct payloads, no duplicates |

### 11.4 No unnecessary elements

Census of every visible node per state:

| State | Visible | Overlays up | Stray gems | Stray hands | Glows |
|---|---|---|---|---|---|
| splash | 3 | none | 0 | 0 | 0 |
| round 1 | 23 | ChatBox | 0 | 0 | 0 |
| round 3 | 24 | ChatBox | 0 | 0 | 1 |
| round 6 | 24 | ChatBox | 0 | 0 | 1 |
| round 9 | 24 | ChatBox | 0 | 0 | 1 |
| wrong feedback | 25 | incorrectChatBox + Incorrect State | 0 | 0 | 1 |
| all collected | 23 | ChatBox | 0 | 0 | 0 |

Exactly one message panel at a time, never more than one glow, no orphaned gems or
hands. The whole-game alignment sweep also found **0** off-centre texts, **0** boxes
escaping their parent and **0** glyph overflows; the only element past the canvas
edge is the gem bag at 9 px, which is authored.

### 11.5 God Mode QA suite

**60 assertions, 0 failures, 0 warnings.** The loading test is two-phase aware: it
asserts the splash set is cached always, and the full manifest only once the
background payload reports ready.

## 12. Timing and speed consistency — 2026-07-29

Same action, same duration, in every round. Audited from `js/data.js` first, then
measured in a full nine-round playthrough in Chrome at 1920×1080.

| Check | Before | After |
|---|---|---|
| Gem flight (pop + arc into the bag), 9 gems | 6 × 1.30 s, **3 × 2.00 s** | **all 9 at 1.30 s** |
| Measured flight time, real playthrough | — | **1305, 1304, 1303, 1305, 1303, 1304, 1304, 1304, 1305 ms** (2 ms spread) |
| Worst frame inside any flight | — | **15.8 ms**, 0 frames over 33 ms — the bag lands without a stutter |
| `hand` reveal delay, 18 hands | 8 s × 9 props, **7 s × 9 strip** | **0 × 18** — the 5 s idle rule in `js/hint.js` is the only gate |
| Measured hint latency, round 2 | — | **5006 ms** of idle (round 1 exempt at 2291 ms: that hint is the tutorial) |
| `gem` reveal delay, 9 gems | 8 × 0.2 s, **1 × 1.0 s** (round 9) | **0.2 s × 9** |
| `glow` / `Button` / `complation panel` reveal delay | 0 | 0 — already uniform |
| Confetti burst delay | 1.0 s | **1.0 s, unchanged** — it shares the value `1` with the round-9 gem, so the gem was targeted by fileID `200327432`, not by value |
| `resetDelay` on the 9 wrong-answer buttons | 2 × 9 | 2 × 9 — already uniform |
| `CameraShake` scale / rotate / colour | 0.1 / 0.1 / 0.1, 1 loop | unchanged |
| `autoAdvanceDelay`, rounds 2–9 | uniform per role (2.5 / 1.5 / 2.5 / 3.0) | unchanged |
| `autoAdvanceDelay`, round 1 | 1.7, 1.8, 2.2, 1.0, 1.8 | **left as authored** — every outlier is in round 1 and only round 1, so the tutorial is internally consistent, just paced tighter. Out of scope for a consistency pass. |
| Background music under the **real** autoplay policy (no bypass flag, audio unmuted) | never started — a refusal was discarded | **plays**: one `bg.ogg` attempt, reaches `playing`, **0 rejections** |
| Full nine-round playthrough, caption-driven | — | **9/9 rounds, 18 taps, 0 console errors**, ends on "Well Done! You collected all the gems!" |

### One harness finding worth recording

Two earlier runs stalled at round 3 and round 7. That was the **test harness**, not
the game: it tapped each number button the instant the button turned `interactable`,
which can be before the dialogue has asked for it, and that tap was consumed with
nothing waiting on it. Re-driving the same playthrough the way a learner does — read
the caption, tap what it asks for — completed all nine rounds cleanly. Worth keeping
in mind for any future automation of this scene: drive it from the caption, not from
`tutorial.messageIndex`, which the preserved `handleNextClick` double-advance can move
by two.

### Reading `delayBeforeEnable` counts in `js/data.js` — a trap

Grepping the shipped `data.js` gives 10 × `"delayBeforeEnable":0.2` and 10 × `":1`,
which looks one-too-many against nine gems and one confetti burst. It is not a defect.
`CONFIG.scripts` holds **two** `TutorialDialogue` copies, both with 9 tutorials and 39
messages:

| | host | active in hierarchy | gem `delayBeforeEnable` |
|---|---|---|---|
| `scripts[14]` | `1130232098` under `GameObject` | **false** — dead in Unity too | `[1,1,1,1,1,1,1,1,0.2]` |
| `scripts[18]` | `1760113273` under `/GamePlay/BackGround/Top/ChatBox` | **true** | `[0.2 × 9]` |

`Game.liveScript('TutorialDialogue')` in `js/main.js` picks the active one, so only
`scripts[18]` ever runs — that is why the playthrough measured correctly. The dead
copy is left in place on purpose: it is dead in the Unity scene as well, and `main.js`
documents the reason at the call site. **Any future timing audit must filter on
`activeInHierarchy(s.__host)` before tallying, or it will report phantom outliers
from a script that never executes.**

The remaining live non-zero delay is `ChatTextEnd` at **5 s**
(`scripts[18].tutorials[8].messages[4]`), the finale caption. It has nothing to be
consistent with — it is a one-off end beat, and it matches the final line's
`autoAdvanceDelay` of 5. Left as authored.

## 13. Responsive on real devices — 2026-07-29

Re-measured across 19 real device viewports in Chrome, reading the painted DOM
rather than the layout model. Framing was already correct everywhere — no
letterboxing, no stretching, no page scroll, 0 console errors, and the cave art
covers the viewport at every aspect from 0.46 to 2.39. Two real defects turned up.

### 13.1 Touch targets were below the platform minimum on every phone

The nine number-strip buttons are 108×105 stage px, and Expand mode shrinks them
with the viewport:

| Device viewport | Scale | Painted | Effective now |
|---|---|---|---|
| 740×360 Galaxy S8 landscape | 0.3333 | **35.0** | **48.0** |
| 667×375 iPhone SE landscape | 0.3472 | **36.5** | **48.0** |
| 844×390 iPhone 12 landscape | 0.3611 | **37.9** | **48.0** |
| 915×412 Pixel 7 landscape | 0.3815 | **40.1** | 48.0 |
| 932×430 iPhone 14 Pro Max landscape | 0.3981 | **41.8** | 48.0 |
| 768×1024 iPad mini portrait | 0.4000 | **42.0** | **48.0** |
| 1024×768 iPad mini landscape | 0.5333 | 56.0 | 56.0 (no pad needed) |
| 1920×1080 desktop | 1.0000 | 105.0 | 105.0 (no pad needed) |

Apple asks for 44 px, Google for 48 dp; this game is for five-year-olds, whose aim
is worse than an adult's. Every phone was under both.

`js/touch.js` grows an invisible `::before` on each button until the catchable area
reaches 48 CSS px. Nothing moves and nothing repaints — the composition the scene
was authored with is untouched, only the catchable area changes. The expansion is
capped at just under half the measured clear distance to the nearest
simultaneously-tappable button, so a near-miss always resolves to the closest
button. That distance is measured live (47.5 stage px between strip neighbours), not
hardcoded, so the cap stays right if the strip is ever re-laid-out.

Verified with the strip **enabled** (see the trap below), on six viewports:

| Check | Result |
|---|---|
| Smallest effective target | **48.0 CSS px** on every phone, at or above target |
| `::before` `pointer-events` when interactable | `auto` on all six viewports |
| Probes just inside each expanded edge (L/R/bottom × 9 buttons) | **27/27 resolve to the correct button**, on all six viewports |
| Taps resolving to a *neighbouring* button | **0** on all six viewports |
| Expanded boxes overlapping each other | **0** on all six viewports |
| Real click 6.5 CSS px into the margin | **registers** |
| Control click 6 px *beyond* the pad | **does not register** — the expansion is bounded, not a catch-all |
| Nine-round playthrough after the change | 9/9 rounds, flights 1304–1307 ms, 0 janky frames, 0 console errors |

**A trap that cost a full test cycle:** the first verification probed the strip while
every button was still `un-dis` — the strip is disabled until a gem is collected —
and reported 0/27. That was correct behaviour on a disabled control, not a broken hit
area. Any future test of this must collect a gem first. The same run also read
geometry after a fixed `sleep` instead of waiting for the new scale to land, so two
rows reported the *previous* viewport's numbers; wait on `Engine.dump().canvasScale`
changing instead.

### 13.2 Nothing accounted for notches or the home indicator

`index.html` asks for `viewport-fit=cover`, so on a notched phone the raw viewport
runs underneath the notch and the home indicator — and this game puts the number
strip only 26 stage px off the bottom edge, which is 9.4 CSS px on an iPhone 12 in
landscape, well inside the ~21 px the home indicator occupies. Nothing in the CSS
referenced `env(safe-area-inset-*)`.

`#viewport` is now inset by the four safe-area insets. Insetting the element is what
matters rather than padding it: `engine.js` reads `viewport.clientWidth/clientHeight`
to choose the canvas scale, and `clientWidth` includes padding but not offsets. Every
fallback is `0px`, and the measured scales after the change are identical to before
(0.3333 / 0.3472 / 0.3611 / 0.4 / 0.5333 / 1), which confirms it is a no-op wherever
the insets are zero.

**Not verified in a browser:** headless Chrome reports zero safe-area insets, so the
no-op case is proven but the notched case is not. It needs a real iPhone in landscape
to confirm the strip clears the home indicator.

### 13.3 Framing at extreme aspect ratios — left as is

At tablet portrait (0.75) the props sit in a band across the middle with the caption
panel pinned to the top and the number strip to the bottom, leaving a tall empty
cave ceiling between them. It is not broken — nothing is cropped, stretched or
unreachable, and the UI does use the extra height — but roughly 45% of the screen
carries no content, and the 0.4 scale that results is what made the buttons small.
Fixing the *framing* would mean re-composing the scene for portrait, which is a
design decision rather than a responsive fix, so only the touch-target consequence
was addressed. Portrait **phones** are still asked to rotate, unchanged.

## 14. Canvas expansion capped, extreme aspects letterbox — 2026-07-29

§13.3 left the portrait framing alone as "not broken". Reported from a real
863×1034 window, that was the wrong call. Measured there:

| | Before | After |
|---|---|---|
| Stage model | **1920 × 2300** (2.13× the authored height) | **1920 × 1458** |
| Caption top | y=39 — pinned to the screen edge | **y=228** |
| Props band | y=374–667 | y=374–667 (unchanged) |
| Number strip top | y=975 — pinned to the screen edge | **y=785** |
| Empty screen | **542 px of 1034 = 52%** | 189 px + 190 px of letterbox |

Unity's `Expand` grows the canvas without limit in whichever axis is not binding.
Near 16:9 that is useful; at 0.835 aspect it flung everything anchored to an edge to
that edge and left the nine props in a thin band in the middle. Nothing was cropped
or stretched — the composition simply came apart.

`computeScale()` now caps expansion at `MAX_EXPAND_W = 1.45` / `MAX_EXPAND_H = 1.35`
and centres what is left. Both caps are measured, not guessed: ultrawide 3440×1440
needs 1.344× width and looks right, and iPad landscape needs 1.333× height and also
looks right (screenshot inspected), so both sit just inside the cap and are
untouched. `body` background moved from `#000` to `#133a50`, sampled from the top and
bottom edges of `mystical_cave_2` (both exactly `rgb(19,58,80)`), so the letterbox
reads as cave rather than as a black bar.

| Check | Result |
|---|---|
| Viewports with framing **unchanged** | **12 of 15** — every landscape phone, all three iPad landscapes, laptops, desktop, 2560×1440, ultrawide |
| Viewports newly letterboxed | 3 — the 863×1034 window, iPad mini portrait, iPad Pro 11 portrait |
| Smallest touch target, all 15 viewports | **48.0 CSS px** |
| Anything mostly offscreen | **0** viewports |
| Page scroll | **0** viewports |
| Console/page errors | **0** |
| Nine-round playthrough | 9/9, flights 1304–1309 ms, worst in-flight frame 23.3 ms, **0 janky frames** |

Two measurement notes worth keeping. The touch guarantee first read **47.2 px** on the
863×1034 window because `js/touch.js` skipped pads under 0.5 px as noise, leaving it
0.8 px short; the threshold is now 0.01 px and it reads 48.0. And one playthrough
reported a 3154 ms gem flight with a 3013 ms frame — it did not reproduce (all nine
flights 1304–1309 ms, 0 janky frames on re-run), total frames were down 27% that run,
and the host was swapping hard enough that PowerShell could not start the CLR. Frame
timings measured while this machine is thrashing are not trustworthy; re-run before
believing one.

## 15. Payload compression — 2026-07-29

**4.02 MB → 3.52 MB.** Saved 508,582 bytes.

| Asset | Before | After | How |
|---|---|---|---|
| `bg.ogg` | 975,962 | **500,440** | 113 kb/s stereo → 64 kb/s, which libvorbis couples to ~58 kb/s actual. Duration **68.690 s → 68.690 s, drift 0.000 s** |
| `stalagmite.webp` | 36,582 | 28,700 | near-lossless 40, RMSE **0.946** |
| `statue.webp` | 35,106 | 27,644 | near-lossless 60, RMSE **0.892** |
| `Frame_289.webp` | 34,794 | 24,582 | near-lossless 60, RMSE **0.992** |
| `floor_crack.webp` | 17,056 | 12,698 | near-lossless 60, RMSE **0.909** |
| `rock_crevice.webp` | 14,994 | 11,848 | near-lossless 60, RMSE **0.684** |

Verified after: `bg.ogg` reaches `playing` under the real autoplay policy with 0
rejections at its authored volume 0.2, and a nine-round playthrough runs 9/9 with
flights 1305–1310 ms, worst in-flight frame 20.1 ms, 0 janky frames, 0 console errors.

### What was deliberately NOT compressed, and why

- **Text — already solved.** Vercel brotli-compresses it: `js/data.js` 138,553 →
  **11,326 bytes** on the wire, `js/engine.js` 65,213 → 21,413, `css/style.css`
  7,054 → 2,294. Nothing to gain.
- **The other 55 images.** 39 reproduce **byte-for-byte** at a q92/q96 re-encode, so
  they are already at their authored quality. For the rest nothing inside an RMSE ≤ 1.0
  budget was smaller, and max-effort lossless never beat what ships.
- **The 24 voice-over clips.** They are the source encoding, mostly already ~70 kb/s
  mono. Re-encoding to 48 kb/s would have saved ~260 KB by putting a second lossy pass
  on children's speech instruction — not a trade worth making.

### A 308 KB "win" that was measured, then thrown away

A first pass approved q68 for nine images on an alpha-weighted RMSE ≤ 2.6 budget,
including `mystical_cave_2` at 114,746 → 13,604 (RMSE 2.23) and
`bottom_strip_expanded` at 51,386 → 8,768 (RMSE 2.57). Rendering the crops side by
side showed q68 stripping the grain out of the cave background and flattening the
stone number strip into a smooth wash — clearly worse, on the two most-visible
surfaces in the game. **RMSE under-penalises structured error like texture removal**;
a scalar inside budget is not evidence the pixels survived. A high-frequency-energy
ratio was added alongside RMSE to make that visible, and the whole 308 KB was
discarded.

## 16. Canvas locked to 16:9 — 2026-07-29 (supersedes §14's caps)

§14 capped canvas expansion at 1.45×/1.35× so near-16:9 screens could still use spare
space. That kept 12 of 15 viewports byte-identical, but it also meant the framing
differed subtly per device, and a portrait window still drew the scene at 63% of the
screen height. The brief became **16:9 everywhere, responsive on all devices**, so the
canvas is now locked: `MAX_EXPAND_W = MAX_EXPAND_H = 1`.

The stage is always exactly **1920×1080**, scaled by `min(w/1920, h/1080)`, centred,
with the cave art filling the letterbox. Nothing reflows and nothing squeezes — the
only thing a viewport changes is how large the scene is drawn.

| Check | Result |
|---|---|
| Stage model, all 15 viewports | **1920×1080** on every one |
| Painted aspect ratio | **1.7778** — exact 16:9, measured on phone landscape and portrait window |
| Smallest touch target, all 15 | **48.0 CSS px** (the lock does not change the scale, so `js/touch.js` is unaffected) |
| Anything mostly offscreen | **0** viewports |
| Page scroll | **0** viewports |
| Console/page errors | **0** |
| Nine-round playthrough | 9/9 rounds, **18 taps**, ends on "Well Done! You collected all the gems!", flights **1304–1307 ms**, 0 console errors |

### The gate now measures playability, not orientation

Locking the canvas made orientation the wrong thing to gate on: an iPad in portrait
draws the whole scene at 48 px targets and plays fine, while a 568×320 phone in
*landscape* is the tighter case. `js/orientation.js` now blocks on canvas scale.

The strip is 108×105 stage px and `js/touch.js` can pad it by at most half the 47.5 px
neighbour gap, so the largest reachable target is about `150.4 × scale` CSS px. Apple's
44 px floor needs `scale ≥ 0.293`. Measured against that model:

| Viewport | Scale | Target | Result |
|---|---|---|---|
| 568×320 phone landscape | 0.2958 | **44.0** — model predicted 44 | plays |
| 740×360 / 667×375 / 844×390 landscape | 0.333–0.361 | 48 | plays |
| 1024×768 iPad landscape | 0.5333 | 56 | plays |
| **768×1024 iPad portrait** | 0.400 | **48** | **plays** |
| **863×1034 portrait window** | 0.4495 | **48** | **plays** |
| 390×844 phone portrait | 0.2031 | 29.6 | blocked |
| 480×320 | 0.25 | 36.9 | blocked |

`?allowportrait=1` (or `Orientation.allowPortrait()`) suppresses the gate entirely,
because an LMS or app embed fixes the frame and a child cannot rotate out of it.

**Not verified:** the wording branch. `canRotate()` tests
`(hover: none) and (pointer: coarse)`, which headless Chrome reports as false, so only
the "Please make the window bigger" copy was exercised. A real phone should read
"Please turn your device".

### Two harness traps worth recording

- **A caption regex matched the wrong line.** The playthrough exit condition tested
  `/Well Done/i`, which also matches the *random praise* clip "Well Done" — not just
  the final "Well Done! You collected all the gems!". One run therefore stopped a tap
  early with 17 taps and number 9 still waiting, looking like a game defect. It is
  not: match `/collected all the gems/i`. Earlier runs passed only because they drew a
  different praise line.
- **This machine drops `resize` events under memory pressure.** One run had
  `Engine.dump()` still reporting a previous viewport's stage, so both the engine's and
  the orientation module's resize handlers had silently stopped firing, and the gate
  looked broken when its logic was correct. `Orientation.apply()` is now exported so
  the logic can be tested without depending on event delivery, and `protocolTimeout`
  is raised to 180 s. Frame timings measured while this host is thrashing are not
  trustworthy — one run reported a 3154 ms flight and a 3013 ms frame that did not
  reproduce.

## 17. "Bag lag" — it was a dead input window, not a stutter — 2026-07-29

Reported twice as the bag lagging when a gem lands. Earlier answers said there was no
lag, citing `worstFrameInAnyFlight` of 15.7 ms and 0 janky frames. **That measurement
could not have seen this defect**: its window ran from gem-shown to gem-hidden, and
`updateBagImage()` — which does everything interesting — runs *at* gem-hidden. The
landing frame was never measured.

Measuring the landing directly shows the rendering is genuinely fine:

| Landing | Worst frame | Frames > 16.7 ms |
|---|---|---|
| All nine (`sack_1`…`sack_9`) | **4.3–8.2 ms** | **0** |

Sprite swap, `setText` and the audio start each cost under 1.5 ms synchronously. So it
is not a stutter. What it is:

| Time after the bag fills | What happens |
|---|---|
| +1 ms | Winner text ("One gem collected!") and its sound |
| **+733–985 ms** | Caption "Click on the number of gems found so far" starts typing, with its voice-over |
| **+1417 ms** | Number strip finally becomes interactable |

**For 430–680 ms the game asked for a tap and ignored it.** A child taps the number,
nothing answers, and that reads as lag. The window varies because the prompt's start
depends on the preceding winner clip's length, while
`callSetButtonSetWhenActive` waited a fixed `yield 1.4`.

### Fix

`showNextMessage` already resolves each message's `inputButton`, and for the number
prompt that resolves to **exactly that round's correct strip button** (round 1 → "1",
round 2 → "2", … verified for all nine). So the strip is now made answerable when that
message is shown, rather than on a timer. A fixed delay cannot track a prompt whose
start time depends on a voice-over; tying it to the message removes the race outright.
The 1.4 s timer stays as an idempotent backstop, and `currentCollectedGemsIndex` is
already correct by then — `incrementGemIndex()` runs 1 ms after the bag fills.

| Check | Before | After |
|---|---|---|
| Strip answerable the instant the prompt starts | no | **YES, 8/8 rounds measured** |
| Mean delay from bag filled to answerable | 1417 ms | 1004 ms |
| Nine-round playthrough | — | 9/9, 18 taps, ends on the final line, 0 console errors |

### A measurement trap this exposed

Measuring *transitions* instead of *state* invented a defect that did not exist. One
round reported a **+10,627 ms** dead window; its `stripON` timestamp was identical to
the next round's, because the strip had been continuously enabled through that round
and so produced no ON transition to find. Sampling "is the strip answerable right now"
at the instant the prompt fires gave the truthful answer, 8/8 ready. Ask for state at
the moment you care about, not for the nearest edge.

Two things this section does **not** claim. Frame timings on this host are unstable —
the same code measured 20.1, 35.8, 195.6 and 357.5 ms worst in-flight frame across
runs, and one run reported a 3154 ms flight that never reproduced; only the
landing-window figures above were taken from a quiet run. And the 1.4 s backstop is
unchanged, so a round whose prompt somehow arrives later than 1.4 s would still be
governed by the timer.
