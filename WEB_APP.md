# 上科大失物招领 Web/PWA 版本

这个目录新增了一个独立的网页端应用：`web/`。它不依赖微信小程序审核，可以直接部署成网页，并支持从手机浏览器安装到桌面。

## 本地运行

```bash
cd web
npm install
npm run dev
```

打开终端输出的本地地址，例如：

```text
http://localhost:5174
```

## 生产构建

```bash
cd web
npm run build
```

构建产物会生成在 `web/dist/`，可以部署到静态网站服务，例如 Vercel、Netlify、GitHub Pages、腾讯云静态网站托管或任意 Nginx。

## 手机浏览器安装

部署到 HTTPS 域名后，用手机浏览器打开网页：

- Android Chrome/Edge：点击页面右上角“安装”，或浏览器菜单里的“安装应用/添加到主屏幕”。
- iPhone Safari：点击分享按钮，然后选择“添加到主屏幕”。

这种方式是 PWA，不需要应用商店审核，适合先给同学扫码或浏览器访问使用。

## 后续打包成手机 App

如果后续确实需要 APK，可以继续基于 `web/` 做两条路线：

- Capacitor：把同一套 React 页面包装成 Android 项目，生成 APK。
- TWA：如果 PWA 已经部署到 HTTPS 域名，可以用 Trusted Web Activity 生成更轻的 Android 包。

当前版本已经具备 PWA 必需文件：

- `web/public/manifest.webmanifest`
- `web/public/sw.js`
- `web/public/icon.svg`

## 当前网页功能

- 失物招领、寻物、已找回三类列表
- 分类与关键词筛选
- 校园地图标记
- 发布招领/寻物
- 本地自动分类与相似匹配
- 详情页、标记已找回
- 我的发布与浏览器安装入口

当前数据保存在浏览器 `localStorage`。正式上线时可以继续接现有云函数或自建 API，把 `web/src/store.js` 替换为真实接口调用。
