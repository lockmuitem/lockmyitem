# 腾讯云混元图像识别接入说明

当前小程序不会在前端直接调用模型。图片上传到微信云存储后，由云函数 `lostfound` 获取临时图片链接，并直接调用腾讯云混元多模态模型生成结构化标签。

## 云函数环境变量

在微信云开发控制台给 `cloudfunctions/lostfound` 配置：

```text
HUNYUAN_API_KEY=腾讯云混元 API Key
HUNYUAN_MODEL=hunyuan-vision
HUNYUAN_BASE_URL=https://api.hunyuan.cloud.tencent.com/v1
```

说明：

- `HUNYUAN_API_KEY`：从腾讯云混元控制台/API Key 管理页面获取。
- `HUNYUAN_MODEL`：默认使用视觉多模态模型，可按腾讯云控制台可用模型调整。
- `HUNYUAN_BASE_URL`：默认是腾讯云混元 OpenAI 兼容接口，一般不用改。
- `MODEL_API_KEY`：仅作为旧配置兼容备用，不建议新配置继续使用。
- 不再需要 `YOLO_API_URL`、`SEMANTIC_API_URL`、`YOLO_MODEL` 或自建 `model-service`。

## 调用链路

1. 小程序上传图片到微信云存储。
2. 云函数通过 `cloud.getTempFileURL` 获取图片临时 HTTPS 链接。
3. 云函数调用混元 `/chat/completions`，传入 `image_url` 和用户填写的标题/描述作为 hint。
4. 混元返回 JSON：类别、标签、颜色、配件、自然语言描述。
5. 云函数把结果写回发布表单字段，用于后续相似物品匹配。

## 混元返回 JSON 约定

云函数会要求模型只返回 JSON：

```json
{
  "description": "黑色折叠雨伞，伞柄处有红色钥匙扣。",
  "category": "雨伞",
  "tags": ["雨伞", "黑色", "折叠", "红色钥匙扣"],
  "colors": ["黑色", "红色"],
  "accessories": ["钥匙扣"]
}
```

## 云函数最终返回

`classifyImage` 会返回：

```json
{
  "ok": true,
  "data": {
    "category": "雨伞",
    "aiTags": ["雨伞", "黑色", "折叠", "红色钥匙扣"],
    "yoloObjects": [],
    "semanticTags": ["雨伞", "折叠", "红色钥匙扣"],
    "visualDescription": "黑色折叠雨伞，伞柄处有红色钥匙扣。",
    "imageEmbedding": [],
    "semanticEmbedding": [],
    "modelSources": {
      "provider": "tencent-hunyuan",
      "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1",
      "model": "hunyuan-vision"
    }
  }
}
```

前端会把这些字段写入发布表单，并用于后续相似物品检索。`yoloObjects` 仍保留为空数组，是为了兼容之前已经写好的前端字段。
