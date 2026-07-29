# Hidden Gem Sequence — static HTML build

`lbd1` from *Kabir and the Lost Princess*, rebuilt from the Unity project as a
dependency-free static site. Nine numbered hidden-object targets are revealed one at a time. After each gem flies to the collection bag the learner taps the number of gems found so far on a nine-button strip.

## Run it

```bash
cd lbd1
python3 -m http.server 8000
# open http://localhost:8000
```

No build step, no npm install, no server-side code. It also runs from `file://`
because the layout and configuration are embedded in `js/data.js` rather than
fetched.

## Deploy it

Upload the folder as-is to Vercel, Netlify, GitHub Pages, S3 or any static host.
There is nothing to configure.

## Folder structure

```
lbd1/
├── index.html
├── favicon.png
├── css/style.css        @font-face + stage scaling + node classes + overlays
├── js/
│   ├── data.js          embedded window.LAYOUT / SPLASH_LAYOUT / CONFIG
│   ├── engine.js        uGUI runtime (layout, tweens, audio, particles)
│   ├── analytics.js     window.quizAnswerSubmitted wrapper
│   ├── preloader.js     asset gate + window.AUDIO_DURATIONS
│   ├── orientation.js   portrait-phone rotate prompt
│   ├── hint.js          puts the tap hand's fingertip on the glowing spot
│   ├── controllers.js   one function per ported MonoBehaviour
│   └── main.js          boot + scene flow
├── god-mode/            dev/QA layer — see god-mode/README.md
├── tools/apply_layout.js  writes a God Mode layout export back into data.js
├── assets/{img,audio,fonts}
└── reports/             extraction, behaviour, QA and approximation notes
```

## Loading

`js/preloader.js` walks every sprite and clip out of the embedded layout, decodes
them behind an opaque veil with a progress bar, and reveals a fully painted first
frame. It also caches clip durations as `window.AUDIO_DURATIONS`, which is what
lets the dialogue typewriter finish each caption with its voice-over instead of
running at a fixed characters-per-second.

The game still boots immediately — it boots *underneath* the veil. Removing the
`<script>` tag restores the original un-gated boot; `main.js` only calls
`Preloader.hold()` when it exists.

## Orientation

The CanvasScaler runs in Expand mode, so on a 390 px-wide phone the 1920×1080
design scales to 0.203 and the number strip renders about 22 px tall — under any
comfortable touch target. `js/orientation.js` asks for landscape on portrait
phones (short side under 500 px) and leaves tablets and desktops alone. The scaler
is untouched, so framing everywhere else is unchanged.

## Tap hints

The scene positions each tap hand independently of the glow it is meant to point
at, so the finger landed in empty space — up to 70 px below and 46 px to the side
of the glowing spot. `js/hint.js` places the fingertip on the round's active glow
instead, measured from the sprite's actual topmost opaque pixel, and a CSS pulse
stands in for the Animator that was never ported. Remove the `<script>` tag to fall
back to the serialized positions.

## Developer tools

Press **Shift + G** to open God Mode — or append `?god=1` to the URL, or call
`god()` in the console. Jump to any screen or round, drag and resize any element
Figma-style, edit text live, export the result as layout JSON, and run 56 automated
QA assertions plus a kid-focused UX review. Works identically from `file://`. Full
documentation in [`god-mode/README.md`](god-mode/README.md).

To ship the learner build, delete the God Mode block at the bottom of
`index.html`. Nothing else changes.

## Source

| | |
|---|---|
| Unity version | 2022.3.23f1 |
| Reference resolution | 1920 × 1080 |
| Colour space | Linear |
| Scenes ported | `Assets/Scenes/Main.unity`, `Assets/Scenes/LBD1.unity` |
| Canvas | Screen Space – Camera, CanvasScaler *Scale With Screen Size*, **Expand** |
| DOM nodes at runtime | 110 |

Because the scaler uses **Expand**, the scale factor is `min(w/1920, h/1080)`
and the canvas grows in the shorter axis on non-16:9 screens — exactly what the
Unity build does. Composition never stretches, crops or rearranges.

## Analytics contract

This game reports answers through the same hook as the Unity WebGL build
(`Assets/Plugins/WebGL/TrackingPlugin.jslib`):

```js
window.quizAnswerSubmitted(questionId, selectedNumber, correctNumber,
                           isCorrect, attemptNumber);
```

Define that function on the host page before the game loads. Argument order and
types are unchanged, it fires exactly once per submitted answer, and the game
runs normally when the hook is absent (it logs to the console instead).
`Analytics.log()` returns every call made in the session.

## Browser support

Chrome / Edge 88+, Firefox 94+, Safari 15.4+. Requires CSS
`background-blend-mode`, `border-image`, `clip-path` and Pointer Events. Audio
starts on the learner's first interaction, as browsers require; the visible flow
is unchanged.

## Fidelity

This is a second implementation in a different renderer, not a Unity export, so
it is not bit-identical. Layout, timings, easing curves, dialogue, audio order
and answer values are taken from the scene YAML and the C# rather than
re-authored. See `reports/known-approximations.md` for the specific gaps and
`reports/visual-verification.md` for what was and was not measured.
