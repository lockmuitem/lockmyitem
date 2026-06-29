# shanghaitech失物招领

这是一个从零搭建的微信小程序云开发 MVP，面向校园失物招领互助场景。项目默认带本地 mock 数据，可以不配置云环境先在微信开发者工具里预览核心流程。

## 功能

- 微信一键登录的轻注册体验。
- 发布失物/拾物线索，支持图片、地点、详情描述和分类。
- 标题/描述本地模拟 AI 分类，云函数保留真实图像识别 API 接入点。
- 查找页按分类浏览，地图页在小程序内展示上科大地点 pin 点，不跳转外部网页。
- 详情页支持评论、感谢、举报、标记“已回家”和撤回。
- 已找到分区、消息中心、我的发布。

## 如何打开

1. 打开微信开发者工具。
2. 导入本目录：`outputs/shanghaitech-lost-found-miniprogram`。
3. AppID 可先选择测试号，或替换 `project.config.json` 里的 `appid`。
4. 如果暂不启用云开发，直接编译即可使用本地 mock 数据。
5. 若启用云开发，把 `miniprogram/app.js` 中的 `replace-with-your-cloud-env-id` 改成你的云环境 ID。

## 云开发部署

1. 在云开发控制台创建集合：
   - `users`
   - `items`
   - `comments`
   - `thanks`
   - `notifications`
   - `reports`
   - `campus_locations`
2. 将 `database.seed.json` 中的 `campus_locations` 导入到同名集合。
3. 上传并部署云函数 `cloudfunctions/lostfound`，安装依赖。
4. 云函数统一使用 `action` 字段分发：
   - `login`
   - `createItem`
   - `classifyImage`
   - `listItems`
   - `getItemDetail`
   - `listLocations`
   - `createComment`
   - `sendThanks`
   - `markReturned`
   - `undoReturned`
   - `reportContent`

## 接入真实图像识别

当前 `classifyImage` 使用文字兜底分类，便于 MVP 稳定运行。接腾讯云/百度/阿里图像识别时，只需要替换 `cloudfunctions/lostfound/index.js` 里的 `classifyImage` 函数：

- 根据 `event.fileId` 下载云存储图片或换取临时链接。
- 调用图像识别 API。
- 将 API 标签映射到固定分类：证件、电子产品、书本资料、衣物、钥匙、校园卡、雨伞、水杯、其他。
- 识别失败返回 `其他`，前端仍允许用户手动修改。

## 重要说明

- 地图是小程序内静态校园地图视图，适合地点选择和按地点找物，不做实时导航。
- 第一版通知采用站内消息；真实微信订阅消息可在 `sendThanks` 和 `createComment` 后追加发送逻辑。
- 页面默认走本地 `utils/store.js`，这样无云环境也能演示；正式版可将 store 方法逐步替换为 `wx.cloud.callFunction({ name: 'lostfound', data: { action, ... } })`。
