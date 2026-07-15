import crypto from 'node:crypto';

const HUNYUAN_BASE_URL = (process.env.HUNYUAN_BASE_URL || 'https://api.hunyuan.cloud.tencent.com/v1').replace(/\/$/, '');
const HUNYUAN_MODEL = process.env.HUNYUAN_MODEL || 'hunyuan-vision';
const DEFAULT_ALLOWED_ORIGINS = 'https://lockmyitem.asia,https://www.lockmyitem.asia';
const MODEL_PROXY_TOKEN = process.env.MODEL_PROXY_TOKEN || process.env.CLASSIFY_PROXY_TOKEN || '';
const REQUIRE_MODEL_PROXY_TOKEN = process.env.REQUIRE_MODEL_PROXY_TOKEN !== 'false';
const proxyRateBuckets = new Map();

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const PROXY_LIMITS = {
  maxBodyBytes: positiveNumber(process.env.CLASSIFY_MAX_BODY_BYTES, 6 * 1024 * 1024),
  maxImageBytes: positiveNumber(process.env.CLASSIFY_MAX_IMAGE_BYTES, 4 * 1024 * 1024),
  maxImageUrlLength: positiveNumber(process.env.CLASSIFY_MAX_IMAGE_URL_LENGTH, 2048),
  maxRequests: positiveNumber(process.env.CLASSIFY_RATE_LIMIT_MAX, 20),
  windowMs: positiveNumber(process.env.CLASSIFY_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000)
};

function ok(res, data) {
  return res.status(200).json({ ok: true, data });
}

function fail(res, status, message, code = 'ERROR') {
  return res.status(status).json({ ok: false, code, message });
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()] || req.headers[name];
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '');
}

function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGINS)
    .split(/[,\s]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin) {
  const allowed = getAllowedOrigins();
  return allowed.includes('*') || allowed.includes(origin);
}

function safeTokenEqual(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function getBearerToken(req) {
  const authorization = getHeader(req, 'authorization');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hasValidProxyToken(req) {
  const token = getBearerToken(req) || getHeader(req, 'x-model-proxy-token');
  return safeTokenEqual(token, MODEL_PROXY_TOKEN);
}

function checkProxyAccess(req) {
  if (REQUIRE_MODEL_PROXY_TOKEN) {
    if (!MODEL_PROXY_TOKEN) {
      return { status: 500, message: '服务端未配置 MODEL_PROXY_TOKEN，HTTP 图像识别代理默认关闭', code: 'PROXY_AUTH_NOT_CONFIGURED' };
    }
    if (!hasValidProxyToken(req)) {
      return { status: 401, message: '缺少有效的图像识别代理访问凭证', code: 'PROXY_UNAUTHORIZED' };
    }
    return null;
  }

  const origin = getHeader(req, 'origin');
  if (!origin || !isOriginAllowed(origin)) {
    return { status: 403, message: '当前来源无权调用图像识别代理', code: 'ORIGIN_FORBIDDEN' };
  }
  return null;
}

function estimateBase64Bytes(imageBase64 = '') {
  const raw = String(imageBase64 || '').replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  if (!raw) return 0;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((raw.length * 3) / 4) - padding);
}

function validatePayload(req, body = {}) {
  const contentLength = Number(getHeader(req, 'content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > PROXY_LIMITS.maxBodyBytes) {
    return { status: 413, message: '请求体过大，请压缩图片后再识别', code: 'BODY_TOO_LARGE' };
  }

  if (!body.imageUrl && !body.imageBase64) {
    return { status: 400, message: '缺少 imageBase64 或 imageUrl', code: 'IMAGE_REQUIRED' };
  }

  if (body.imageBase64 && estimateBase64Bytes(body.imageBase64) > PROXY_LIMITS.maxImageBytes) {
    return { status: 413, message: '图片过大，请压缩到 4MB 以内后再识别', code: 'IMAGE_TOO_LARGE' };
  }

  if (body.imageUrl) {
    const imageUrl = String(body.imageUrl);
    if (imageUrl.length > PROXY_LIMITS.maxImageUrlLength) {
      return { status: 400, message: '图片链接过长，请上传图片后再识别', code: 'IMAGE_URL_TOO_LONG' };
    }
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageUrl)
      && estimateBase64Bytes(imageUrl) > PROXY_LIMITS.maxImageBytes) {
      return { status: 413, message: '图片过大，请压缩到 4MB 以内后再识别', code: 'IMAGE_TOO_LARGE' };
    }
  }

  return null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function getTrustedRequestIp(req) {
  const forwarded = getHeader(req, 'x-forwarded-for');
  const platformIp = getHeader(req, 'x-real-ip')
    || getHeader(req, 'cf-connecting-ip')
    || getHeader(req, 'x-vercel-forwarded-for')
    || forwarded.split(',')[0]
    || req.socket?.remoteAddress
    || req.connection?.remoteAddress
    || 'unknown';
  return String(platformIp).split(',')[0].trim() || 'unknown';
}

function pruneProxyRateBuckets(nowMs) {
  if (proxyRateBuckets.size < 1000) return;
  for (const [key, bucket] of proxyRateBuckets.entries()) {
    if (bucket.resetAt <= nowMs) proxyRateBuckets.delete(key);
  }
}

function checkProxyRateLimit(req) {
  const nowMs = Date.now();
  pruneProxyRateBuckets(nowMs);
  const key = sha256([
    getTrustedRequestIp(req),
    getHeader(req, 'origin') || 'server',
    getHeader(req, 'user-agent').slice(0, 128)
  ].join('|'));
  const bucket = proxyRateBuckets.get(key);

  if (!bucket || bucket.resetAt <= nowMs) {
    proxyRateBuckets.set(key, { count: 1, resetAt: nowMs + PROXY_LIMITS.windowMs });
    return null;
  }

  if (bucket.count >= PROXY_LIMITS.maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
    return { status: 429, message: `图片识别请求过于频繁，请 ${retryAfter} 秒后再试`, code: 'RATE_LIMITED' };
  }

  bucket.count += 1;
  return null;
}

function unique(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeImageBase64(imageBase64 = '', mimeType = 'image/jpeg') {
  const value = String(imageBase64 || '').trim();
  if (!value) return '';
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value)) return value;
  return `data:${mimeType || 'image/jpeg'};base64,${value.replace(/^data:[^,]+,/, '')}`;
}

function parseJsonContent(content = '') {
  const source = String(content || '').trim();
  if (!source) return {};
  try {
    return JSON.parse(source);
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) return {};
    return JSON.parse(match[0]);
  }
}

function normalizeHunyuanResult(result = {}) {
  return {
    title: result.title || result.name || '',
    description: result.description || result.caption || result.visualDescription || '',
    category: result.category || '',
    aiTags: unique(result.aiTags || result.tags || result.keywords || []),
    yoloObjects: unique(result.yoloObjects || result.objects || []),
    semanticTags: unique(result.semanticTags || result.tags || []),
    colors: unique(result.colors || []),
    accessories: unique(result.accessories || []),
    imageEmbedding: result.imageEmbedding || result.image_embedding || [],
    semanticEmbedding: result.semanticEmbedding || result.semantic_embedding || result.embedding || []
  };
}

function buildVisionPrompt(hint = '', purpose = 'item') {
  if (purpose === 'locationDetail') {
    return [
      '你是上海科技大学校园失物招领系统的方位图片识别助手。',
      '请结合图片和用户补充描述，只提取可帮助同学定位物品所在位置的空间线索。',
      '重点描述入口、楼层、门牌、桌椅、楼梯、电梯、靠窗/靠路侧、附近标志物等信息。',
      '不要重复地点名称和地点区域，不要描述领取流程，不要提到评论区或联系发布人。',
      '必须只返回 JSON，不要 Markdown，不要解释。',
      'JSON 字段：title, description, category, tags, colors, accessories, objects。',
      'category 固定返回 其他。',
      'description 必须是一句简体中文方位描述，适合直接填入“补充具体方位”输入框。',
      'tags/objects 返回可用于定位的简短中文词语。',
      `用户补充描述：${hint || '无'}`
    ].join('\n');
  }

  return [
    '你是上海科技大学校园失物招领系统的图像识别助手。',
    '请结合图片和用户补充描述，提取可用于失物匹配的结构化标签。',
    '只提取物品信息，不要提到评论区、联系失主、领取流程或发布建议。',
    '必须只返回 JSON，不要 Markdown，不要解释。',
    'JSON 字段：title, description, category, tags, colors, accessories, objects。',
    'category 从以下中文类别中选择：证件、电子产品、书本资料、衣物、钥匙、校园卡、雨伞、水杯、其他。',
    'title/description/tags/colors/accessories/objects 必须使用简体中文。',
    `用户补充描述：${hint || '无'}`
  ].join('\n');
}

function withCors(req, res) {
  const origin = getHeader(req, 'origin');
  const allowedOrigins = getAllowedOrigins();
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,x-model-proxy-token');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  withCors(req, res);
  if (req.method === 'OPTIONS') {
    const origin = getHeader(req, 'origin');
    if (origin && !isOriginAllowed(origin)) {
      return fail(res, 403, '当前来源无权调用图像识别代理', 'ORIGIN_FORBIDDEN');
    }
    return res.status(204).end();
  }
  if (req.method !== 'POST') return fail(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED');

  const accessError = checkProxyAccess(req);
  if (accessError) return fail(res, accessError.status, accessError.message, accessError.code);

  const rateLimitError = checkProxyRateLimit(req);
  if (rateLimitError) return fail(res, rateLimitError.status, rateLimitError.message, rateLimitError.code);

  const apiKey = process.env.HUNYUAN_API_KEY
    || process.env.TENCENT_HUNYUAN_API_KEY
    || process.env.TENCENTCLOUD_API_KEY
    || process.env.MODEL_API_KEY
    || '';

  if (!apiKey) {
    return fail(res, 500, '服务端未配置 HUNYUAN_API_KEY', 'MODEL_NOT_CONFIGURED');
  }

  const body = req.body || {};
  const payloadError = validatePayload(req, body);
  if (payloadError) return fail(res, payloadError.status, payloadError.message, payloadError.code);
  const imageUrl = body.imageUrl || normalizeImageBase64(body.imageBase64, body.mimeType || 'image/jpeg');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${HUNYUAN_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: HUNYUAN_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl } },
              { type: 'text', text: buildVisionPrompt(body.hint, body.purpose || 'item') }
            ]
          }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error && (data.error.message || data.error.code);
      return fail(res, response.status, `混元识别失败${message ? `：${message}` : ''}`, 'HUNYUAN_FAILED');
    }

    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const semantic = normalizeHunyuanResult(parseJsonContent(content || ''));
    return ok(res, {
      title: semantic.title || semantic.category || '待识别物品',
      description: semantic.description || semantic.aiTags.join('、'),
      category: semantic.category || '其他',
      aiTags: unique([
        ...semantic.aiTags,
        ...semantic.colors,
        ...semantic.accessories,
        ...semantic.yoloObjects
      ]),
      yoloObjects: semantic.yoloObjects,
      semanticTags: semantic.semanticTags,
      visualDescription: semantic.description || semantic.aiTags.join('、'),
      imageEmbedding: semantic.imageEmbedding,
      semanticEmbedding: semantic.semanticEmbedding,
      modelSources: {
        provider: 'tencent-hunyuan-compatible',
        baseUrl: HUNYUAN_BASE_URL,
        model: HUNYUAN_MODEL
      }
    });
  } catch (error) {
    const message = error.name === 'AbortError' ? '混元识别超时' : (error.message || '混元识别失败');
    return fail(res, 502, message, 'HUNYUAN_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
