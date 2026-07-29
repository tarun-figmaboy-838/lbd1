# QA checklist — lbd1 (Hidden Gem Sequence)

Reviewed and re-verified 2026-07-29 in real headless Chromium over CDP, driving the
game with genuine pointer events — not a DOM shim and not a static read. Every row
below was asserted mechanically; screenshots were inspected for the visual ones.

Re-run in the browser at any time: **Shift + G** → *Run all* (QA, 56 assertions)
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

- `ChatBox` has `Group_7.png` at **alpha 0** — the caption panel is invisible by
  design and the white text floats. Not a missing sprite.
- The caption is **left-aligned at the top-left** of a 1261×103 box: that is the
  authored TMP alignment, not a layout error.
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
| QA suite | **56 passed, 0 failed, 0 warnings** |
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
