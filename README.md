# LockMyItem Web/PWA

面向上海科技大学校园场景的失物招领网页端。当前唯一主线是 `web/` React PWA，后端能力由 `cloudfunctions/lostfound` 这个 CloudBase 云函数提供。

## 当前主线

- `web/`：浏览器与 PWA 前端，包含列表、发布、详情、评论、认领、归还状态、邮箱登录、图片识别入口和桌面安装提示。
- `cloudfunctions/lostfound/`：CloudBase 后端，提供数据读写、邮箱验证码/登录、评论、认领、归还状态、图片识别和通知邮件。
- `database.seed.json`：CloudBase 集合初始化数据，主要用于 `campus_locations`。
- `database.rules.json`：数据库权限建议。
- `cloudbaserc.json`：CloudBase 云函数部署配置。

旧微信小程序源码已不再作为维护主线保留。它里面仍然有价值的部分已经在 web 端对应落位：

- 分类和相似匹配逻辑：`web/src/utils.js`、`web/src/data.js`
- 校园地点和地图数据：`web/src/campusMapData.js`
- 示例物品、公告栏和 tabbar 资产：`web/src/assets/`
- 云端数据与模型调用：`web/src/store.js`、`web/src/vision.js`、`cloudfunctions/lostfound/`

## 本地运行

```powershell
cd web
npm install
npm run dev
```

打开终端输出的本地地址，例如 `http://localhost:5173`。

## 生产构建

```powershell
cd web
npm run build
```

构建产物输出到 `web/dist/`，可部署到 GitHub Pages、Vercel、Netlify、腾讯云静态网站托管或任意静态站点服务。

## CloudBase 配置

web 前端默认调用 CloudBase 环境：

```env
VITE_CLOUDBASE_ENV_ID=cloud1-d9gnyuxf5b44b6b92
VITE_CLOUDBASE_FUNCTION_NAME=lostfound
VITE_CLOUDBASE_REGION=ap-shanghai
VITE_CLOUDBASE_ACCESS_KEY=
```

可复制 `web/.env.production.example` 为本地或部署平台环境变量模板。真实 Publishable Key、SMTP 密码、混元 API Key 和腾讯云 Secret 必须只放在本地环境或 CloudBase 环境变量中，不要提交到仓库。

`lostfound` 云函数依赖的服务端环境变量见 `CLOUD_DEVELOPMENT_SETUP.md`。图片识别接口约定见 `MODEL_API_CONTRACT.md`。

## 主要功能

- 失物招领、寻物、已找回列表
- 分类筛选与关键词搜索
- 校园地图点选和地点详情补充
- 发布招领或寻物信息
- 图片识别生成类别、标签和描述
- 寻物发布后匹配已有招领信息
- 邮箱验证码/密码登录和昵称维护
- 评论、认领、标记已找回、撤回归还状态
- CloudBase 同步失败时使用浏览器本地缓存兜底
- HTTPS 部署后支持添加到手机或桌面

## 数据集合

CloudBase 环境需要以下集合：

- `users`
- `items`
- `comments`
- `claim_requests`
- `thanks`
- `notifications`
- `reports`
- `campus_locations`

初始化地点数据时，将 `database.seed.json` 中的 `campus_locations` 导入同名集合。

## 隐私和安全边界

- 浏览器端不保存混元 API Key、腾讯云 Secret、SMTP 密码或服务端 token。
- 图片识别通过 CloudBase 云函数或受保护的后端代理调用模型。
- 发布地点来自用户手动点选、地点搜索或手动输入，不依赖浏览器定位权限。
- 浏览器 `localStorage` 只作为离线或云端加载失败时的缓存兜底。
