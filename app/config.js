// Standalone app: start the flyovers as soon as the app opens (idleSeconds 0 = no idle timer).
// quality is tried in order per clip; categories null = all of landscape/city/space/underwater.
window.SCREENSAVER = {
  service: "luna://com.lfkdsk.aerials.service/",
  prefKey: "aerials.prefs",
  idleSeconds: 0,
  standalone: true,
  hideIdle: true,
  intro: "按 OK 打开这个面板，按返回键退出应用。视频默认从 Apple 服务器流式播放，也可以缓存一部分到电视本地。",
  quality: ["4K-SDR", "1080-SDR", "1080-H264"],
  categories: null,
  label: true,
  clock: true,
  cache: {count: 0, only: false}
};
