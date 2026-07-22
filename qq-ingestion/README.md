# QQ 群自动接入

该服务使用腾讯官方 QQ Bot Python SDK 接收群消息，不读取个人 QQ 本地数据库，也不依赖模拟登录。目标群为“上科大健忘者互助协会”。

## 数据流

1. 机器人接收群消息事件，并按 `群 + 发送者` 聚合连续 45 秒内的文字和图片。
2. 消息 ID 在进程内去重；云函数再以完整消息 ID 集合做持久化幂等。
3. 机器人只下载 QQ 官方事件给出的 HTTPS 图片，限制域名、类型、数量与单图 4 MB，然后以 HMAC 签名调用 `ingestQQBatch`。
4. 云函数把图片上传到私有 CloudBase 存储，调用混元抽取物品、颜色特征、原始/规范地点、时间与敏感等级。
5. 高置信度且地点能唯一映射到 `campus_locations`：自动发布并由机器人回复“已录入 LockMyItem：链接”；中置信度、地点歧义或缺地点：进入 `qq_ingest_drafts`；低置信度/闲聊：仅记录后忽略。
6. 自动发布的物品继续使用网站的敏感图片保护与认领确认流程。

进程内消息 ID 缓存默认保留 24 小时且最多 20000 条，避免长期运行时无限占用内存。每个聚合批次会先写入本地 SQLite 持久队列，再尝试发送；断网、后端未配置或进程重启都不会丢失。云端确认后，本地队列会删除含图片的载荷，只保留批次哈希用于去重。

## 启动

先在 QQ 开放平台创建机器人并把机器人加入目标群。当前腾讯官方 BotPy 对普通 QQ 群公开的是 `GROUP_AT_MESSAGE_CREATE`，即成员需要在包含图片/文字的第一条或后续补充消息中 @ 机器人；官方 SDK 并没有可供普通 QQ 群订阅全部聊天的 `GROUP_MESSAGE_CREATE`。本项目只实现官方允许的事件，不会用个人 QQ 模拟登录绕过平台限制。

因此，“完全无感监听群内所有新消息”不能仅靠当前官方机器人权限实现。现阶段可采用两条合规路径：群规要求失物招领消息 @ 机器人，或者定期导出为 JSONL 后运行历史导入器。若腾讯后续向该机器人开放普通群全量消息事件，只需把事件转成 `IncomingMessage`，后续聚合和入库链路无需改动。

安装并配置：

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

`run_bot.py` 会自动读取同目录的本地 `.env`。模板后半部分的变量还要配置到 CloudBase `lostfound` 云函数环境；不要把含真实值的 `.env` 或云函数配置提交到 Git。

如果暂时不接 CloudBase，只想让官方机器人先收集并落到本地队列，可只配置 QQ 三项并运行：

```powershell
python check_config.py --scope listener --env-file .env
python run_bot.py
```

默认队列位于 `data/qq-ingestion-spool.sqlite3`，其中待处理记录可能含敏感图片，已被 Git 忽略；不要共享或提交该文件。以后补齐 `LOCKMYITEM_INGEST_URL` 和 `QQ_INGEST_SECRET` 后，同一进程会自动续传。完整云端模式使用：

```powershell
python check_config.py --scope all --env-file .env
python run_bot.py
```

云函数侧必须配置相同的 `QQ_INGEST_SECRET`，并配置 `QQ_ALLOWED_GROUP_IDS`、`WEB_PUBLIC_BASE_URL` 与混元凭据。`LOCKMYITEM_INGEST_URL` 应指向带 HTTP 触发器的 `lostfound` 云函数。不要提交 App Secret、HMAC 密钥或群成员标识。

部署前可在不输出任何密钥值的情况下检查云函数配置：

```powershell
python check_config.py --scope cloud
```

中置信度草稿通过 HMAC 管理接口 `listQQDrafts` / `reviewQQDraft` 审核，使用与机器人隔离的 `QQ_ADMIN_SECRET`。QQ群中的原发布者不需要注册本系统：配置 `QQ_REVIEW_OWNER_EMAIL` 后，所有 QQ 线索会统一归属到该邮箱对应的“QQ群代发布管理员”身份，认领、匹配和人工确认邮件也统一发送到该邮箱。系统会从邮箱确定性生成站内身份，因此该邮箱即使尚未注册也可以先接收邮件；要进入网站执行通过/拒绝时，只需用完全相同的邮箱完成一次注册。不要同时填写不匹配的 `QQ_REVIEW_OWNER_ACTOR_ID`。

该统一邮箱只保存在云函数环境配置和私有用户数据中，不会写入公开物品响应。若 `QQ_REVIEW_OWNER_EMAIL` 与 `QQ_REVIEW_OWNER_ACTOR_ID` 都未配置，敏感内容不会自动发布，也不能被误审核上线。

管理员批准草稿后，云函数把通知写入 `qq_bot_outbox`；机器人每 10 秒领取，失败最多重试 5 次。QQ 官方接口的被动回复有 5 分钟有效期：尚在安全时窗内时引用原消息，人工审核超时后则降级为同群主动通知，避免用过期 `msg_id` 无限重试。中等置信度内容在未审核时不会展示或回复带链接的发布结果。主动消息仍受 QQ 开放平台当时的群消息频控和额度限制。

```powershell
python review_drafts.py list
python review_drafts.py approve <draft-id> --title "白色耳机" --category "电子产品" --location-id <campus-location-id>
python review_drafts.py reject <draft-id>
```

审核者可以修正 `type/title/description/category/locationId/locationRaw/occurredAtText`，但不能通过管理接口下调模型已给出的敏感等级或修改来源字段。批准前必须有唯一有效的 `campus_locations` 地点；地点歧义时请显式传入 `--location-id`。

## 历史聊天记录

当前更稳妥的落地方式是：从 QQ 下载完整聊天记录与图片，原样放在一个本地目录，再由本工具增量处理。请优先导出完整记录，不要只复制图片；完整记录中的消息 ID、发送者、时间、文字和图片对应关系决定了多张照片能否正确归为同一物品。

目前已直接支持 `messages.jsonl`：一行一条原始消息，每条保留真实 `messageId`、`senderId`、带时区的 `sentAt`、文字和相对图片路径；程序按发送者和 45 秒窗口聚合，也兼容已经预聚合的 `messageIds` 数组。QQ 客户端实际导出的 TXT/HTML/MHT/JSON 格式并不固定，拿到你的真实导出样本后再添加对应解析器；程序发现这些未适配文件时会明确停止，不会错误地把它们当成裸图片处理。

当前工作区“QQ聊天记录”只有裸图片，没有发送者、时间、文字地点或消息 ID。可使用：

```powershell
python import_history.py --image-dir "..\..\..\QQ聊天记录" --dry-run
python import_history.py --manifest messages.jsonl --dry-run
python import_history.py --manifest messages.jsonl
```

`--dry-run` 不需要云端凭据，会报告字段缺失、聚合结果、图片尺寸和哈希。裸图片导入会在签名载荷中标记 `importMode=loose_images`，后端不接受模型对该标记的自动发布或忽略决定，而是强制进入人工审核；内部来源同时标记其消息标识为哈希生成，不能冒充真实 QQ 消息 ID。多张同一物品的照片只有在 JSONL 中具有同一发送者且发送间隔不超过窗口，系统才会把它们作为一条记录处理。

如果先不使用 CloudBase，可在本机 `.env` 只配置 `HUNYUAN_API_KEY`，然后运行本地混元流程：

```powershell
python process_history.py --source "..\..\..\QQ聊天记录" --dry-run
python check_config.py --scope local --env-file .env
python process_history.py --source "..\..\..\QQ聊天记录" --env-file .env
```

本地流程会自动计算来源哈希并增量去重，结果保存在被 Git 忽略的 `data/history-results.sqlite3` 与 `data/history-results.jsonl`。结果只含本地图片路径/哈希和脱敏后的模型结构化字段，不包含图片 Base64、发送者原 ID 或原始聊天正文。正常高置信度且地点完整的普通物品标记为 `publish_candidate`；中等置信度、缺地点及 important/sensitive 物品进入 `needs_review`；裸图片无论模型置信度多高都强制 `needs_review`。该阶段只生成候选和审核结果，不会直接公开网站图片。

## 验收

先在测试群依次发送“地点文字”、两张同一物品照片，等待 45 秒。应只生成一个 `qq_ingest_events` 幂等记录；重复投递相同消息 ID 不应生成新物品。敏感卡片即使自动发布，未通过认领校验的账号也看不到原图。
