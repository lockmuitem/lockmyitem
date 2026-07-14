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

Optional OpenAI-compatible Hunyuan mode:

```env
HUNYUAN_API_KEY=your-sk-api-key
HUNYUAN_BASE_URL=https://api.hunyuan.cloud.tencent.com/v1
HUNYUAN_MODEL=hunyuan-vision
```

If both Tencent Cloud `SecretId/SecretKey` and `HUNYUAN_API_KEY` exist, the cloud function prefers Tencent Cloud signed API calls.

Optional ShanghaiTech email login:

```env
AUTH_EMAIL_DOMAIN=shanghaitech.edu.cn
AUTH_TOKEN_SECRET=use-a-long-random-server-side-secret
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=your-sender@example.com
SMTP_PASS=your-smtp-password-or-app-password
SMTP_FROM=LockMyItem <your-sender@example.com>
```

`AUTH_TOKEN_SECRET` and all SMTP credentials must stay in CloudBase environment variables. Do not put real values in frontend code or GitHub.

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

## Test classifyImage

Use a direct image URL that can be downloaded by Tencent Cloud. Do not use search result pages such as Bing Image detail URLs. Some school website assets may return `403 Forbidden` to cloud-side requests and will be rejected by Hunyuan as invalid images.

Cloud function test event:

```json
{
  "action": "classifyImage",
  "imageUrl": "https://raw.githubusercontent.com/shaolq07/shanghaitech_findloss/main/web/src/assets/items/umbrella.jpg",
  "hint": "雨伞，校园失物招领图片识别测试"
}
```

Expected result:

```json
{
  "ok": true,
  "data": {
    "category": "雨伞",
    "aiTags": [],
    "visualDescription": "",
    "yoloObjects": [],
    "semanticTags": [],
    "modelSources": {}
  }
}
```

Do not commit real API keys. Keep them only in CloudBase environment variables.
