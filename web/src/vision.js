const TCB_ENV_ID = import.meta.env.VITE_TCB_ENV_ID || 'cloud1-d9gnyuxf5b44b6b92';
const TCB_ACCESS_KEY = import.meta.env.VITE_TCB_ACCESS_KEY || '';
const TCB_REGION = import.meta.env.VITE_TCB_REGION || 'ap-shanghai';
const TCB_FUNCTION_NAME = import.meta.env.VITE_TCB_FUNCTION_NAME || 'lostfound';
const TCB_ENABLED = import.meta.env.VITE_DISABLE_TCB_HUNYUAN !== 'true' && Boolean(TCB_ENV_ID);
const REMOTE_MODEL_ENDPOINT = import.meta.env.VITE_MODEL_API_URL || import.meta.env.VITE_HUNYUAN_API_URL || '';

let cloudbaseAppPromise = null;

function unique(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeRemoteData(raw = {}) {
  const payload = raw && raw.data && !raw.category && !raw.aiTags ? raw.data : raw;
  const tags = unique([])
    .concat(payload.aiTags || [])
    .concat(payload.tags || [])
    .concat(payload.semanticTags || [])
    .concat(payload.objects || [])
    .concat(payload.yoloObjects || []);

  return {
    title: payload.title || payload.name || payload.category || '',
    description: payload.description || payload.visualDescription || payload.caption || '',
    category: payload.category || '其他',
    tags: unique(tags),
    visualDescription: payload.visualDescription || payload.description || payload.caption || '',
    yoloObjects: payload.yoloObjects || payload.objects || [],
    semanticTags: payload.semanticTags || payload.tags || [],
    imageEmbedding: payload.imageEmbedding || [],
    semanticEmbedding: payload.semanticEmbedding || [],
    modelSources: payload.modelSources || {},
    rawPredictions: payload.rawPredictions || []
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function compressDataUrl(dataUrl, maxSize = 1280, quality = 0.78) {
  return imageFromDataUrl(dataUrl).then((image) => {
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  });
}

function endpointRequiredMessage() {
  return [
    '网页端混元识别不可用。',
    '请确认 CloudBase Web 权限已允许调用 lostfound 云函数，',
    '或配置 VITE_MODEL_API_URL 指向 web/api/classify-image.js 这样的后端代理。'
  ].join('');
}

function parseMaybeJson(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readableError(error, fallback = '调用失败') {
  const parts = [
    error?.message,
    error?.msg,
    error?.errMsg,
    error?.code,
    error?.errCode,
    error?.error?.message,
    error?.error?.code
  ].filter(Boolean);
  if (parts.length) return parts.join(' ');
  try {
    const json = JSON.stringify(error);
    if (json && json !== '{}') return json;
  } catch {
    // Ignore serialization failures and use the fallback below.
  }
  const text = String(error || '');
  return text && text !== '[object Object]' ? text : fallback;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

async function getCloudbaseApp() {
  if (!cloudbaseAppPromise) {
    cloudbaseAppPromise = Promise.resolve().then(async () => {
      const { default: cloudbase } = await import('@cloudbase/js-sdk');
      const config = {
        env: TCB_ENV_ID,
        region: TCB_REGION
      };
      if (TCB_ACCESS_KEY) config.accessKey = TCB_ACCESS_KEY;
      const app = cloudbase.init(config);
      await ensureCloudbaseAuth(app);
      return app;
    });
  }
  return cloudbaseAppPromise;
}

async function ensureCloudbaseAuth(app) {
  const auth = typeof app.auth === 'function' ? app.auth({ persistence: 'local' }) : app.auth;
  if (!auth || TCB_ACCESS_KEY) return;

  const state = await (auth.hasLoginState?.() || auth.getLoginState?.()).catch(() => null);
  if (state) return;

  const provider = typeof auth.anonymousAuthProvider === 'function'
    ? auth.anonymousAuthProvider()
    : auth.anonymousAuthProvider;
  if (provider?.signIn) {
    await provider.signIn();
  }
}

async function classifyViaCloudbase(dataUrl, hint) {
  if (!TCB_ENABLED) return null;

  const compressed = await compressDataUrl(dataUrl);
  const app = await getCloudbaseApp();
  const response = await withTimeout(
    app.callFunction({
      name: TCB_FUNCTION_NAME,
      parse: true,
      data: {
        action: 'classifyImage',
        imageBase64: compressed.replace(/^data:[^,]+,/, ''),
        mimeType: 'image/jpeg',
        hint
      }
    }),
    30000,
    '调用小程序云函数混元识别超时'
  );
  const body = parseMaybeJson(response?.result) || {};
  if (!body.ok) {
    throw new Error(body.message || body.error || '小程序云函数 classifyImage 返回失败');
  }
  return normalizeRemoteData(body.data);
}

async function classifyViaHunyuan(dataUrl, hint) {
  if (!REMOTE_MODEL_ENDPOINT) {
    return null;
  }

  const compressed = await compressDataUrl(dataUrl);
  const response = await fetch(REMOTE_MODEL_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      imageBase64: compressed.replace(/^data:[^,]+,/, ''),
      mimeType: 'image/jpeg',
      hint
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.message || body.error || `混元识别接口返回 HTTP ${response.status}`);
  }
  return normalizeRemoteData(body.ok ? body.data : body);
}

export async function recognizeImageFile(file, hint = '') {
  const dataUrl = await fileToDataUrl(file);
  const textHint = `${hint || ''} ${file?.name || ''}`.trim();
  const errors = [];
  let data = null;

  try {
    data = await classifyViaCloudbase(dataUrl, textHint);
  } catch (error) {
    errors.push(`小程序云函数混元识别失败：${readableError(error)}`);
  }

  if (!data) {
    try {
      data = await classifyViaHunyuan(dataUrl, textHint);
    } catch (error) {
      errors.push(`后端混元代理识别失败：${readableError(error)}`);
    }
  }

  if (!data) {
    throw new Error(errors.length ? errors.join('；') : endpointRequiredMessage());
  }

  return {
    image: dataUrl,
    data,
    source: 'hunyuan'
  };
}
