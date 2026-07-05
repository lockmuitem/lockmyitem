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
```

Optional indoor-enhanced positioning test:

```env
BAIDU_LOC_KEY=your-baidu-locapi-key
BAIDU_LOC_SRC=shanghaitech_findloss
BAIDU_LOC_PROD=lockmyitem
AMAP_KEY=your-amap-web-service-key
TENCENT_MAP_KEY=your-tencent-location-service-key
TENCENT_MAP_NETWORK_URL=https://apis.map.qq.com/ws/location/v1/network
```

When `BAIDU_LOC_KEY` exists, `lostfound.resolveIndoorSignals` tries Baidu intelligent hardware location first. If it fails or is not configured, the function falls back to AMap hardware positioning and then Tencent Map Network Location.

`BAIDU_LOC_KEY` should be a Baidu intelligent hardware location key for `https://api.map.baidu.com/locapi/v2`. Baidu documents this service as available to deep cooperation users; if Baidu returns a permission or quota error, check the service permission with Baidu LBS support.

`AMAP_KEY` should be an AMap Web Service key with hardware positioning access. If AMap returns `INVALID_USER_KEY`, `INSUFFICIENT_PRIVILEGES`, or `OVER_QUOTA`, check the key type, service permission, and quota in the AMap console.

`TENCENT_MAP_SK` is optional. Configure it only when your Tencent Location Service key requires request signing. Use the raw SK value only; do not include the `sk:` prefix.

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
