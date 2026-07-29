# God Mode — `lbd1` developer, QA and design-review suite

An isolated debug layer for **Hidden Gem Sequence** (`lbd1`). It lets you jump
between screens and rounds, drag and resize any element Figma-style, edit text
live, export the result as layout JSON, and run automated QA and kid-focused UX
checks — without touching the learner build.

**Core principle: fully reversible, fully removable.** Delete the God Mode block
from `index.html` and the learner game is byte-identical. Toggling God Mode off at
runtime tears down every overlay, body class, layout edit and animation class, so
a learner can never see a debug affordance.

---

## Install

Already wired. The block at the bottom of `index.html` is:

```html
<!-- God Mode: dev/QA only. Delete this block to ship the learner build. -->
<link rel="stylesheet" href="god-mode/god-mode.css">
<script src="god-mode/god-mode-utils.js"></script>
<script src="god-mode/god-mode-panel.js"></script>
<script src="god-mode/god-mode-live-editor.js"></script>
<script src="god-mode/god-mode-animation-bar.js"></script>
<script src="god-mode/god-mode-qa.js"></script>
<script src="god-mode/god-mode-ux-review.js"></script>
<script src="god-mode/god-mode.js"></script>
```

Load order matters only in that `god-mode-utils.js` comes first and
`god-mode.js` last.

## Three ways to open it

Nothing here needs a web server — `file://` and `http://` are identical.

1. **Shift + G.** Matched on `e.code`, so it works with CapsLock on and on
   non-US layouts. Suppressed while you are typing in a panel field.
2. **`?god=1`** (or `?debug=1`) on the URL — opens with God Mode already on.
   Useful when a host page or an embed swallows keystrokes.
3. **`god()`** in the browser console — returns the new state.

---

## Files

| File | Role |
|---|---|
| `god-mode-utils.js` | Shared helpers (`window.GodModeUtils`): stage-space maths, clipboard with `execCommand` fallback, JSON download, node access, toast. Loaded **first**. |
| `god-mode-live-editor.js` | The layout editor. Select, drag, resize, type exact values, edit text, export JSON. |
| `god-mode-animation-bar.js` | Generated animation ideas per element type + trigger, live preview, standalone CSS/JS export. |
| `god-mode-qa.js` | 56 automated assertions against the live game and the real DOM. |
| `god-mode-ux-review.js` | Kid-focused heuristics with on-screen highlighting. |
| `god-mode.js` | Controller: activation, shortcuts, screen/round navigation, gems, animation speed, visual debug. |
| `god-mode-panel.js` | The panel markup as a string on `window.GOD_PANEL_HTML`. Held in JS, not fetched from a `.html`, so `http://` and `file://` behave identically — edit the template here. |
| `god-mode.css` | Every God Mode style, including the 27 `gmAnim-*` keyframes. |

All modules are IIFEs in strict mode. No build step, no dependencies.

---

## Keyboard shortcuts

**Shift + G** toggles God Mode (see the three entry routes above). Everything else
works only while it is on, and is suppressed while typing in a field.

| Key | Action |
|---|---|
| `E` | Cursor edit on/off |
| Arrows | Nudge selection 1px in stage space |
| Shift + arrows | Nudge 10px |
| Shift (held) | Temporary snap-to-grid while dragging or resizing |
| `N` / `P` / `R` | Next / previous / restart round |
| `D` | Reveal the current gem |
| `W` | Trigger wrong-answer feedback |
| `F` | Jump to "all collected" |
| `G` | Add a gem |
| `B` / `S` | Show bounds / safe area |
| `Q` | Run the full QA suite |
| `V` / `K` / `X` | Full UX review / kid-friendly check / clear highlights |
| `1`–`6` | Animation speed: pause, 0.25×, 0.5×, 1×, 1.5×, 2× |
| Ctrl/Cmd + C | Copy the selected element's values |
| Ctrl/Cmd + E | Copy every edited value |

Panels are draggable by their header and clamped so they can never be lost
off-screen. `−` minimises one to its header bar.

---

## The layout editor

### Why it writes RectTransform fields, not CSS

Geometry in this build is not authored in CSS. `engine.js` computes, per axis:

```
size   = (anchorMax − anchorMin) × parentSize + sizeDelta
corner = anchorMin × parentSize + anchoredPosition − sizeDelta × pivot
```

from `js/data.js`. So a drag has to change `anchoredPosition` and a resize has to
change `sizeDelta`; writing `style.left` would be wiped by the next relayout (any
window resize, or any layout-group reflow) and could not be exported. Both are
applied through the engine, so the whole subtree re-lays-out exactly as it does
at boot.

### Three conventions that trip people up

1. **Unity Y points up** from the parent rect's bottom-left; the browser's points
   down from the top-left. Dragging an element downward *lowers* its `Y`. The
   editor negates once, so the number in the `Y` field is always the value
   `data.js` wants.
2. **`localScale` is applied after layout**, about the pivot. A node can render
   1.5× its `sizeDelta`. The editor divides pointer deltas by the node's own scale
   before writing `sizeDelta`, and scales the `anchoredPosition` compensation to
   match, so the corner opposite the handle you grabbed stays pinned on screen
   while the exported numbers stay correct Unity values.
3. **Most artwork has `pointer-events: none`** (Unity `raycast: false`), so the
   browser's own hit test cannot see it. The editor hit-tests geometry directly,
   walking the scene graph in reverse paint order, which is why you can grab the
   background as easily as a button.

### Selecting

- **Element** dropdown lists every node carrying an Image, a text component or a
  Button — 75 of them, generated from the live scene graph, so nothing needs
  hand-registering. Inactive nodes are prefixed with `·`.
- **Cursor edit** (`E`) turns on direct manipulation: hover to outline, click to
  select, drag to move, eight handles to resize. The click that follows a pick or
  a drag is swallowed, so editing never fires a game button.
- **Lock selected** protects the current element from accidental drags.
- **Reveal inactive nodes** (Visual debug) makes hidden nodes faintly visible and
  selectable, which is how you align gems, hands and the completion panel without
  playing to them.

### Editing

| Control | Writes |
|---|---|
| X / Y | `anchoredPosition` |
| W / H | `sizeDelta` |
| Scale, Rot Z | `localScale`, `localEulerAngles.z` |
| Opacity, z-index | inline style (preview only — not serialized fields) |
| Font px | the text component's `fontSize` (disables TMP autosize) |
| Text area + **Apply text** | the live string |
| **Centre X / Y** | centres inside the parent rect |
| **Fit content** | measures intrinsic size and writes it to `sizeDelta` |
| **Ghost copy** | a 50%-opacity clone for 8s, to compare variants |

### Exporting

**⬇ Layout JSON** downloads `layout_lbd1_<timestamp>.json`:

```json
{
  "screen": "lbd1",
  "reference": [1920, 1080],
  "assets": [
    {
      "id": "1089342379",
      "name": "5_treasure box",
      "path": "/GamePlay/BackGround/Gameplay/5_treasure box",
      "anchoredPosition": [-137, -116],
      "sizeDelta": [114.67, 122.67],
      "was": { "anchoredPosition": [-257, -36], "sizeDelta": [88, 96] }
    }
  ]
}
```

Only elements you actually changed are included. `was` is carried so a reviewer
can audit the patch. Then make it permanent:

```bash
node tools/apply_layout.js layout_lbd1_2026-07-29T05-40-36.json --dry-run
node tools/apply_layout.js layout_lbd1_2026-07-29T05-40-36.json
```

The applier finds each node by its Unity fileID, rewrites only that node's own
`anchoredPosition` / `sizeDelta` / `scale` / `rotZ` / `fontSize` / `text`, writes
a `js/data.js.bak` before the first edit, re-parses the result to prove it is
still valid JS, and prints an `id | name | status | change` table. An asset whose
ID is missing is reported as `NOT FOUND`, never skipped silently.

**Save to browser** / **Load from browser** persist the same payload in
`localStorage` for iterating across reloads. **Clear saved** removes it and resets
every edit.

---

## Screen and round navigation

Jumps go through the game's own methods, never by poking the DOM, so every
`objectsToEnable` / `objectsToDisable` list still runs in order.

- **Splash / Gameplay / Wrong feedback / All collected** — the four screen states.
- **Round chips 1–9** — replay a round from its first line, with the gem count set
  to match so the strip behaves correctly.
- **Round control** — prev / restart / next, reveal the current gem, skip a line,
  trigger the wrong-answer flow, shake the background.
- **Gems** — add, remove, set 9, force-enable the strip, reset.

Before every jump the per-round props (hands, gems, hotspot buttons, glow
effects, the completion panel, the red alert, the incorrect panel and the final
bag) are hidden, so screens never stack.

---

## QA tests

Eight suites, 56 assertions, all against the running instance.

| Test | Verifies |
|---|---|
| **Smoke** | Game handle, engine API, embedded data, all controller methods, 9 rounds, 9 strip buttons, 23 clips. Also asserts `setSprite`/`setImageColor` route through `paintImage` — the guard against the duplicate-declaration regression that once broke every sprite swap. |
| **Captions / VO** | The caption node is active, not `display:none`, has area and sits on-canvas; VO durations are cached; every `audioIndex` resolves; typing duration matches its clip within 0.25s; caption wording overlaps its clip filename. |
| **Round data** | Every round has a hotspot and a strip prompt; no gamey wording, over-long lines or double spaces. |
| **Sprites** | For every Image, the sprite in the model is the one actually painted on the `.un-img` layer, and no `mask-image` has leaked onto a subtree. |
| **Interaction** | Every Button is bound; all nine strip buttons carry their persistent `ValidateClick`; `handleNextClick` survives a tap after the final line; tap targets meet 80px in stage space. |
| **Responsive** | Scale equals `min(w/1920, h/1080)`; no page scroll; smallest strip button against the 44px touch minimum; portrait guard installed. |
| **Loading** | Manifest is non-empty, VO metadata read, every manifest image is in cache, the veil has been torn down. |
| **Analytics** | Every event matches `(q_id, selected, correct, isCorrect, attempt)`; no duplicate submissions. |

**Copy report** puts a timestamped run on the clipboard.

---

## UI/UX review

Kid-focused heuristics. Offending nodes are highlighted **on the game itself** —
`uxIssue` red, `uxWarning` amber, `uxGood` green — and a plain-language report is
written into the review panel. All size checks run in stage space, so
scale-to-fit can never fake a result.

| Check | Heuristics |
|---|---|
| **Tap targets** | ≥ 80px on the design grid, and ≥ 44 real pixels at the current viewport. |
| **Text** | ≥ 24px on the design grid, no overflow, nothing over 120 characters, no double spaces or stray carriage returns. |
| **Hierarchy** | Caption present and in the upper half; full-bleed layers listed; anything spilling past the canvas edge flagged. |
| **Clutter** | Live tappable count, exactly one message panel visible, no duplicate tap hints. |
| **Kid-friendly** | No gamey/meta wording (*score, level 1, round, combo, points*), nothing over 140 characters, digits in instruction text flagged (this game teaches counting by word). |
| **Voice-over** | Every spoken line has a caption and vice versa; captions finish with their clip. |

---

## Animation ideas

Select an element and the bar classifies it — `gem`, `bag`, `hint`, `glow`,
`celebration`, `panel`, `text`, `numberButton`, `hotspot`, `backdrop`, `prop` —
picks a sensible default trigger, and generates idea chips from a bank keyed by
type + condition. Click a chip to preview it live on the real element.

Labels are resolved to real keyframe classes by an **ordered keyword regex**
(first match wins) covering *heartbeat, tick, edge-flash, shake, ring, jelly,
squish, confetti, burst, rotate, fly, freeze, smoke, recoil, shine, spark, pop,
drop, slide, flip, fade, jump, wave, sad, wiggle, drift, scale, bounce*. Invent a
new name and it still resolves; unmatched labels fall back to a soft bounce.

**▸ Copy animation code** emits **standalone** CSS + JS — the keyframes are lifted
out of `god-mode.css` and renamed, so the export works in the real game without
depending on God Mode. You get a kebab-cased class, a camelCased keyframe, a
`playPascalCase(el)` replay helper that forces a reflow, and a best-effort
selector.

---

## Visual debug

| Toggle | Effect |
|---|---|
| Show bounds | Outlines every Image / text / Button node (text in pink) |
| Safe area & centre guides | 16:9 frame, 90% title-safe box, centre crosshair, drawn inside the stage so it scales with the canvas |
| Text box bounds | Outlines text containers to spot overflow |
| Tap / hit areas | Highlights everything that accepts a tap, including the invisible hotspot buttons |
| Reveal inactive nodes | Makes hidden nodes faintly visible and selectable |

**Animation speed** sets `--god-animation-speed` on `<html>` and `playbackRate`
on every animation from `document.getAnimations()`; speed 0 also adds
`body.godPauseAnimations`.

---

## Game API used

God Mode drives the game only through its public surface, exposed by `main.js` as
`window.lbd1Game` (alias of `window.__game`):

- `engine`, `game`, `analytics`, `loadGameplay()`, `isLoaded()`, `state()`
- `game.tutorial` — `tutorials`, `messages`, `clips`, `Number_btn`,
  `currentCollectedGemsIndex`, `Attemptnumber`, `tutorialIndex`, `messageIndex`,
  `isTyping`, `dialogueText`, `CorrectTextobject`, `incorrectTextobject`,
  `redalert`, plus `showNextMessage()`, `handleNextClick()`, `typeText()`,
  `showCaption()`, `applyButtonSet()`, `charDelay()`
- `game.cameraShake.onClickShakeBox()`, `game.buttonByComp[...].validateClick()`
- `Engine` — `get`, `order`, `setActive`, `isActiveInHierarchy`, `setAnchoredPos`,
  `setSizeDelta`, `setScale`, `setRotZ`, `setFontSize`, `setZIndex`, `setText`,
  `setSprite`, `setImageColor`, `relayout`, `scale`, `stageSize`, `stageRectOf`,
  `onTick`, `onResize`

`setSizeDelta`, `getSizeDelta`, `setFontSize`, `getFontSize`, `setZIndex` and
`stageRectOf` were added to `engine.js` for this suite; nothing in the game calls
them, so removing God Mode leaves them as unused exports.
