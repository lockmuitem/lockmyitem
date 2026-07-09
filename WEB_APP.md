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

## 网页端混元图像识别

网页端必须通过服务端调用混元大模型，不能把混元 API Key 写进浏览器代码。当前前端优先复用小程序同一个云函数：

```bash
VITE_TCB_ENV_ID=cloud1-d9gnyuxf5b44b6b92
VITE_TCB_FUNCTION_NAME=lostfound
VITE_TCB_REGION=ap-shanghai
VITE_TCB_ACCESS_KEY=CloudBase Web Publishable Key
```

调用数据与小程序一致：

```js
{
  action: 'classifyImage',
  imageBase64,
  mimeType: 'image/jpeg',
  hint
}
```

云函数会在服务端读取 `HUNYUAN_API_KEY` 或 `TENCENT_SECRET_ID/TENCENT_SECRET_KEY`，再调用腾讯混元视觉模型。上线前需要在 CloudBase 控制台开启 Web 端可调用云函数的权限，并按腾讯 CloudBase Web SDK 要求配置 Publishable Key 或对应权限策略。

如果不走 CloudBase，也可以部署 `web/api/classify-image.js` 作为独立后端代理，前端会读取：

```bash
VITE_MODEL_API_URL=https://你的后端域名/api/classify-image
```

`web/api/classify-image.js` 提供了一个 Vercel 风格的服务端接口模板，需要在服务端配置：

```bash
HUNYUAN_API_KEY=你的混元密钥
HUNYUAN_BASE_URL=https://api.hunyuan.cloud.tencent.com/v1
HUNYUAN_MODEL=hunyuan-vision
ALLOWED_ORIGIN=https://lockmyitem.asia
```

部署后，图片上传会调用该接口，再由服务端调用腾讯混元视觉模型返回分类、标签和物品描述。网页不会再使用浏览器本地模型伪装成自动识别。

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
