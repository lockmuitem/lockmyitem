# 图像识别模型接口约定

当前小程序不会在前端直接跑 YOLO 或语义模型。图片上传到微信云存储后，由云函数 `lostfound` 获取临时图片链接，并并行调用两个模型服务：

- `YOLO_API_URL`：目标检测服务
- `SEMANTIC_API_URL`：语义理解服务

两个地址通过微信云函数环境变量配置，密钥通过 `MODEL_API_KEY` 配置。

## 请求格式

云函数会向两个服务都发送同样的 POST JSON：

```json
{
  "imageUrl": "https://tmp-file-url",
  "fileId": "cloud://xxx",
  "hint": "用户填写的标题和描述"
}
```

请求头：

```http
content-type: application/json
authorization: Bearer ${MODEL_API_KEY}
```

如果没有配置 `MODEL_API_KEY`，则不发送 authorization。

## YOLO 服务返回

支持以下任一字段名：`objects`、`detections`、`results`。

```json
{
  "objects": [
    {
      "label": "umbrella",
      "confidence": 0.94,
      "bbox": [120, 88, 420, 620],
      "attributes": {
        "color": "black"
      }
    }
  ]
}
```

字段兼容：

- `label` / `name` / `class` / `tag`
- `confidence` / `score` / `probability`
- `bbox` / `box` / `xyxy`

云函数会把常见英文标签归一化成中文标签，例如：

- `umbrella` -> `雨伞`
- `bottle` / `cup` -> `水杯`
- `cell_phone` / `phone` -> `手机`
- `laptop` -> `电脑`
- `key` / `keys` -> `钥匙`

## 语义模型返回

```json
{
  "description": "黑色折叠雨伞，伞柄处有红色钥匙扣。",
  "category": "雨伞",
  "tags": ["雨伞", "黑色", "折叠", "红色钥匙扣"],
  "colors": ["黑色", "红色"],
  "accessories": ["钥匙扣"],
  "imageEmbedding": [0.12, -0.08],
  "semanticEmbedding": [0.03, 0.24]
}
```

字段兼容：

- `description` / `caption` / `visualDescription`
- `tags` / `aiTags` / `keywords`
- `imageEmbedding` / `image_embedding`
- `semanticEmbedding` / `semantic_embedding` / `embedding`

## 云函数融合结果

`classifyImage` 最终返回：

```json
{
  "ok": true,
  "data": {
    "category": "雨伞",
    "aiTags": ["雨伞", "黑色", "折叠", "红色钥匙扣"],
    "yoloObjects": [],
    "semanticTags": [],
    "visualDescription": "黑色折叠雨伞，伞柄处有红色钥匙扣。",
    "imageEmbedding": [],
    "semanticEmbedding": []
  }
}
```

前端会把这些字段写入发布表单，并用于后续相似物品检索。
