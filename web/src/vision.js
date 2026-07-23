import { cloudbaseConfigured, cloudbaseFunctionName, getCloudbaseApp } from './cloudbaseClient.js';
import { sanitizeFoundItemPrivacy } from './privacy.js';

const TCB_ENABLED = import.meta.env.VITE_DISABLE_TCB_HUNYUAN !== 'true' && cloudbaseConfigured;
const REMOTE_MODEL_ENDPOINT = import.meta.env.VITE_MODEL_API_URL || import.meta.env.VITE_HUNYUAN_API_URL || '';
const REMOTE_MODEL_FALLBACK_ENABLED = import.meta.env.VITE_ENABLE_MODEL_API_FALLBACK === 'true';
const CLIENT_ID_KEY = 'lockmyitem_web_client_id';

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
    sensitivityLevel: payload.sensitivityLevel || 'normal',
    sensitivityReasons: payload.sensitivityReasons || [],
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
    '或在后端代理已完成认证和限流后，同时配置 VITE_MODEL_API_URL 与 VITE_ENABLE_MODEL_API_FALLBACK=true。'
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

function unwrapCloudFunctionResponse(response) {
  const candidates = [
    response?.result,
    response?.data,
    response
  ];

  for (const candidate of candidates) {
    const parsed = parseMaybeJson(candidate);
    if (parsed && typeof parsed === 'object' && ('ok' in parsed || 'data' in parsed || 'code' in parsed)) {
      return parsed;
    }
  }

  return {};
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
  if (parts.length) {
    const text = parts.join(' ');
    if (/FUNCTION_INVOCATION_FAILED|Function code exception caught|函数执行失败/i.test(text)) {
      return '云函数执行异常，请重新部署 lostfound（云端安装依赖）并查看云函数日志';
    }
    return text;
  }
  try {
    const json = JSON.stringify(error);
    if (json && json !== '{}') {
      if (/FUNCTION_INVOCATION_FAILED|Function code exception caught|函数执行失败/i.test(json)) {
        return '云函数执行异常，请重新部署 lostfound（云端安装依赖）并查看云函数日志';
      }
      return json;
    }
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

function getClientId() {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const value = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(CLIENT_ID_KEY, value);
    return value;
  } catch {
    return '';
  }
}

async function classifyViaCloudbase(imageDataUrl, hint, options = {}) {
  if (!TCB_ENABLED) return null;

  const app = await getCloudbaseApp();
  const response = await withTimeout(
    app.callFunction({
      name: cloudbaseFunctionName,
      parse: true,
      data: {
        action: 'classifyImage',
        imageBase64: imageDataUrl.replace(/^data:[^,]+,/, ''),
        mimeType: 'image/jpeg',
        clientId: getClientId(),
        hint,
        purpose: options.purpose || 'item',
        itemType: options.itemType || ''
      }
    }),
    30000,
    '调用 CloudBase 云函数混元识别超时'
  );
  const body = unwrapCloudFunctionResponse(response);
  if (!body.ok) {
    throw new Error(body.message || body.error || 'CloudBase 云函数 classifyImage 返回失败');
  }
  return normalizeRemoteData(body.data);
}

async function classifyViaHunyuan(imageDataUrl, hint, options = {}) {
  if (!REMOTE_MODEL_ENDPOINT || !REMOTE_MODEL_FALLBACK_ENABLED) {
    return null;
  }

  const response = await fetch(REMOTE_MODEL_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      imageBase64: imageDataUrl.replace(/^data:[^,]+,/, ''),
      mimeType: 'image/jpeg',
      hint,
      purpose: options.purpose || 'item',
      itemType: options.itemType || ''
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.message || body.error || `混元识别接口返回 HTTP ${response.status}`);
  }
  return normalizeRemoteData(body.ok ? body.data : body);
}

export async function recognizeImageFile(file, hint = '', options = {}) {
  const dataUrl = await fileToDataUrl(file);
  const compressed = await compressDataUrl(dataUrl, 960, 0.72);
  const textHint = `${hint || ''} ${file?.name || ''}`.trim();
  const errors = [];
  let data = null;

  try {
    data = await classifyViaCloudbase(compressed, textHint, options);
  } catch (error) {
    errors.push(`CloudBase 云函数混元识别失败：${readableError(error)}`);
  }

  if (!data) {
    try {
      data = await classifyViaHunyuan(compressed, textHint, options);
    } catch (error) {
      errors.push(`后端混元代理识别失败：${readableError(error)}`);
    }
  }

  if (!data) {
    throw new Error(errors.length ? errors.join('；') : endpointRequiredMessage());
  }

  if (options.itemType === 'found') {
    data = sanitizeFoundItemPrivacy({ ...data, type: 'found' });
  }

  return {
    image: compressed,
    data,
    source: 'hunyuan'
  };
}
