# 嵌入到 Clean Your TV 启动器

`app/screensaver.js`、`app/screensaver-panel.js`、`app/aerials.js` 和 `service/` 不依赖这个独立 App 的其他部分，
可以直接放进 [Clean Your TV](https://github.com/Razdva122/clean-your-tv-lg-webos) 这类自制启动器，
让启动器在前台空闲一段时间后自动播放航拍。

## 1. 复制文件

```text
launcher/aerials.js             ← app/aerials.js
launcher/screensaver.js         ← app/screensaver.js
launcher/screensaver-panel.js   ← app/screensaver-panel.js
aerials-service/                ← service/（见下方的 id 修改）
```

把 `app/style.css` 里 `screensaver`、`settings panel` 两段样式追加到启动器的样式表。
Clean Your TV 已经有 `.renewal-card`、`.renewal-actions` 这组样式，只需要追加 `#saverPanel`、`.saver-row`、`#saverCache` 相关的规则。

## 2. 服务 id

webOS 要求同一个包里的服务 id 以应用 id 为前缀。把 `service/package.json` 和 `service/services.json` 里的
`com.lfkdsk.aerials.service` 改成 `<应用 id>.aerials`，例如 `com.gathin.tvhome.aerials`。
`service.js` 会从服务 id 推导应用 id（去掉末尾的 `.aerials` 或 `.service`），只接受该应用的调用。

打包时把服务目录一起交给 `ares-package`：

```sh
ares-package launcher renewal-service aerials-service -o dist
```

## 3. 页面接入

`index.html` 里加上容器和脚本（放在启动器自己的脚本之后）：

```html
<div id="screensaver">
  <div class="ssLabel"><div class="ssZh"></div><div class="ssEn"></div></div>
  <div class="ssClock"></div>
</div>
…
<script src="aerials.js"></script>
<script src="screensaver.js"></script>
<script src="screensaver-panel.js"></script>
```

页面上需要有一个 `#toast` 元素（Clean Your TV 自带）。

## 4. 配置

在启动器的配置脚本里声明默认值。所有字段都可以被用户在设置面板里改掉，面板的修改存放在 `localStorage` 的 `prefKey` 下：

```js
window.SCREENSAVER = {
  service: "luna://com.gathin.tvhome.aerials/",   // 和第 2 步的服务 id 一致
  idleSeconds: 180,                               // 0 关闭
  quality: ["4K-SDR", "1080-SDR", "1080-H264"],   // 每段按顺序尝试
  categories: null,                               // 或 ["landscape", "city", "space", "underwater"] 的子集
  label: true, clock: true,
  cache: {count: 0, only: false}
};
```

## 5. 打开设置面板

在启动器自己的设置界面里加一个按钮，点击时调用 `window.SaverPanel.open()`。
面板用方向键上下换行、左右改值，返回键关闭；关闭时会派发 `saverpanel-close` 事件。

## 6. 行为

- 空闲计时只在页面可见时进行；页面被切到后台会立即停止播放并关闭服务订阅。
- 结束屏保的那一次按键会被吞掉，不会传给启动器。
- 遥控器指针的轻微抖动不会结束屏保，移动超过 24px 才算。
- 缓存下载只在页面可见时进行；重新安装应用会清空缓存目录（它在服务自己的目录里）。
