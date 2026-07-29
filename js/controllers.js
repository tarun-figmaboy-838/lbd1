/* ==========================================================================
 * controllers.js -- LBD-1 "Hidden Gem Sequence"
 *
 * Ported line-by-line from:
 *   Assets/Scripts/TutorialDialogue.cs        (the LBD-1 variant)
 *   Assets/Scripts/TutorialClickableButton.cs
 *   Assets/Scripts/GemCollectEffect.cs   (class MoveImageWithJumpAndScale)
 *   Assets/Scripts/GemMover.cs   CameraShake.cs   TypewriterEffect.cs
 *   Assets/Scripts/SplashScreenLoader.cs
 *
 * Faithfulness notes (all verified against the scene, not assumed):
 *   - typingSpeed is 0.06 in this scene, not the 0.05 script default.
 *   - CameraShake.rightSideBox is serialized as /GamePlay/BackGround, i.e. the
 *     whole background shakes, and lightRed is actually a dark blue-grey
 *     (0.102, 0.275, 0.353). Reproduced as serialized.
 *   - HandleNextClick can advance twice for a non-waitForInput message: it
 *     starts AutoAdvanceAfterDelay and then falls into the
 *     hasFinishedTypingMessage branch in the same call. Preserved.
 *   - CallSetButtonSetWhenActive waits 1.4 s and then starts a coroutine that
 *     waits another 1.4 s, so the number buttons re-enable after 2.8 s.
 *   - CameraAutoResize.cs is never attached to any GameObject in either scene,
 *     so there is no 16:9 letterbox stage; the CanvasScaler alone governs.
 * ======================================================================== */
'use strict';

var Game = (function () {
  var E = Engine, C = window.CONFIG;

  var compHost = Object.create(null), trHost = Object.create(null);
  function indexLayout(roots) {
    (roots || []).forEach(function walk(n) {
      if (n.trId) trHost[String(n.trId)] = String(n.id);
      (n.components || []).forEach(function (c) {
        if (c.id != null) compHost[String(c.id)] = String(n.id);
      });
      (n.children || []).forEach(walk);
    });
  }
  indexLayout(window.LAYOUT);
  indexLayout(window.SPLASH_LAYOUT);

  function go(v) {
    if (v == null) return null;
    var f = (typeof v === 'object') ? v.__ref : v;
    if (f == null || f === '0') return null;
    f = String(f);
    if (E.get(f)) return f;
    if (compHost[f]) return compHost[f];
    if (trHost[f]) return trHost[f];
    return null;
  }
  function compId(v) {
    if (v == null) return null;
    var f = (typeof v === 'object') ? v.__ref : v;
    return (f == null || f === '0') ? null : String(f);
  }
  function script(type, list) {
    list = list || C.scripts;
    for (var i = 0; i < list.length; i++) if (list[i].__type === type) return list[i];
    return null;
  }
  function scriptsOf(type, list) {
    return (list || C.scripts).filter(function (s) { return s.__type === type; });
  }
  function liveScript(type) {
    var all = scriptsOf(type);
    for (var i = 0; i < all.length; i++) {
      if (E.isActiveInHierarchy(go(all[i].__host))) return all[i];
    }
    return all[0] || null;
  }
  function audioPath(v) { return v && v.__audio ? v.__audio : null; }
  function sprite(v) { return v && v.__sprite ? v.__sprite : null; }

  // LeanTweenType -> engine ease name (only the values this scene uses).
  var LT = {
    1: 'linear', 2: 'outQuad', 3: 'inQuad', 4: 'inOutQuad',
    5: 'inCubic', 6: 'outCubic', 7: 'inOutCubic',
    22: 'inSine', 23: 'outSine', 24: 'inOutSine',
    28: 'outBack', 27: 'inBack', 29: 'inOutBack', 32: 'outElastic'
  };
  function ltEase(v, dflt) { return LT[v] || dflt || 'linear'; }

  // ---- AudioSource registry by component id ------------------------------
  var srcByComp = Object.create(null);
  function indexAudio(roots, tag) {
    (roots || []).forEach(function walk(n) {
      (n.components || []).forEach(function (c) {
        if (c.kind === 'AudioSource') {
          srcByComp[String(c.id)] = {
            host: String(n.id), clip: c.clip, vol: c.volume, loop: c.loop,
            playOnAwake: c.playOnAwake, channel: tag + ':' + c.id
          };
        }
      });
      (n.children || []).forEach(walk);
    });
  }
  indexAudio(window.LAYOUT, 'p');
  indexAudio(window.SPLASH_LAYOUT, 's');

  function srcPlay(src, clip) {
    if (src && clip) {
      E.stopChannel(src.channel);
      E.play(src.channel, clip, { volume: src.vol, loop: src.loop });
    }
  }

  /** Target anchoredPosition that puts `id`'s centre on `targetId`'s centre. */
  function centreAnchoredPos(id, targetId) {
    var rec = E.get(id), tc = E.centerOf(targetId);
    if (!rec) return [0, 0];
    var px = 0, py = 0, n = rec.parent;
    while (n) { px += n.left; py += n.top; n = n.parent; }
    var pw = rec.parent ? rec.parent.w : E.stageSize()[0];
    var ph = rec.parent ? rec.parent.h : E.stageSize()[1];
    var d = rec.data;
    var cornerX = (tc[0] - px) - rec.w / 2;
    var cornerYBottom = (ph - (tc[1] - py)) - rec.h / 2;
    return [cornerX - d.anchorMin[0] * pw + d.sizeDelta[0] * d.pivot[0],
      cornerYBottom - d.anchorMin[1] * ph + d.sizeDelta[1] * d.pivot[1]];
  }

  // ======================================================== TutorialDialogue
  function TutorialDialogue(cfg) {
    var self = this;
    this.cfg = cfg;
    this.dialogueText = go(cfg.dialogueText);
    this.incorrectTextobject = go(cfg.incorrectTextobject);
    this.CorrectTextobject = go(cfg.CorrectTextobject);
    this.redalert = go(cfg.redalert);
    this.gameplaySrc = srcByComp[compId(cfg.gameplay_audioSource)];
    this.uiSrc = srcByComp[compId(cfg.ui_audioSource)];
    this.clips = (cfg.tutorialAudioClips || []).map(audioPath);
    this.Number_btn = (cfg.Number_btn || []).map(go);
    this.randomMessages = cfg.randomMessages || [];
    this.tutorials = cfg.tutorials || [];
    this.typingSpeed = cfg.typingSpeed != null ? cfg.typingSpeed : 0.05;
    this.finalGemBagSprite = sprite(cfg.finalGemBagSprite);

    this.currentCollectedGemsIndex = cfg.currentCollectedGemsIndex || 0;
    this.Attemptnumber = cfg.Attemptnumber || 0;
    this.tutorialIndex = 0;
    this.messageIndex = 0;
    this.isTyping = false;
    this.hasFinishedTypingMessage = false;

    this.typing = new E.TaskGroup('td-type');
    this.btnGroup = new E.TaskGroup('td-btn');

    this.start = function () { self.startDialogue(); };
  }

  TutorialDialogue.prototype.startDialogue = function () {
    this.tutorialIndex = 0;
    this.messageIndex = 0;
    this.showNextMessage();
  };

  /**
   * ChatText is serialized inactive and no message's objectsToEnable list ever
   * turns it on, so the typewriter used to write every line into a
   * display:none node -- the whole tutorial played with no captions. The
   * serialized CorrectTextobject field (the ChatBox panel) was likewise read
   * from the config and never used. Both are driven here instead.
   */
  TutorialDialogue.prototype.showCaption = function (on) {
    if (this.CorrectTextobject) E.setActive(this.CorrectTextobject, !!on);
    if (this.dialogueText) E.setActive(this.dialogueText, !!on);
  };

  TutorialDialogue.prototype.showNextMessage = function () {
    var self = this;
    if (this.tutorialIndex >= this.tutorials.length) {
      E.setText(this.dialogueText, '');
      this.showCaption(false);          // hand the panel over to ChatTextEnd
      return;
    }
    var currentMessages = this.tutorials[this.tutorialIndex].messages || [];
    if (this.messageIndex >= currentMessages.length) {
      this.tutorialIndex++;
      this.messageIndex = 0;
      this.Attemptnumber = 0;
      this.showNextMessage();
      return;
    }
    var msg = currentMessages[this.messageIndex];

    msg.__voIndex = msg.audioIndex;
    if (msg.isRandom && this.randomMessages.length > 0) {
      var ri = Math.floor(Math.random() * this.randomMessages.length);
      var rd = this.randomMessages[ri];
      msg.message = rd.message;
      if (rd.audioClipIndex >= 0 && rd.audioClipIndex < this.clips.length) {
        msg.__voIndex = rd.audioClipIndex;   // the praise clip, not audioIndex
        this.playAudioDelayed(rd.audioClipIndex, msg.audioDelay || 0,
          this.messageIndex);
      }
    }

    this.enableDisableObjectsWithDelay(msg, this.messageIndex);

    if (msg.audioIndex >= 0 && msg.audioIndex < this.clips.length) {
      this.playAudioDelayed(msg.audioIndex, msg.audioDelay || 0,
        this.messageIndex);
    }

    this.typeText(msg);

    // NOTE: unlike the LBD-3 variant there is no waitForInput guard here.
    var btn = go(msg.inputButton);
    if (btn) {
      E.setActive(btn, true);
      E.clearClicks(btn);              // onClick.RemoveAllListeners()
      E.addClick(btn, function () { self.handleNextClick(btn); });
    }
    this.messageIndex++;
  };

  /**
   * Per-character delay for one message. When the message has a voice-over the
   * typewriter is stretched (or compressed) so the last glyph lands with the
   * last word of the clip; at the serialized 0.06 s/char the caption drifted up
   * to 1.1 s away from the audio. Durations come from the preloader's metadata
   * pass, so this stays synchronous.
   */
  TutorialDialogue.prototype.charDelay = function (msg, chars) {
    if (!chars) return this.typingSpeed;
    var idx = msg.__voIndex != null ? msg.__voIndex : msg.audioIndex;
    var dur = (idx >= 0 && window.AUDIO_DURATIONS)
      ? window.AUDIO_DURATIONS[this.clips[idx]] : null;
    if (!dur || !isFinite(dur) || dur <= 0) return this.typingSpeed;
    return dur / chars;
  };

  TutorialDialogue.prototype.typeText = function (msg) {
    var self = this;
    this.typing.reset();
    var text = msg.message == null ? '' : String(msg.message);
    this.isTyping = true;
    this.hasFinishedTypingMessage = false;
    this.showCaption(true);
    E.setText(this.dialogueText, '');
    var step = this.charDelay(msg, text.length);
    this.typing.run(function* () {
      var acc = '';
      for (var i = 0; i < text.length; i++) {
        acc += text[i];
        E.setText(self.dialogueText, acc);
        yield step;
      }
      self.isTyping = false;
      self.hasFinishedTypingMessage = true;
      if (!msg.waitForInput) {
        yield (msg.autoAdvanceDelay || 0);
        self.showNextMessage();
      }
    });
  };

  TutorialDialogue.prototype.handleNextClick = function () {
    var self = this;
    // A message's input button keeps its runtime listener after the dialogue
    // moves on, and applyButtonSet leaves the last strip button interactable
    // once every gem is in, so one more tap after the final line used to index
    // past the end of `tutorials` and throw.
    var tut = this.tutorials[this.tutorialIndex];
    var msg = tut && tut.messages ? tut.messages[this.messageIndex - 1] : null;
    if (!msg) return;
    if (this.isTyping) {
      this.typing.cancel();
      E.setText(this.dialogueText, msg.message == null ? '' : String(msg.message));
      this.isTyping = false;
      this.hasFinishedTypingMessage = true;
      if (!msg.waitForInput) {
        // AutoAdvanceAfterDelay -- runs in addition to the branch below
        var g = new E.TaskGroup('td-auto');
        g.run(function* () {
          yield (msg.autoAdvanceDelay || 0);
          self.showNextMessage();
        });
      }
    }
    if (this.hasFinishedTypingMessage) {
      this.hasFinishedTypingMessage = false;
      this.showNextMessage();
    }
  };

  TutorialDialogue.prototype.showNextIfNotTyping = function () {
    if (!this.isTyping && this.hasFinishedTypingMessage) {
      this.hasFinishedTypingMessage = false;
      this.showNextMessage();
    }
  };

  TutorialDialogue.prototype.enableDisableObjectsWithDelay =
    function (msg, localMessageIndex) {
      var self = this;
      (msg.objectsToDisable || []).forEach(function (o) {
        var id = go(o); if (id) E.setActive(id, false);
      });
      var list = msg.objectsToEnable || [];
      if (!list.length) return;
      var grp = new E.TaskGroup('td-enable-' + localMessageIndex);
      grp.run(function* () {
        for (var i = 0; i < list.length; i++) {
          yield (list[i].delayBeforeEnable || 0);
          if (localMessageIndex !== self.messageIndex - 1) return;
          var id = go(list[i].obj);
          if (id) E.setActive(id, true);
        }
      });
    };

  TutorialDialogue.prototype.playAudioDelayed =
    function (audioIndex, delay, localMessageIndex) {
      var self = this;
      var grp = new E.TaskGroup('td-audio');
      grp.run(function* () {
        yield delay;
        if (localMessageIndex === self.messageIndex - 1) {
          srcPlay(self.gameplaySrc, self.clips[audioIndex]);
        }
      });
    };

  TutorialDialogue.prototype.playaudio = function (audioIndex) {
    srcPlay(this.uiSrc, this.clips[audioIndex]);
  };

  TutorialDialogue.prototype.incrementGemIndex = function () {
    this.currentCollectedGemsIndex++;
  };

  /** 1.4 s wait, then a coroutine that waits another 1.4 s. */
  TutorialDialogue.prototype.callSetButtonSetWhenActive = function () {
    var self = this;
    this.btnGroup.reset();
    this.btnGroup.run(function* () {
      yield 1.4;
      yield 1.4;
      self.applyButtonSet();
    });
  };

  TutorialDialogue.prototype.setButtonSetCoroutine = function (delay) {
    var self = this;
    var g = new E.TaskGroup('td-btnset');
    return g.run(function* () {
      if (delay > 0) yield delay;
      self.applyButtonSet();
    });
  };

  TutorialDialogue.prototype.applyButtonSet = function () {
    for (var i = 0; i < this.Number_btn.length; i++) {
      if (this.Number_btn[i]) {
        E.setInteractable(this.Number_btn[i],
          i >= this.currentCollectedGemsIndex - 1);
      }
    }
  };

  TutorialDialogue.prototype.disableButtonsIntractable = function () {
    for (var i = 0; i < this.Number_btn.length; i++) {
      if (this.Number_btn[i]) E.setInteractable(this.Number_btn[i], false);
    }
  };

  // =================================================== TutorialClickableButton
  function TutorialClickableButton(cfg) {
    this.host = go(cfg.__host);
    this.buttonId = cfg.buttonId;
    this.correctSprite = sprite(cfg.correctSprite);
    this.incorrectSprite = sprite(cfg.incorrectSprite);
    this.resetDelay = cfg.resetDelay != null ? cfg.resetDelay : 2;
    var rec = E.get(this.host);
    this.defaultSprite = rec && rec.img ? rec.img.sprite : null;
    this.grp = new E.TaskGroup('tcb-' + this.host);
  }

  TutorialClickableButton.prototype.validateClick = function () {
    var self = this, t = Game.tutorial;
    if (!t) return;
    t.disableButtonsIntractable();

    var isCorrect = (t.currentCollectedGemsIndex === this.buttonId);
    E.setSprite(this.host, isCorrect ? this.correctSprite : this.incorrectSprite);

    if (isCorrect) {
      E.setInteractable(this.host, false);
      Analytics.submitQuizAnswer(t.tutorialIndex + 1, this.buttonId,
        t.currentCollectedGemsIndex, true, t.Attemptnumber);
    } else {
      t.Attemptnumber++;
      // incorrectChatBox sits exactly on top of ChatBox, so the caption has to
      // step aside for it and come back when the panel resets.
      t.showCaption(false);
      if (t.incorrectTextobject) E.setActive(t.incorrectTextobject, true);
      srcPlay(t.gameplaySrc, t.clips[5]);
      if (t.redalert) E.setActive(t.redalert, true);
      if (Game.cameraShake) Game.cameraShake.onClickShakeBox();

      this.grp.reset();
      this.grp.delayedCall(this.resetDelay, function () {
        if (self.defaultSprite) E.setSprite(self.host, self.defaultSprite);
        if (t.redalert) E.setActive(t.redalert, false);
        if (t.incorrectTextobject) E.setActive(t.incorrectTextobject, false);
        t.showCaption(true);
        t.setButtonSetCoroutine(0);
      });

      Analytics.submitQuizAnswer(t.tutorialIndex + 1, this.buttonId,
        t.currentCollectedGemsIndex, false, t.Attemptnumber);
    }
  };

  // ============================================ GemCollectEffect (gem -> bag)
  function GemCollectEffect(cfg) {
    var self = this;
    var imageToMove = go(cfg.imageToMove) || go(cfg.__host);
    var targetObject = go(cfg.targetObject);
    var targetImage = go(cfg.targetImage);
    var duration = cfg.duration != null ? cfg.duration : 1;
    var jumpHeight = cfg.jumpHeight != null ? cfg.jumpHeight : 100;
    var delay = cfg.delay != null ? cfg.delay : 0.1;
    var hEase = ltEase(cfg.horizontalEase, 'inOutQuad');
    var upEase = ltEase(cfg.jumpEaseUp, 'outQuad');
    var downEase = ltEase(cfg.jumpEaseDown, 'inQuad');
    var scaleUp = cfg.scaleUp || { x: 1.2, y: 1.2 };
    var scaleDuration = cfg.scaleDuration != null ? cfg.scaleDuration : 0.3;
    var targetSprite = sprite(cfg.targetSprite);
    var messageText = go(cfg.messageText);
    var winnerText = cfg.winnerText == null ? '' : String(cfg.winnerText);
    var grp = new E.TaskGroup('gem-' + imageToMove);
    var isCollected = false;

    function animateGem() {
      var startPos = E.getAnchoredPos(imageToMove);
      var target = centreAnchoredPos(imageToMove, targetObject);
      grp.tween(duration, hEase, function (t) {
        var cur = E.getAnchoredPos(imageToMove);
        E.setAnchoredPos(imageToMove,
          startPos[0] + (target[0] - startPos[0]) * t, cur[1]);
      });
      grp.tween(duration / 2, upEase, function (t) {
        var cur = E.getAnchoredPos(imageToMove);
        E.setAnchoredPos(imageToMove, cur[0], startPos[1] + jumpHeight * t);
      }, function () {
        var apex = startPos[1] + jumpHeight;
        grp.tween(duration / 2, downEase, function (t) {
          var cur = E.getAnchoredPos(imageToMove);
          E.setAnchoredPos(imageToMove, cur[0], apex + (target[1] - apex) * t);
        }, updateBagImage);
      });
    }

    function updateBagImage() {
      if (targetImage && targetSprite) E.setSprite(targetImage, targetSprite);
      E.setActive(imageToMove, false);
      if (messageText) E.setText(messageText, winnerText);
      Game.tutorial.incrementGemIndex();
      Game.tutorial.callSetButtonSetWhenActive();
      Game.tutorial.playaudio(18);
    }

    function collectGem() {
      if (isCollected || !imageToMove || !targetObject || !targetImage ||
        !targetSprite) return;
      isCollected = true;
      grp.tween(scaleDuration, 'outBack', function (t) {
        E.setScale(imageToMove, 1 + (scaleUp.x - 1) * t);
      }, function () {
        grp.delayedCall(0.2, function () {
          grp.tween(scaleDuration, 'inBack', function (t) {
            E.setScale(imageToMove, scaleUp.x + (1 - scaleUp.x) * t);
          });
          animateGem();
        });
      });
    }

    return {
      start: function () {
        // Awake(): tutorial.playaudio(18) -- runs on first activation
        Game.tutorial.playaudio(18);
        grp.reset();
        grp.delayedCall(delay, collectGem);
      },
      onDisable: function () { grp.cancel(); }
    };
  }

  // ================================================================ GemMover
  function GemMover(cfg) {
    var id = go(cfg.__host);
    var moveDuration = cfg.moveDuration != null ? cfg.moveDuration : 1;
    var grp = new E.TaskGroup('gemmover');
    return {
      start: function () {
        grp.reset();
        E.setScale(id, 1);
        // LeanTween.move to world (0,0,0) == the canvas centre
        var start = E.getAnchoredPos(id);
        var rec = E.get(id);
        var pw = rec && rec.parent ? rec.parent.w : E.stageSize()[0];
        var ph = rec && rec.parent ? rec.parent.h : E.stageSize()[1];
        var d = rec.data;
        var target = [
          pw / 2 - rec.w / 2 - d.anchorMin[0] * pw + d.sizeDelta[0] * d.pivot[0],
          ph / 2 - rec.h / 2 - d.anchorMin[1] * ph + d.sizeDelta[1] * d.pivot[1]
        ];
        grp.tween(moveDuration, 'inOutQuad', function (t) {
          E.setAnchoredPos(id, start[0] + (target[0] - start[0]) * t,
            start[1] + (target[1] - start[1]) * t);
        });
        grp.tween(moveDuration, 'inOutQuad', function (t) {
          E.setScale(id, 1 + 2 * t);           // 1 -> 3
        }, function () {                        // PopOverAndSettle
          grp.tween(0.2, 'outBack', function (t) {
            E.setScale(id, 3 + 0.5 * t);       // 3 -> 3.5
          }, function () {
            grp.tween(0.15, 'inOutSine', function (t) {
              E.setScale(id, 3.5 - 0.5 * t);   // 3.5 -> 3
            });
          });
        });
      },
      onDisable: function () { grp.cancel(); }
    };
  }

  // ============================================================= CameraShake
  function CameraShake(cfg) {
    var box = go(cfg.rightSideBox);
    var imgId = go(cfg.rightSideBoxImage);
    var scaleDownSize = cfg.scaleDownSize != null ? cfg.scaleDownSize : 0.8;
    var scaleDuration = cfg.scaleDuration != null ? cfg.scaleDuration : 0.1;
    var rotateAngle = cfg.rotateAngle != null ? cfg.rotateAngle : 5;
    var rotateDuration = cfg.rotateDuration != null ? cfg.rotateDuration : 0.1;
    var shakeLoops = cfg.shakeLoops != null ? cfg.shakeLoops : 2;
    var lightRed = Array.isArray(cfg.lightRed) ? cfg.lightRed : [1, .5, .5, 1];
    var colorDur = cfg.colorChangeDuration != null ? cfg.colorChangeDuration : 0.1;
    var white = [1, 1, 1, 1];
    var grp = new E.TaskGroup('cshake');

    function lerp(a, b, t) {
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
    return {
      onClickShakeBox: function () {
        grp.reset();
        E.setScale(box, 1);
        E.setRotZ(box, 0);
        grp.run(function* () {
          yield grp.tween(scaleDuration, 'linear', function (t) {
            E.setScale(box, 1 + (scaleDownSize - 1) * t);
          });
          for (var i = 0; i < shakeLoops; i++) {
            grp.tween(rotateDuration, 'linear', function (t) {
              E.setRotZ(box, -rotateAngle * t);
            });
            yield grp.tween(colorDur, 'linear', function (t) {
              E.setImageColor(imgId, lerp(white, lightRed, t));
            });
            grp.tween(rotateDuration, 'linear', function (t) {
              E.setRotZ(box, -rotateAngle + 2 * rotateAngle * t);
            });
            yield grp.tween(colorDur, 'linear', function (t) {
              E.setImageColor(imgId, lerp(lightRed, white, t));
            });
          }
          grp.tween(rotateDuration, 'linear', function (t) {
            E.setRotZ(box, rotateAngle * (1 - t));
          });
          yield grp.tween(scaleDuration, 'linear', function (t) {
            E.setScale(box, scaleDownSize + (1 - scaleDownSize) * t);
          });
          E.setImageColor(imgId, white);
        });
      }
    };
  }

  // ========================================================= TypewriterEffect
  // LBD-1 variant types on Start(), not OnEnable().
  function TypewriterEffect(cfg) {
    var textId = go(cfg.chatText);
    var full = cfg.fullMessage == null ? '' : String(cfg.fullMessage);
    var speed = cfg.typingSpeed != null ? cfg.typingSpeed : 0.05;
    var grp = new E.TaskGroup('tw-' + textId);
    return {
      start: function () {
        grp.reset();
        E.setText(textId, '');
        grp.run(function* () {
          var acc = '';
          for (var i = 0; i < full.length; i++) {
            acc += full[i];
            E.setText(textId, acc);
            yield speed;
          }
        });
      },
      onDisable: function () { grp.cancel(); }
    };
  }

  // ======================================================= SplashScreenLoader
  function SplashScreenLoader(cfg, onLoadScene) {
    var animId = go(cfg.objectToAnimate);
    var fadeId = go(cfg.fadePanel);
    var maxScale = cfg.maxScale != null ? cfg.maxScale : 1.2;
    var scaleDuration = cfg.scaleDuration != null ? cfg.scaleDuration : 1;
    var fadeDuration = cfg.fadeDuration != null ? cfg.fadeDuration : 0.5;
    var clickSound = audioPath(cfg.buttonClickSound);
    var clickVol = cfg.clickSoundVolume != null ? cfg.clickSoundVolume : 1;
    var grp = new E.TaskGroup('splash');
    var loading = false;
    if (fadeId) { E.setAlpha(fadeId, 0); E.setActive(fadeId, false); }
    function pingPong() {
      grp.tween(scaleDuration, 'inOutSine', function (t) {
        E.setScale(animId, 1 + (maxScale - 1) * t);
      }, function () {
        grp.tween(scaleDuration, 'inOutSine', function (t) {
          E.setScale(animId, maxScale - (maxScale - 1) * t);
        }, pingPong);
      });
    }
    if (animId) pingPong();
    return {
      hostId: go(cfg.__host),
      loadNextScene: function () {
        if (loading) return;
        loading = true;
        if (clickSound) E.playOneShot(clickSound, clickVol);
        if (fadeId) {
          E.setActive(fadeId, true);
          grp.tween(fadeDuration, 'linear', function (t) {
            E.setAlpha(fadeId, t);
          }, function () { grp.cancel(); onLoadScene(); });
        } else {
          grp.delayedCall(0.3, function () { grp.cancel(); onLoadScene(); });
        }
      }
    };
  }

  // ======================================================= event dispatcher
  function invokeEvent(call) {
    var t = Game.tutorial;
    switch (call.method) {
      case 'ValidateClick': {
        var b = Game.buttonByComp[String(call.target)];
        return b && b.validateClick();
      }
      case 'playaudio': return t && t.playaudio((call.args || {}).int);
      case 'ShowNextIfNotTyping': return t && t.showNextIfNotTyping();
      case 'incrementGemIndex': return t && t.incrementGemIndex();
      case 'DisableButtonsIntractable': return t && t.disableButtonsIntractable();
      case 'CallSetButtonSetWhenActive':
        return t && t.callSetButtonSetWhenActive();
      case 'OnClickShakeBox':
        return Game.cameraShake && Game.cameraShake.onClickShakeBox();
      case 'LoadNextScene': return Game.splash && Game.splash.loadNextScene();
      case 'SetActive': {
        var h = go(call.target);
        return h && E.setActive(h, !!(call.args || {}).bool);
      }
      case 'Play': {
        var p = go(call.target);
        return p && E.playParticles(p);
      }
      default:
        if (console && console.warn) {
          console.warn('unmapped UnityEvent method: ' + call.method);
        }
    }
  }

  return {
    TutorialDialogue: TutorialDialogue,
    TutorialClickableButton: TutorialClickableButton,
    GemCollectEffect: GemCollectEffect, GemMover: GemMover,
    CameraShake: CameraShake, TypewriterEffect: TypewriterEffect,
    SplashScreenLoader: SplashScreenLoader,
    invokeEvent: invokeEvent, go: go, script: script, scriptsOf: scriptsOf,
    liveScript: liveScript, srcByComp: srcByComp,
    tutorial: null, cameraShake: null, splash: null,
    buttonByComp: Object.create(null)
  };
})();
