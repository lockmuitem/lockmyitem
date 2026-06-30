# 上科大校园失物招领小程序

这是一个面向上海科技大学校园场景的微信小程序 MVP，用于失物招领、寻物发布、校内地点定位和相似物品提醒。当前分支为 `slqs-branch`，默认使用本地 mock 数据，无需云环境即可在微信开发者工具里预览核心流程。

## 当前版本亮点

- `失物招领` 与 `寻物` 两个独立板块，分别展示捡到的物品和正在寻找的物品。
- 发布页支持图片、标题、描述、分类、校内地点和自动定位。
- 使用上科大校内地点库，地点包含学院楼、图书馆、教学中心、宿舍、餐饮点、体育设施和出入口。
- 校园地点坐标已按腾讯地图使用的 GCJ-02 坐标系校准，避免图书馆等地点显示偏移。
- “我的”页支持注册资料维护，包含昵称和邮箱。
- 发布寻物时会自动检索已有招领信息，按类别、颜色、外观细节、配件、地点等计算相似度。
- 示例：输入“黑色雨伞，上面有红色钥匙扣”会匹配“黑色折叠伞，带红色钥匙扣”。
- 详情页支持评论、感谢发布人、举报、标记“已回家”和撤回。

## 如何打开

1. 打开微信开发者工具。
2. 导入项目根目录：

   `D:\Uni1.2\做点好玩的\AI创赛--校园失物招领系统`

3. AppID 可先使用测试号，或替换 `project.config.json` 中的 `appid`。
4. 直接点击“编译”即可使用本地 mock 数据。
5. 如果页面仍显示旧内容，执行“工具 -> 清缓存 -> 清除全部缓存并重新编译”。

## 主要页面

- `pages/index/index`：失物招领，展示同学捡到的物品。
- `pages/map/map`：寻物，展示同学正在寻找的物品。当前沿用旧页面路径，但 tab 文案已改为“寻物”。
- `pages/publish/publish`：发布招领或寻物，支持自动定位和相似物品提醒。
- `pages/detail/detail`：物品详情、校内地点卡、评论、感谢、举报和已回家操作。
- `pages/found/found`：已找到分区。
- `pages/messages/messages`：消息中心。
- `pages/me/me`：我的资料、邮箱、我的发布。

## 自动定位与地点库

发布页会调用：

```js
wx.getLocation({
  type: 'gcj02',
  isHighAccuracy: true
})
```

定位后会匹配最近的上科大校内地点，并展示最近候选地点供用户切换。

地点库位于：

`miniprogram/utils/locations.js`

地点数据包含：

- 图书馆
- 生命科学与技术学院
- 信息科学与技术学院
- 物质科学与技术学院
- 创业与管理学院
- 创意与艺术学院
- 教学中心、行政中心、报告厅、学生科创中心、校园服务中心
- 丝路餐厅、尚科美食广场、西餐厅、白玉兰餐厅、清真餐厅、KFC
- 学生公寓、教师公寓、体育馆、游泳馆、会议中心、校门

地图显示使用腾讯地图坐标系，代码中已包含 WGS84 到 GCJ-02 的转换逻辑。

## 相似物品匹配

当前版本已有本地可运行的相似匹配 MVP，入口在：

`miniprogram/utils/matcher.js`

匹配逻辑会提取：

- 物品类别，例如雨伞、校园卡、水杯
- 颜色，例如黑色、红色、蓝色
- 外观描述，例如折叠、长柄、透明
- 配件细节，例如钥匙扣、贴纸、挂绳、刻字、划痕
- 标题和描述里的语义关键词
- 地点是否一致或相近

只有相似度超过阈值时，发布页才会显示“可能是你的物品”；没有匹配则不显示。

## 接入腾讯云混元图像识别

当前分支已改为云函数直接调用腾讯云混元多模态模型：图片上传到云存储后，云函数获取临时图片链接，调用混元视觉模型生成图片 tags。小程序端不直接保存 API key。

需要配置云函数环境变量：

```text
HUNYUAN_API_KEY=腾讯云混元 API Key
HUNYUAN_MODEL=hunyuan-vision
HUNYUAN_BASE_URL=https://api.hunyuan.cloud.tencent.com/v1
```

说明：

- `HUNYUAN_API_KEY`：在腾讯云混元控制台/API Key 管理页面获取。
- `HUNYUAN_MODEL`：可按腾讯云控制台支持的视觉模型名称调整。
- `HUNYUAN_BASE_URL`：默认使用腾讯云混元 OpenAI 兼容接口，一般不用改。
- 不再需要 `YOLO_API_URL`、`SEMANTIC_API_URL` 或自建 `model-service`。

调用链路：

1. 小程序上传图片到云存储。
2. 云函数拿到图片临时链接。
3. 云函数调用混元 `/chat/completions`，传入 `image_url` 和用户填写的标题/描述。
4. 混元返回结构化描述：物品类别、颜色、配件、特殊标记、自然语言 caption。
5. 将 `visualDescription`、`semanticTags`、`aiTags` 写入物品记录。
6. 用户发布寻物时，对历史招领物品做相似度检索。

模型接口约定见：

`MODEL_API_CONTRACT.md`

## 云开发部署

如果需要从本地 mock 切到真实云端，需要创建以下集合：

- `users`
- `items`
- `comments`
- `thanks`
- `notifications`
- `reports`
- `campus_locations`

部署步骤：

1. 在微信云开发控制台创建集合。
2. 将 `database.seed.json` 中的 `campus_locations` 导入同名集合。
3. 上传并部署 `cloudfunctions/lostfound`。
4. 将前端 `utils/store.js` 中的本地方法逐步替换为 `wx.cloud.callFunction`。

云函数 action：

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

## 开发说明

- 当前分支：`slqs-branch`
- 本地数据入口：`miniprogram/utils/store.js`
- 分类关键词：`miniprogram/utils/constants.js`
- 地点库：`miniprogram/utils/locations.js`
- 相似匹配：`miniprogram/utils/matcher.js`
- 云函数：`cloudfunctions/lostfound/index.js`

## 已知限制

- 图像识别依赖腾讯云混元 API，未配置 `HUNYUAN_API_KEY` 时会返回 `MODEL_NOT_CONFIGURED`。
- 本地 mock 数据只存在于微信开发者工具本地缓存中。
- 邮箱字段已保存，但邮件通知尚未接入实际发送服务。
- 正式上线前需要配置真实 AppID、云开发环境和隐私接口声明。
