/* Settings panel for the Aerial screensaver: idle time, quality, categories, local cache.
   Opened from Home settings; up/down moves between rows, left/right or OK changes a value,
   Back closes. Shares the Home settings card styling. */
(function () {
  'use strict';
  if (!window.Screensaver) return;
  var IDLE = [[0, '关闭'], [60, '1 分钟'], [180, '3 分钟'], [300, '5 分钟'], [600, '10 分钟'], [1800, '30 分钟']];
  var QUALITY = [
    ['hdr', '4K HDR', ['4K-HDR', '4K-SDR', '1080-SDR', '1080-H264'], 0.7],
    ['4k', '4K', ['4K-SDR', '1080-SDR', '1080-H264'], 0.35],
    ['1080', '1080p', ['1080-SDR', '1080-H264'], 0.17]
  ];
  var CATS = [['landscape', '风景'], ['city', '城市'], ['space', '太空'], ['underwater', '水下']];
  var COUNT = [0, 5, 10, 20];

  var panel = document.createElement('section');
  panel.id = 'saverPanel'; panel.className = 'hidden'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '航拍屏保');
  panel.innerHTML = '<div class="renewal-card"><div class="renewal-heading"><h2>航拍屏保</h2></div>' +
    '<p>' + ((window.SCREENSAVER && SCREENSAVER.intro) || '启动器空闲一段时间后播放 Apple TV 的 4K 航拍。视频默认从 Apple 服务器流式播放，也可以缓存一部分到电视本地。') + '</p>' +
    '<div id="saverRows"></div>' +
    '<div id="saverCache" aria-live="polite"></div>' +
    '<div class="renewal-actions"><button id="saverPreview">立即预览</button><button id="saverClear">清空缓存</button><button id="saverClose">返回</button></div></div>';
  document.body.appendChild(panel);
  var rowsEl = document.getElementById('saverRows'), cacheEl = document.getElementById('saverCache');

  function qualityKey(p) { for (var i = 0; i < QUALITY.length; i++) if (QUALITY[i][2][0] === p.quality[0]) return i; return 1; }
  function cats(p) { return p.categories || CATS.map(function (c) { return c[0]; }); }
  function fmtGB(bytes) { return (bytes / 1073741824).toFixed(1) + ' GB'; }

  // Each row: label, current value text, and what left/right does.
  function rows() {
    var p = Screensaver.prefs(), q = qualityKey(p), on = cats(p);
    var list = [];
    if (!(window.SCREENSAVER && SCREENSAVER.hideIdle)) list.push(
      {label: '等待时间', value: (IDLE.filter(function (o) { return o[0] === p.idleSeconds; })[0] || IDLE[2])[1],
        step: function (d) { var i = 0; IDLE.forEach(function (o, k) { if (o[0] === p.idleSeconds) i = k; }); Screensaver.update({idleSeconds: IDLE[(i + d + IDLE.length) % IDLE.length][0]}); }});
    list.push({label: '画质', value: QUALITY[q][1],
        step: function (d) { Screensaver.update({quality: QUALITY[(q + d + QUALITY.length) % QUALITY.length][2]}); }});
    CATS.forEach(function (c) {
      list.push({label: c[1], value: on.indexOf(c[0]) >= 0 ? '开' : '关', step: function () {
        var next = on.indexOf(c[0]) >= 0 ? on.filter(function (x) { return x !== c[0]; }) : on.concat([c[0]]);
        if (!next.length) { toast('至少保留一个类别'); return; }
        Screensaver.update({categories: next.length === CATS.length ? null : next});
      }});
    });
    if (!(window.SCREENSAVER && SCREENSAVER.standalone)) list.push({label: '在其他 App 里也用航拍', value: p.everywhere === false ? '关' : '开',
      step: function () { Screensaver.update({everywhere: p.everywhere === false}); }});
    var per = QUALITY[q][3], n = p.cache.count;
    list.push({label: '本地缓存', value: n ? n + ' 段（约 ' + (n * per).toFixed(1) + ' GB）' : '关闭',
      step: function (d) { var i = Math.max(0, COUNT.indexOf(n)); Screensaver.update({cache: {count: COUNT[(i + d + COUNT.length) % COUNT.length]}}); }});
    list.push({label: '只播本地缓存', value: p.cache.only ? '开' : '关', disabled: !n,
      step: function () { Screensaver.update({cache: {only: !p.cache.only}}); }});
    return list;
  }
  function toast(t) { var o = document.getElementById('toast'); o.textContent = t; o.classList.add('shown'); setTimeout(function () { o.classList.remove('shown'); }, 2200); }

  var buttons = [], index = 0, model = [];
  function render() {
    model = rows();
    rowsEl.innerHTML = '';
    model.forEach(function (r) {
      var b = document.createElement('button'); b.className = 'saver-row'; b.disabled = !!r.disabled;
      b.innerHTML = '<span class="saver-label"></span><span class="saver-value"></span>';
      b.firstChild.textContent = r.label; b.lastChild.textContent = r.value;
      rowsEl.appendChild(b);
    });
    buttons = Array.prototype.slice.call(panel.querySelectorAll('button'));
    buttons.forEach(function (b, i) { b.onmouseover = function () { focus(i); }; });
    rowsEl.querySelectorAll('button').forEach(function (b, i) { b.onclick = function () { model[i].step(1); render(); }; });
    renderCache();
    if (openNow()) focus(index);
  }
  function renderCache() {
    var c = Screensaver.cache(), p = Screensaver.prefs(), text = '';
    if (!p.cache.count) text = '不缓存，每次从 Apple 服务器播放。';
    else if (!c.available) text = '缓存服务不可用（需要完整安装的 Home 包）。';
    else {
      var done = 0; c.wanted.forEach(function (w) { if (c.files.some(function (f) { return f.complete && f.id === w.id && f.quality === w.quality; })) done++; });
      text = '已缓存 ' + done + ' / ' + c.wanted.length + ' 段';
      if (c.downloading) { var d = c.downloading, pct = d.total ? Math.round(d.received / d.total * 100) + '%' : fmtGB(d.received); text += ' · 正在下载「' + Screensaver.assetName(d.id) + '」' + pct; }
      if (typeof c.free === 'number') text += ' · 电视剩余空间 ' + fmtGB(c.free);
      if (c.error === 'disk-full') text += '\n空间不足，已暂停下载。';
      else if (c.error) text += '\n上次下载失败：' + c.error + '，稍后自动重试。';
      text += '\n下载只在启动器显示在屏幕上时进行；重新安装 Home 会清空缓存。';
    }
    cacheEl.textContent = text;
    document.getElementById('saverClear').disabled = !(c.files && c.files.length);
  }
  window.addEventListener('screensaver-cache', function () { if (openNow()) renderCache(); });

  function openNow() { return !panel.classList.contains('hidden'); }
  function focus(i) {
    var direction = i < index ? -1 : 1;
    for (var n = 0; n < buttons.length; n++, i += direction) { var j = (i + buttons.length * 2) % buttons.length; if (!buttons[j].disabled) { index = j; buttons[index].focus(); return; } }
  }
  function close() { panel.classList.add('hidden'); try { window.dispatchEvent(new CustomEvent('saverpanel-close')); } catch (e) {} }
  document.getElementById('saverClose').onclick = close;
  document.getElementById('saverPreview').onclick = function () { close(); setTimeout(Screensaver.start, 300); };
  document.getElementById('saverClear').onclick = function () { Screensaver.clearCache(function () { Screensaver.update({cache: {count: 0}}); render(); toast('已清空本地缓存'); }); };

  document.addEventListener('keydown', function (e) {
    if (!openNow()) return;
    var k = e.keyCode;
    if ([37, 38, 39, 40, 13, 461, 27].indexOf(k) < 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (k === 461 || k === 27) { close(); return; }
    var row = index < model.length ? model[index] : null;
    if (k === 13) { if (!e.repeat) buttons[index].click(); }
    else if ((k === 37 || k === 39) && row) { row.step(k === 37 ? -1 : 1); render(); }
    else if (k === 37 || k === 39) focus(index + (k === 37 ? -1 : 1));
    else focus(index + (k === 38 ? -1 : 1));
  }, true);

  window.SaverPanel = {isOpen: openNow, open: function () { panel.classList.remove('hidden'); index = 0; render(); Screensaver.syncCache(); focus(0); }};
})();
