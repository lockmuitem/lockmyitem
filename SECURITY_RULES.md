# CloudBase 安全规则部署

本项目的网页端只调用 `lostfound` 云函数，不直接读写数据库或云存储。

在 CloudBase 控制台中执行以下配置：

1. 对 `users`、`items`、`comments`、`claim_requests`、`thanks`、`notifications`、`reports`、`campus_locations`、`email_login_codes`、`classify_rate_limits`、`qq_ingest_events`、`qq_ingest_drafts`、`qq_bot_outbox` 每个集合启用“自定义安全规则”，粘贴 `database.rules.json`。
2. 在“云存储 → 权限设置 → 自定义安全规则”粘贴 `storage.rules.json`。
3. 部署后用未登录浏览器分别尝试数据库读取、数据库写入、FileID 下载和上传，四项都应返回权限拒绝；网页经云函数的列表、详情和发帖仍应正常。

两个规则文件都是 CloudBase 可执行的规则对象。`false` 只拒绝网页/客户端直连，云函数和控制台仍可访问，因此敏感原图只能由 `lostfound` 校验认领权限后生成临时 URL。即使发布者或已通过验证的申领人有权查看图片，云函数响应也只返回临时 URL，不返回持久化的 `imageFileId` / `imageFileIds`、QQ 群 ID、消息 ID 或发送者哈希。

不要把 `campus_locations` 设为公开读取；网页的地点列表也已经通过 `listLocations` 云函数取得。这样能维持单一、可审计的数据入口。
