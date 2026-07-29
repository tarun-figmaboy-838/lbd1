/* main.js -- LBD-1 boot + scene flow (Main.unity -> LBD1.unity) */
'use strict';

(function () {
  var E = Engine, C = window.CONFIG;
  var splashRoots = window.SPLASH_LAYOUT, playRoots = window.LAYOUT;

  // Both are optional add-ons: the veil hides the progressive first paint and
  // caches VO durations, the guard nags portrait phones. Removing either
  // <script> tag restores the previous behaviour exactly.
  if (typeof Preloader !== 'undefined') Preloader.hold();
  if (typeof Orientation !== 'undefined') Orientation.init();
  E.boot(splashRoots.concat(playRoots), C);
  if (typeof Hint !== 'undefined') Hint.init();
  // Must follow boot(): it measures painted buttons, and it re-measures itself on
  // every resize and activation change.
  if (typeof TouchTargets !== 'undefined') TouchTargets.init(E);

  var playRootState = playRoots.map(function (r) {
    return { id: String(r.id), active: !!r.active };
  });
  playRootState.forEach(function (s) { E.setActive(s.id, false); });

  function bindButtons(roots) {
    (roots || []).forEach(function walk(n) {
      (n.components || []).forEach(function (c) {
        if (c.kind !== 'Button') return;
        var calls = (c.onClick || []).filter(function (cl) { return cl.callState !== 0; });
        if (!calls.length) return;
        E.onClick(String(n.id), function () {
          for (var i = 0; i < calls.length; i++) Game.invokeEvent(calls[i]);
        });
      });
      (n.children || []).forEach(walk);
    });
  }

  function playAwakeAudio(roots) {
    (roots || []).forEach(function walk(n) {
      (n.components || []).forEach(function (c) {
        if (c.kind !== 'AudioSource') return;
        var s = Game.srcByComp[String(c.id)];
        if (s && s.playOnAwake && s.clip && E.isActiveInHierarchy(String(n.id))) {
          E.play(s.channel, s.clip, { volume: s.vol, loop: s.loop });
        }
      });
      (n.children || []).forEach(walk);
    });
  }

  // The splash appears as soon as its own art is decoded; the gameplay payload
  // finishes behind it. Gate the hand-off so the scene is never entered
  // half-loaded -- in practice it is ready long before the child taps.
  function enterGameplay() {
    if (typeof Preloader !== 'undefined' && Preloader.gate) Preloader.gate(loadGameplay);
    else loadGameplay();
  }

  var splashCfg = Game.script('SplashScreenLoader', C.splashScripts);
  if (splashCfg) {
    Game.splash = Game.SplashScreenLoader(splashCfg, enterGameplay);
    E.onClick(Game.splash.hostId, function () {
      E.unlockAudio(); Game.splash.loadNextScene();
    });
  }
  bindButtons(splashRoots);

  var loaded = false;
  function loadGameplay() {
    if (loaded) return;
    loaded = true;
    splashRoots.forEach(function (r) { E.setActive(String(r.id), false); });
    playRootState.forEach(function (s) { E.setActive(s.id, s.active); });
    E.relayout();

    // only the copy active in the hierarchy runs -- the one parented to the
    // inactive /GameObject root has empty randomMessages and 19 clips and is
    // dead in Unity, so it must stay dead here too.
    var tdCfg = Game.liveScript('TutorialDialogue');
    Game.tutorial = new Game.TutorialDialogue(tdCfg);

    var csCfg = Game.script('CameraShake');
    if (csCfg) Game.cameraShake = Game.CameraShake(csCfg);

    Game.scriptsOf('TutorialClickableButton').forEach(function (cfg) {
      var b = new Game.TutorialClickableButton(cfg);
      Game.buttonByComp[String(cfg.__id)] = b;
    });

    Game.scriptsOf('GemCollectEffect').forEach(function (cfg) {
      E.register(Game.go(cfg.__host), Game.GemCollectEffect(cfg));
    });
    Game.scriptsOf('GemMover').forEach(function (cfg) {
      E.register(Game.go(cfg.__host), Game.GemMover(cfg));
    });
    Game.scriptsOf('TypewriterEffect').forEach(function (cfg) {
      E.register(Game.go(cfg.__host), Game.TypewriterEffect(cfg));
    });

    E.register(Game.go(tdCfg.__host), { start: Game.tutorial.start });

    bindButtons(playRoots);
    playAwakeAudio(playRoots);
    E.awakeAll();
    E.tickControllers();
    E.onActivated(function () { E.tickControllers(); });
  }

  window.__game = {
    engine: E, game: Game, loadGameplay: loadGameplay,
    isLoaded: function () { return loaded; },
    analytics: Analytics,
    state: function () {
      var t = Game.tutorial;
      return t ? {
        tutorialIndex: t.tutorialIndex, messageIndex: t.messageIndex,
        gems: t.currentCollectedGemsIndex, attempt: t.Attemptnumber,
        typing: t.isTyping, text: E.getText(t.dialogueText)
      } : null;
    }
  };
  // God Mode drives the game through this handle; see god-mode/README.md.
  window.lbd1Game = window.__game;
})();
