# QQ 群自动接入

该服务使用腾讯官方 QQ Bot Python SDK 接收群消息，不读取个人 QQ 本地数据库，也不依赖模拟登录。目标群为“上科大健忘者互助协会”。

## 数据流

1. 机器人接收群消息事件，并按 `群 + 发送者` 聚合连续 45 秒内的文字和图片。
2. 消息 ID 在进程内去重；云函数再以完整消息 ID 集合做持久化幂等。
3. 机器人只下载 QQ 官方事件给出的 HTTPS 图片，限制域名、类型、数量与单图 4 MB，然后以 HMAC 签名调用 `ingestQQBatch`。
4. 云函数把图片上传到私有 CloudBase 存储，调用混元抽取物品、颜色特征、原始/规范地点、时间与敏感等级。
5. 高置信度且地点能唯一映射到 `campus_locations`：自动发布并由机器人回复“已录入 LockMyItem：链接”；中置信度、地点歧义或缺地点：进入 `qq_ingest_drafts`；低置信度/闲聊：仅记录后忽略。
6. 自动发布的物品继续使用网站的敏感图片保护与认领确认流程。

进程内消息 ID 缓存默认保留 24 小时且最多 20000 条，避免长期运行时无限占用内存。云函数暂时失败时默认指数退避重试 5 次；重试仍由云端消息 ID 幂等保护。

## 启动

先在 QQ 开放平台创建机器人并把机器人加入目标群。当前腾讯官方 BotPy 对普通 QQ 群公开的是 `GROUP_AT_MESSAGE_CREATE`，即成员需要在包含图片/文字的第一条或后续补充消息中 @ 机器人；官方 SDK 并没有可供普通 QQ 群订阅全部聊天的 `GROUP_MESSAGE_CREATE`。本项目只实现官方允许的事件，不会用个人 QQ 模拟登录绕过平台限制。

因此，“完全无感监听群内所有新消息”不能仅靠当前官方机器人权限实现。现阶段可采用两条合规路径：群规要求失物招领消息 @ 机器人，或者定期导出为 JSONL 后运行历史导入器。若腾讯后续向该机器人开放普通群全量消息事件，只需把事件转成 `IncomingMessage`，后续聚合和入库链路无需改动。

安装并配置：

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

把 `.env` 中的值配置到实际进程环境（仓库不会自动加载 `.env`），然后：

```powershell
python check_config.py --scope bot --env-file .env
python run_bot.py
```

云函数侧必须配置相同的 `QQ_INGEST_SECRET`，并配置 `QQ_ALLOWED_GROUP_IDS`、`WEB_PUBLIC_BASE_URL` 与混元凭据。`LOCKMYITEM_INGEST_URL` 应指向带 HTTP 触发器的 `lostfound` 云函数。不要提交 App Secret、HMAC 密钥或群成员标识。

部署前可在不输出任何密钥值的情况下检查云函数配置：

```powershell
python check_config.py --scope cloud
```

中置信度草稿通过 HMAC 管理接口 `listQQDrafts` / `reviewQQDraft` 审核，使用与机器人隔离的 `QQ_ADMIN_SECRET`。敏感 QQ 物品还必须配置 `QQ_REVIEW_OWNER_ACTOR_ID` 为一个真实的站内管理员 `_openid`；这样模型无法直接核验认领时，该管理员会收到站内/邮件确认。未配置时敏感内容不会自动发布，也不能被误审核上线。

管理员批准草稿后，云函数把通知写入 `qq_bot_outbox`；机器人每 10 秒领取，失败最多重试 5 次。QQ 官方接口的被动回复有 5 分钟有效期：尚在安全时窗内时引用原消息，人工审核超时后则降级为同群主动通知，避免用过期 `msg_id` 无限重试。中等置信度内容在未审核时不会展示或回复带链接的发布结果。主动消息仍受 QQ 开放平台当时的群消息频控和额度限制。

```powershell
python review_drafts.py list
python review_drafts.py approve <draft-id> --title "白色耳机" --category "电子产品" --location-id <campus-location-id>
python review_drafts.py reject <draft-id>
```

审核者可以修正 `type/title/description/category/locationId/locationRaw/occurredAtText`，但不能通过管理接口下调模型已给出的敏感等级或修改来源字段。批准前必须有唯一有效的 `campus_locations` 地点；地点歧义时请显式传入 `--location-id`。

## 历史聊天记录

推荐把 QQ 导出结果转换成 `messages.example.jsonl` 的“一行一条原始消息”格式。每条必须保留真实 `messageId`、`senderId`、带时区的 `sentAt`、文字和相对图片路径；导入器会按发送者和 45 秒窗口聚合。也兼容已经预聚合的 `messageIds` 数组。

当前工作区“QQ聊天记录”只有裸图片，没有发送者、时间、文字地点或消息 ID。可使用：

```powershell
python import_history.py --image-dir "..\..\..\QQ聊天记录" --dry-run
python import_history.py --manifest messages.jsonl --dry-run
python import_history.py --manifest messages.jsonl
```

`--dry-run` 不需要云端凭据，会报告字段缺失、聚合结果、图片尺寸和哈希。裸图片导入会在签名载荷中标记 `importMode=loose_images`，后端不接受模型对该标记的自动发布或忽略决定，而是强制进入人工审核；内部来源同时标记其消息标识为哈希生成，不能冒充真实 QQ 消息 ID。多张同一物品的照片只有在 JSONL 中具有同一发送者且发送间隔不超过窗口，系统才会把它们作为一条记录处理。

## 验收

先在测试群依次发送“地点文字”、两张同一物品照片，等待 45 秒。应只生成一个 `qq_ingest_events` 幂等记录；重复投递相同消息 ID 不应生成新物品。敏感卡片即使自动发布，未通过认领校验的账号也看不到原图。
