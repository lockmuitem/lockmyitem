# WeChat CloudBase Setup

Mini program cloud environment:

```text
cloud1-d9gnyuxf5b44b6b92
```

The mini program now calls `cloudfunctions/lostfound` for image recognition and indoor positioning when these values in `miniprogram/app.js` are empty:

```js
const MODEL_API_URL = '';
const INDOOR_API_URL = '';
```

## Cloud Function Environment Variables

Configure these variables in the WeChat DevTools CloudBase console for `cloudfunctions/lostfound`.

```env
TENCENT_SECRET_ID=your-secret-id
TENCENT_SECRET_KEY=your-secret-key
HUNYUAN_MODEL=hunyuan-vision
TENCENT_HUNYUAN_ENDPOINT=https://hunyuan.tencentcloudapi.com

TENCENT_MAP_KEY=your-map-key
TENCENT_MAP_SK=your-map-sk
TENCENT_MAP_NETWORK_URL=https://apis.map.qq.com/ws/location/v1/network
```

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
5. Recompile the mini program and test image recognition plus indoor positioning.

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
