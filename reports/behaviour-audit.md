# Behaviour audit - lbd1

Every live MonoBehaviour and where it went. Instance counts come from GUID occurrences in the scene, so nothing is ported speculatively and nothing live is skipped.

| Unity script | Instances | Ported to | Behaviour preserved |
|---|---|---|---|
| `TutorialDialogue.cs` | 2 | `Game.TutorialDialogue` | 9 tutorial sets / 39 messages, typingSpeed 0.06 s per char, 23 audio clips, random pool Awesome! / Great Job! / Well Done! (clips 19/20/21) |
| `TutorialClickableButton.cs` | 9 | `Game.TutorialClickableButton` | 9 instances, buttonId 1-9, resetDelay 2 s, correct/incorrect sprite swap, analytics submitted on both branches |
| `GemCollectEffect.cs` | 9 | `Game.GemCollectEffect` | 9 instances (C# class MoveImageWithJumpAndScale). delay 0.1 s, scale to 3x over 0.5 or 0.7 s easeOutBack, hold 0.2 s, easeInBack back to 1, jump arc over 0.5 or 1.0 s, jumpHeight 100 |
| `GemMover.cs` | 1 | `Game.GemMover` | Final Bag: move to canvas centre and scale to 3 over 1 s easeInOutQuad, pop to 3.5 (0.2 s easeOutBack), settle to 3 (0.15 s easeInOutSine) |
| `CameraShake.cs` | 1 | `Game.CameraShake` | singleton on /Main Camera, target /GamePlay/BackGround. scale 1.1, rotate +/-3 deg, 1 loop, tint (0.102, 0.275, 0.353) over 0.1 s |
| `TypewriterEffect.cs` | 1 | `Game.TypewriterEffect` | incorrectChatBox types "Count carefully!" at 0.05 s per char, on Start() |
| `SplashScreenLoader.cs` | 1 | `Game.SplashScreenLoader` | ping-pong scale to 1.1 over 1 s easeInOutSine, tap.mp3 on click, 0.5 s fade, then scene swap |

## Scene-wired UnityEvents

Button behaviour is driven by the serialized `m_OnClick` lists, in scene order, not by re-reading the C#. Persistent (Inspector) listeners and runtime `AddListener` calls are tracked separately, because Unity's `RemoveAllListeners()` removes only the runtime ones.

- the nine hidden-object `Button`s each call only `TutorialDialogue.playaudio(17)`; the gem reveal itself comes from the dialogue message's `inputButton` plus its `objectsToEnable` list
- the nine strip buttons call `TutorialClickableButton.ValidateClick()` and then `TutorialDialogue.playaudio(17)`

## Lifecycle

`Awake` runs only for objects active in the hierarchy at scene load. `Start` runs once, on first activation. `OnEnable` / `OnDisable` can repeat. Controllers on inactive objects do not run until their object is shown, which is what stops delayed hints and dialogue audio leaking across rounds.

Every timer and tween belongs to a cancellable task group, so `StopAllCoroutines` and `DOTween.Kill` semantics hold: a delayed hint from a previous round cannot fire during the next one.
