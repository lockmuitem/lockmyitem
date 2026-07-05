# WeChat CloudBase Setup

Mini program cloud environment:

```text
cloud1-d9gnyuxf5b44b6b92
```

The mini program now calls `cloudfunctions/lostfound` for image recognition when this value in `miniprogram/app.js` is empty:

```js
const MODEL_API_URL = '';
```

## Cloud Function Environment Variables

Configure these variables in the WeChat DevTools CloudBase console for `cloudfunctions/lostfound`.

```env
TENCENT_SECRET_ID=your-secret-id
TENCENT_SECRET_KEY=your-secret-key
HUNYUAN_MODEL=hunyuan-vision
TENCENT_HUNYUAN_ENDPOINT=https://hunyuan.tencentcloudapi.com

TENCENT_MAP_KEY=your-tencent-location-service-key
TENCENT_MAP_REFERER=LockMyItem
TENCENT_MAP_CATEGORY=大学,餐饮,生活服务
```

`TENCENT_MAP_KEY` is used only by the Tencent Location Service location picker plugin. Do not configure or commit `TENCENT_MAP_SK`; the current mini program does not need Tencent Map request signing.

Optional OpenAI-compatible Hunyuan mode:

```env
HUNYUAN_API_KEY=your-sk-api-key
HUNYUAN_BASE_URL=https://api.hunyuan.cloud.tencent.com/v1
HUNYUAN_MODEL=hunyuan-vision
```

If both Tencent Cloud `SecretId/SecretKey` and `HUNYUAN_API_KEY` exist, the cloud function prefers Tencent Cloud signed API calls.

## Deploy

1. Open the project in WeChat DevTools.
2. Make sure CloudBase environment is `cloud1-d9gnyuxf5b44b6b92`.
3. Right-click `cloudfunctions/lostfound`.
4. Choose `Upload and deploy: cloud install dependencies`.
5. Recompile the mini program and test image recognition.

## Timeout

Image recognition calls can take more than the CloudBase default 3 seconds. The project includes:

```text
cloudfunctions/lostfound/config.json
```

with:

```json
{
  "timeout": 30,
  "memorySize": 512
}
```

If the CloudBase console still reports `FUNCTIONS_TIME_LIMIT_EXCEEDED`, open `lostfound` in the CloudBase console and set the function timeout to 30 seconds manually, then deploy again.

Do not commit real API keys. Keep them only in CloudBase environment variables.
