/* Standalone app shell around the screensaver module. The flyovers start as soon as the
   app opens. The key that stops them decides what happens next: Back leaves the app,
   OK opens the settings panel, anything else just shows the hint and resumes shortly.

   Screensaver mode (launched with {"screensaver": true}, e.g. by a launcher when the TV goes
   idle inside another app): the first key or pointer movement closes the app, so the viewer
   lands back in that app exactly where it was. */
(function () {
  'use strict';
  if (!window.Screensaver) return;
  var hint = document.getElementById('hint'), resumeTimer = null, saverMode = false;

  function params(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  function setMode(p) { saverMode = !!(p && p.screensaver); document.body.classList.toggle('saver-mode', saverMode); }
  setMode(params(window.PalmSystem && PalmSystem.launchParams));

  function resumeSoon(ms) {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(function () {
      if (document.hidden || (window.SaverPanel && SaverPanel.isOpen())) return;
      hint.classList.remove('shown');
      Screensaver.start();
    }, ms);
  }
  function quit() {
    Screensaver.stop();
    try { if (window.webOS && webOS.platformBack) { webOS.platformBack(); return; } } catch (e) {}
    try { window.close(); } catch (e) {}
  }

  Screensaver.onExit(function (e) {
    if (saverMode) { quit(); return; }
    var k = e.keyCode;
    if (e.type !== 'keydown') { hint.classList.add('shown'); resumeSoon(4000); return; }
    if (k === 461 || k === 27) { quit(); return; }
    if (k === 13) { hint.classList.remove('shown'); SaverPanel.open(); return; }
    hint.classList.add('shown');
    resumeSoon(4000);
  });
  // Keys while the hint is up (saver already stopped): same meanings.
  document.addEventListener('keydown', function (e) {
    if (Screensaver.isActive() || (window.SaverPanel && SaverPanel.isOpen())) return;
    var k = e.keyCode;
    if (saverMode) { e.preventDefault(); quit(); return; }
    if (k === 461 || k === 27) { e.preventDefault(); quit(); }
    else if (k === 13) { e.preventDefault(); clearTimeout(resumeTimer); hint.classList.remove('shown'); SaverPanel.open(); }
    else resumeSoon(1500);
  });
  window.addEventListener('saverpanel-close', function () { resumeSoon(400); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resumeSoon(300); });
  // Relaunched while running: the new params say whether this is a screensaver hand-off.
  document.addEventListener('webOSRelaunch', function (e) {
    setMode(params(e && e.detail));
    if (window.PalmSystem && PalmSystem.activate) PalmSystem.activate();
    hint.classList.remove('shown');
    resumeSoon(saverMode ? 0 : 300);
  });

  resumeSoon(saverMode ? 0 : 200);
})();
