/* Idle screensaver: Apple's tvOS Aerial flyovers, streamed from Apple's CDN or played from
   the local cache kept by the com.gathin.tvhome.aerials service. Starts after idleSeconds
   without remote input while the launcher is in the foreground. Any key or pointer movement
   ends it, and that input is swallowed so the launcher does not also act on it. One <video>
   at a time with a fade through black between clips: the TV has a single 4K decoder. */
(function () {
  'use strict';
  var PREF_KEY = (window.SCREENSAVER && SCREENSAVER.prefKey) || 'tvhome.screensaver';
  var SERVICE = (window.SCREENSAVER && SCREENSAVER.service) || 'luna://com.gathin.tvhome.aerials/';
  var defaults = {idleSeconds: 180, quality: ['4K-SDR', '1080-SDR', '1080-H264'], categories: null, label: true, clock: true, hudSeconds: 8, cache: {count: 0, only: false}};
  var cfg = {};
  function merge(into, from) { for (var k in from) if (Object.prototype.hasOwnProperty.call(from, k)) into[k] = from[k]; return into; }
  function loadPrefs() {
    merge(cfg, defaults); merge(cfg, window.SCREENSAVER || {});
    cfg.cache = merge({}, cfg.cache);
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(PREF_KEY)); } catch (e) { stored = null; }
    if (stored && typeof stored === 'object') { var c = cfg.cache; merge(cfg, stored); cfg.cache = merge(c, stored.cache || {}); }
  }
  function savePrefs() {
    var out = {idleSeconds: cfg.idleSeconds, quality: cfg.quality, categories: cfg.categories, cache: cfg.cache, cacheOrder: cfg.cacheOrder || null, everywhere: cfg.everywhere};
    try { localStorage.setItem(PREF_KEY, JSON.stringify(out)); } catch (e) {}
  }
  loadPrefs();
  if (!window.AERIALS || !AERIALS.assets) return;

  var all = AERIALS.assets, assets = [];
  function refilter() { assets = all.filter(function (a) { return !cfg.categories || cfg.categories.indexOf(a.cat) >= 0; }); }
  refilter();

  var root = document.getElementById('screensaver'),
    zh = root.querySelector('.ssZh'), en = root.querySelector('.ssEn'), clock = root.querySelector('.ssClock'),
    video = null, active = false, queue = [], current = null, candidateIndex = 0,
    idleTimer = null, hudTimer = null, clockTimer = null, stallTimer = null;

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---- local cache (service) ---------------------------------------------------------- */
  var cache = {files: [], downloading: null, free: null, error: null, available: typeof PalmServiceBridge === 'function'}, bridge = null;
  function cachedFile(asset, quality) {
    for (var i = 0; i < cache.files.length; i++) { var f = cache.files[i]; if (f.complete && f.id === asset.id && f.quality === quality) return f; }
    return null;
  }
  function preferredQuality(asset) { for (var i = 0; i < cfg.quality.length; i++) if (asset.u[cfg.quality[i]]) return cfg.quality[i]; return null; }
  // A fixed shuffled order, so the cached set stays put while settings do not change.
  function wantedList() {
    if (!(cfg.cache.count > 0)) return [];
    if (!cfg.cacheOrder) { cfg.cacheOrder = shuffle(all).map(function (a) { return a.id; }); savePrefs(); }
    var byId = {}; assets.forEach(function (a) { byId[a.id] = a; });
    var out = [];
    for (var i = 0; i < cfg.cacheOrder.length && out.length < cfg.cache.count; i++) {
      var a = byId[cfg.cacheOrder[i]]; if (!a) continue;
      var q = preferredQuality(a); if (q) out.push({id: a.id, quality: q, url: AERIALS.base + a.u[q], name: a.zh || a.name});
    }
    return out;
  }
  function wantedCount() { return wantedList().length; }
  function applyStatus(r) {
    if (!r || r.returnValue !== true) { cache.error = (r && r.errorText) || 'service'; emit(); return; }
    cache.files = r.files || []; cache.downloading = r.downloading || null; cache.free = r.free; cache.error = r.error || null; emit();
  }
  function emit() { try { window.dispatchEvent(new CustomEvent('screensaver-cache')); } catch (e) {} }
  function closeBridge() { if (bridge) { try { bridge.cancel(); } catch (e) {} bridge = null; } }
  function syncCache() {
    if (!cache.available || document.hidden) return;
    closeBridge();
    try {
      bridge = new PalmServiceBridge();
      bridge.onservicecallback = function (raw) { var r; try { r = JSON.parse(raw); } catch (e) { r = null; } applyStatus(r); };
      bridge.call(SERVICE + 'sync', JSON.stringify({wanted: wantedList().map(function (w) { return {id: w.id, quality: w.quality, url: w.url}; }), subscribe: true}));
    } catch (e) { cache.available = false; emit(); }
  }
  function clearCache(cb) {
    if (!cache.available) { if (cb) cb(); return; }
    closeBridge();
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (raw) { var r; try { r = JSON.parse(raw); } catch (e) { r = null; } applyStatus(r); try { b.cancel(); } catch (e) {} if (cb) cb(); };
      b.call(SERVICE + 'clear', '{}');
    } catch (e) { if (cb) cb(); }
  }

  /* ---- playback ----------------------------------------------------------------------- */
  // Local copies first, in quality order, then the network variants in quality order.
  function candidates(asset) {
    var out = [], i, q;
    for (i = 0; i < cfg.quality.length; i++) { q = cfg.quality[i]; var f = cachedFile(asset, q); if (f) out.push({url: 'file://' + f.path, quality: q, local: true}); }
    for (i = 0; i < cfg.quality.length; i++) { q = cfg.quality[i]; if (asset.u[q]) out.push({url: AERIALS.base + asset.u[q], quality: q, local: false}); }
    return out;
  }
  function pool() {
    if (cfg.cache.only && cfg.cache.count > 0) {
      var local = assets.filter(function (a) { return candidates(a).some(function (c) { return c.local; }); });
      if (local.length) return local;
    }
    return assets;
  }
  function nextAsset() { if (!queue.length) queue = shuffle(pool()); return queue.pop(); }
  function play(asset, from) {
    var list = candidates(asset);
    if (!asset || from >= list.length) { playNext(); return; }
    current = asset; candidateIndex = from;
    armStall();
    video.src = list[from].url;
    var p = video.play(); if (p && p.catch) p.catch(function () {});
  }
  function playNext() {
    if (!active) return;
    video.classList.remove('shown');
    setTimeout(function () { if (active) play(nextAsset(), 0); }, 700);
  }
  // A clip that never starts (CDN hiccup, unsupported profile) must not freeze the screen.
  function armStall() { clearTimeout(stallTimer); stallTimer = setTimeout(function () { if (active) onError(); }, 25000); }
  function onError() { if (!active || !current) return; play(current, candidateIndex + 1); }
  function onPlaying() { clearTimeout(stallTimer); video.classList.add('shown'); showHud(); }
  function showHud() {
    if (cfg.label) { zh.textContent = current.zh || current.name; en.textContent = current.zh ? current.name : ''; }
    if (cfg.clock) tick();
    root.classList.add('hud');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () { root.classList.remove('hud'); }, cfg.hudSeconds * 1000);
  }
  function tick() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    clock.textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  var pointer = {x: 0, y: 0}, startPointer = null, startedAt = 0, lastStop = '', exitHandlers = [];
  function start() {
    if (active || document.hidden || !assets.length) return;
    active = true;
    startedAt = Date.now(); startPointer = pointer;
    video = document.createElement('video');
    video.muted = true; video.preload = 'auto'; video.setAttribute('playsinline', '');
    video.addEventListener('playing', onPlaying);
    video.addEventListener('ended', playNext);
    video.addEventListener('error', onError);
    video.addEventListener('waiting', armStall);
    root.insertBefore(video, root.firstChild);
    root.classList.add('on');
    document.body.classList.add('screensaver');
    queue = shuffle(pool());
    play(nextAsset(), 0);
    if (cfg.clock) clockTimer = setInterval(tick, 10000);
  }
  function stop() {
    if (!active) return;
    active = false;
    clearTimeout(hudTimer); clearTimeout(stallTimer); clearInterval(clockTimer);
    root.classList.remove('on', 'hud');
    document.body.classList.remove('screensaver');
    if (video) {
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {}
      video.remove(); video = null;
    }
    current = null;
  }

  /* ---- idle detection ----------------------------------------------------------------- */
  function arm() { clearTimeout(idleTimer); if (!document.hidden && cfg.idleSeconds > 0) idleTimer = setTimeout(start, cfg.idleSeconds * 1000); }
  // The Magic Remote pointer can report a stray move without anyone touching it, so a
  // mouse move only counts once it has travelled a little from where the saver began.
  function onInput(e) {
    if (e.type === 'mousemove') {
      pointer = {x: e.clientX, y: e.clientY};
      if (active && (!startPointer || Math.hypot(e.clientX - startPointer.x, e.clientY - startPointer.y) < 24)) return;
    }
    if (active) {
      if (Date.now() - startedAt < 400 && e.type !== 'keydown') return;
      lastStop = e.type;
      stop();
      if (e.type === 'keydown' || e.type === 'keyup') { e.preventDefault(); e.stopImmediatePropagation(); }
      // A host (the standalone app) decides what the exiting key means: quit, open settings…
      exitHandlers.forEach(function (fn) { try { fn(e); } catch (err) {} });
    }
    arm();
  }
  ['keydown', 'keyup', 'mousemove', 'mousedown', 'click', 'wheel'].forEach(function (t) { window.addEventListener(t, onInput, true); });

  /* ---- LG system screensaver ---------------------------------------------------------- */
  // webOS starts its own screensaver after about two minutes without input, ahead of our idle
  // timer, and draws it over every app. tvpower asks subscribers first: answering ack:false
  // holds it off. While this page is visible and the Aerials are enabled, start ours right
  // away and decline. While another app is in front (a paused video, a menu), hand the screen
  // to the standalone Aerials app in screensaver mode, which closes on the first key and
  // leaves that app where it was. If that app is missing, let LG's run.
  var POWER = 'luna://com.webos.service.tvpower/power/';
  var clientName = (window.SCREENSAVER && SCREENSAVER.clientName) || (window.PalmSystem && PalmSystem.identifier && String(PalmSystem.identifier).split(' ')[0]) || 'aerials';
  function respondSaver(ack, timestamp) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function () { try { b.cancel(); } catch (e) {} };
      b.call(POWER + 'responseScreenSaverRequest', JSON.stringify({clientName: clientName, ack: ack, timestamp: timestamp}));
    } catch (e) {}
  }
  if (typeof PalmServiceBridge === 'function' && !(window.SCREENSAVER && SCREENSAVER.allowSystemSaver)) {
    try {
      var saverBridge = new PalmServiceBridge();
      saverBridge.onservicecallback = function (raw) {
        var r; try { r = JSON.parse(raw); } catch (e) { return; }
        if (!r || r.timestamp === undefined) return;
        // standalone: the Aerials app itself, which always wants the screen while visible.
        var ours = !document.hidden && assets.length > 0 && (cfg.idleSeconds !== 0 || !!cfg.standalone);
        if (ours) { if (!active) start(); respondSaver(false, r.timestamp); return; }
        if (!document.hidden || cfg.standalone || cfg.idleSeconds === 0 || cfg.everywhere === false) { respondSaver(true, r.timestamp); return; }
        var ts = r.timestamp, me = clientName, aerialsApp = cfg.everywhereApp || 'com.lfkdsk.aerials';
        // returnTo: the app the viewer was in (from the Aerials service); home: where to go if unknown.
        function handOff(returnTo) {
          var launch = new PalmServiceBridge();
          launch.onservicecallback = function (raw2) {
            var ok = false; try { ok = JSON.parse(raw2).returnValue === true; } catch (e) {}
            try { launch.cancel(); } catch (e) {}
            respondSaver(!ok, ts);
          };
          launch.call('luna://com.webos.applicationManager/launch', JSON.stringify({id: aerialsApp, params: {screensaver: true, returnTo: returnTo, home: me}}));
        }
        var asked = false, ask = new PalmServiceBridge();
        ask.onservicecallback = function (raw3) {
          if (asked) return; asked = true;
          var f = null; try { f = JSON.parse(raw3); } catch (e) {}
          try { ask.cancel(); } catch (e) {}
          handOff(f && typeof f.appId === 'string' ? f.appId : null);
        };
        ask.call(SERVICE + 'foreground', JSON.stringify({skip: [me, aerialsApp]}));
        setTimeout(function () { if (!asked) { asked = true; handOff(null); } }, 1500);
      };
      saverBridge.call(POWER + 'registerScreenSaverRequest', JSON.stringify({subscribe: true, clientName: clientName}));
      window.__systemSaverBridge = saverBridge;
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stop(); clearTimeout(idleTimer); closeBridge(); } else { arm(); syncCache(); }
  });
  document.addEventListener('webOSRelaunch', function () { stop(); arm(); });
  arm();
  syncCache();

  window.Screensaver = {
    start: start, stop: stop,
    isActive: function () { return active; }, lastStop: function () { return lastStop; },
    prefs: function () { return JSON.parse(JSON.stringify(cfg)); },
    // Settings panel: saves, then re-applies idle timer, category filter and cache target.
    update: function (partial) {
      var categoriesChanged = partial.categories !== undefined && JSON.stringify(partial.categories) !== JSON.stringify(cfg.categories);
      var c = cfg.cache; merge(cfg, partial); cfg.cache = merge(c, partial.cache || {});
      if (categoriesChanged) cfg.cacheOrder = null;
      savePrefs(); refilter(); queue = []; arm(); syncCache();
    },
    cache: function () { return {files: cache.files, downloading: cache.downloading, free: cache.free, error: cache.error, available: cache.available, wanted: wantedList()}; },
    clearCache: clearCache, syncCache: syncCache,
    onExit: function (fn) { exitHandlers.push(fn); },
    assetName: function (id) { for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i].zh || all[i].name; return id; }
  };
})();
