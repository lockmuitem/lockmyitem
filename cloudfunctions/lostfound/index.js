const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  users: 'users',
  items: 'items',
  comments: 'comments',
  thanks: 'thanks',
  notifications: 'notifications',
  reports: 'reports',
  locations: 'campus_locations',
  emailCodes: 'email_login_codes',
  rateLimits: 'classify_rate_limits'
};

const CATEGORY_KEYWORDS = {
  '证件': ['证件', '身份证', '学生证', '卡片', '护照'],
  '电子产品': ['手机', '电脑', '耳机', '充电器', '平板', '电子'],
  '书本资料': ['书', '教材', '笔记', '资料', '文件', '纸'],
  '衣物': ['衣服', '外套', '帽子', '围巾', '手套'],
  '钥匙': ['钥匙', '门禁'],
  '校园卡': ['校园卡', '一卡通', '饭卡'],
  '雨伞': ['伞', '雨伞'],
  '水杯': ['杯', '水杯', '保温杯']
};

const BAD_WORDS = ['辱骂', '广告', '诈骗', '加群'];

let cachedFetch = null;

const HUNYUAN_CONFIG = {
  apiKey: process.env.HUNYUAN_API_KEY
    || process.env.TENCENTCLOUD_API_KEY
    || process.env.TENCENT_HUNYUAN_API_KEY
    || process.env.MODEL_API_KEY
    || '',
  baseUrl: (process.env.HUNYUAN_BASE_URL || 'https://api.hunyuan.cloud.tencent.com/v1').replace(/\/$/, ''),
  model: process.env.HUNYUAN_MODEL || 'hunyuan-vision',
  secretId: process.env.TENCENTCLOUD_SECRET_ID || process.env.TENCENT_SECRET_ID || '',
  secretKey: process.env.TENCENTCLOUD_SECRET_KEY || process.env.TENCENT_SECRET_KEY || '',
  tencentEndpoint: (process.env.TENCENT_HUNYUAN_ENDPOINT || 'https://hunyuan.tencentcloudapi.com').replace(/\/$/, ''),
  tencentAction: 'ChatCompletions',
  tencentVersion: '2023-09-01',
  tencentService: 'hunyuan',
  tencentRegion: process.env.TENCENTCLOUD_REGION || process.env.TENCENT_REGION || ''
};

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const CLASSIFY_LIMITS = {
  maxImageBytes: positiveNumber(process.env.CLASSIFY_MAX_IMAGE_BYTES, 4 * 1024 * 1024),
  maxImageUrlLength: positiveNumber(process.env.CLASSIFY_MAX_IMAGE_URL_LENGTH, 2048),
  maxRequests: positiveNumber(process.env.CLASSIFY_RATE_LIMIT_MAX, 20),
  windowMs: positiveNumber(process.env.CLASSIFY_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000)
};

const AUTH_CONFIG = {
  emailDomain: (process.env.AUTH_EMAIL_DOMAIN || 'shanghaitech.edu.cn').toLowerCase(),
  tokenTtlMs: positiveNumber(process.env.AUTH_TOKEN_TTL_MS, 30 * 24 * 60 * 60 * 1000),
  codeTtlMs: positiveNumber(process.env.AUTH_CODE_TTL_MS, 10 * 60 * 1000),
  codeCooldownMs: positiveNumber(process.env.AUTH_CODE_COOLDOWN_MS, 30 * 1000),
  maxCodeAttempts: positiveNumber(process.env.AUTH_CODE_MAX_ATTEMPTS, 5),
  passwordIterations: positiveNumber(process.env.AUTH_PASSWORD_ITERATIONS, 120000),
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: positiveNumber(process.env.SMTP_PORT, 465),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  tokenSecret: process.env.AUTH_TOKEN_SECRET
    || HUNYUAN_CONFIG.apiKey
    || HUNYUAN_CONFIG.secretKey
    || process.env.TENCENT_SECRET_KEY
    || 'lockmyitem-dev-token-secret'
};

const MATCH_EMAIL_CONFIG = {
  threshold: positiveNumber(process.env.MATCH_EMAIL_THRESHOLD, 76),
  maxRecipients: positiveNumber(process.env.MATCH_EMAIL_MAX_RECIPIENTS, 5)
};

const classifyRateBuckets = new Map();
let rateLimitCollectionReady = false;
let rateLimitCollectionDisabled = false;
let emailCodeCollectionReady = false;
let emailCodeCollectionDisabled = false;

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ok(data = {}) {
  return { ok: true, data };
}

function fail(message, code = 'BAD_REQUEST') {
  return { ok: false, code, message };
}

function getFetch() {
  if (cachedFetch) return cachedFetch;
  try {
    const nodeFetch = require('node-fetch');
    cachedFetch = nodeFetch.default || nodeFetch;
    return cachedFetch;
  } catch (error) {
    if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
      cachedFetch = globalThis.fetch.bind(globalThis);
      return cachedFetch;
    }
    throw new Error(`云函数缺少 node-fetch 依赖，请使用“上传并部署：云端安装依赖”重新部署 lostfound：${error.message}`);
  }
}

function now() {
  return db.serverDate();
}

function classifyByText(text = '') {
  const source = text.toLowerCase();
  const categories = Object.keys(CATEGORY_KEYWORDS);
  for (let i = 0; i < categories.length; i += 1) {
    const category = categories[i];
    if (CATEGORY_KEYWORDS[category].some((word) => source.includes(word.toLowerCase()))) {
      return { category, aiTags: [category], confidence: 0.62 };
    }
  }
  return { category: '其他', aiTags: ['待确认'], confidence: 0 };
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    return value
      .split(/[,，、;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [value];
}

function unique(list) {
  return Array.from(new Set(toArray(list).map((item) => String(item || '').trim()).filter(Boolean)));
}

function tokenizeForMatch(text = '') {
  return unique(
    String(text || '')
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 2)
  );
}

function itemMatchSignature(item = {}) {
  return unique([
    item.category,
    ...toArray(item.aiTags),
    ...toArray(item.semanticTags),
    ...toArray(item.yoloObjects),
    ...toArray(item.tags),
    ...tokenizeForMatch(`${item.title || ''} ${item.description || ''} ${item.visualDescription || ''}`)
  ]);
}

function sharedCount(a = [], b = []) {
  const target = new Set(b);
  return a.filter((entry) => target.has(entry)).length;
}

function scoreLostFoundMatch(lostItem = {}, foundItem = {}) {
  const lostSignature = itemMatchSignature(lostItem);
  const foundSignature = itemMatchSignature(foundItem);
  const reasons = [];
  let score = 0;

  if (lostItem.category && foundItem.category && lostItem.category === foundItem.category) {
    score += 34;
    reasons.push(`同为${lostItem.category}`);
  }

  const sharedTags = lostSignature.filter((entry) => foundSignature.includes(entry));
  if (sharedTags.length) {
    score += Math.min(sharedTags.length * 9, 36);
    reasons.push(`特征相近：${sharedTags.slice(0, 4).join('、')}`);
  }

  if (lostItem.locationId && foundItem.locationId && lostItem.locationId === foundItem.locationId) {
    score += 12;
    reasons.push('地点一致');
  } else if (lostItem.locationName && foundItem.locationName && lostItem.locationName === foundItem.locationName) {
    score += 10;
    reasons.push('地点相近');
  }

  const lostText = tokenizeForMatch(`${lostItem.title || ''} ${lostItem.description || ''}`);
  const foundText = tokenizeForMatch(`${foundItem.title || ''} ${foundItem.description || ''}`);
  const textHits = sharedCount(lostText, foundText);
  if (textHits) {
    score += Math.min(textHits * 5, 17);
  }

  return {
    similarity: Math.min(score, 99),
    reasons: unique(reasons).slice(0, 3)
  };
}

function itemLocationText(item = {}) {
  return unique([
    item.locationName,
    item.locationArea,
    item.locationDetail || item.locationGuide
  ]).join('，') || '未填写地点';
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseJsonContent(content = '') {
  const cleaned = String(content)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('混元未返回可解析的 JSON');
  return JSON.parse(match[0]);
}

function normalizeHunyuanResult(result = {}) {
  return {
    title: result.title || result.name || '',
    description: result.description || result.caption || result.visualDescription || '',
    category: result.category || '',
    tags: unique(result.tags || result.aiTags || result.keywords || []),
    colors: unique(result.colors || []),
    accessories: unique(result.accessories || []),
    objects: unique(result.objects || result.yoloObjects || []),
    imageEmbedding: result.imageEmbedding || result.image_embedding || [],
    semanticEmbedding: result.semanticEmbedding || result.semantic_embedding || result.embedding || []
  };
}

function normalizeImageBase64(imageBase64 = '', mimeType = 'image/jpeg') {
  const value = String(imageBase64 || '').trim();
  if (!value) return '';
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value)) return value;
  return `data:${mimeType || 'image/jpeg'};base64,${value.replace(/^data:[^,]+,/, '')}`;
}

function normalizeImageUrl(imageUrl = '') {
  const value = String(imageUrl || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const embeddedUrl = parsed.searchParams.get('mediaurl')
      || parsed.searchParams.get('imgurl')
      || parsed.searchParams.get('url');
    if (embeddedUrl && /^https?:\/\//i.test(embeddedUrl)) {
      return embeddedUrl;
    }
  } catch (error) {
    void error;
    // Keep the original value so callers still get a helpful model/provider error.
  }
  return value;
}

function estimateBase64Bytes(imageBase64 = '') {
  const raw = String(imageBase64 || '').replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  if (!raw) return 0;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((raw.length * 3) / 4) - padding);
}

function validateClassifyImagePayload(event = {}) {
  if (!event.fileId && !event.imageUrl && !event.imageBase64) {
    return fail('缺少图片 fileId、imageUrl 或 imageBase64');
  }

  if (event.imageBase64) {
    const size = estimateBase64Bytes(event.imageBase64);
    if (size > CLASSIFY_LIMITS.maxImageBytes) {
      return fail('图片过大，请压缩到 4MB 以内后再识别', 'IMAGE_TOO_LARGE');
    }
  }

  if (event.imageUrl && String(event.imageUrl).length > CLASSIFY_LIMITS.maxImageUrlLength) {
    return fail('图片链接过长，请上传图片后再识别', 'IMAGE_URL_TOO_LONG');
  }

  return null;
}

function isDataImageUrl(value = '') {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(String(value || '').trim());
}

function isCloudFileId(value = '') {
  return /^cloud:\/\//i.test(String(value || '').trim());
}

function isHttpUrl(value = '') {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function extensionFromMimeType(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  return 'jpg';
}

function parseDataImageUrl(value = '') {
  const match = String(value || '').trim().match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('图片内容为空');
  if (buffer.length > CLASSIFY_LIMITS.maxImageBytes) {
    throw new Error('图片过大，请压缩到 4MB 以内后再发布');
  }

  return {
    buffer,
    mimeType,
    extension: extensionFromMimeType(mimeType)
  };
}

async function uploadItemDataImage(dataUrl, actorId = '') {
  const parsed = parseDataImageUrl(dataUrl);
  if (!parsed) return '';
  const safeActorId = sha256(actorId || 'anonymous').slice(0, 16);
  const random = crypto.randomBytes(8).toString('hex');
  const cloudPath = `lostfound/items/${safeActorId}/${Date.now()}-${random}.${parsed.extension}`;
  const result = await cloud.uploadFile({
    cloudPath,
    fileContent: parsed.buffer
  });
  return result.fileID || result.fileId || '';
}

async function prepareItemImages(imageUrls = [], actorId = '') {
  const imageFileIds = [];
  const publicImageUrls = [];
  const sources = unique(imageUrls).slice(0, 6);

  for (const source of sources) {
    const value = String(source || '').trim();
    if (!value) continue;

    if (isDataImageUrl(value)) {
      const fileId = await uploadItemDataImage(value, actorId);
      if (fileId) imageFileIds.push(fileId);
      continue;
    }

    if (isCloudFileId(value)) {
      imageFileIds.push(value);
      continue;
    }

    if (isHttpUrl(value)) publicImageUrls.push(value);
  }

  return {
    imageFileIds: unique(imageFileIds),
    imageUrls: unique(publicImageUrls)
  };
}

async function resolveTempFileUrlMap(fileIds = []) {
  const ids = unique(fileIds).filter(isCloudFileId);
  if (!ids.length) return {};

  try {
    const result = await cloud.getTempFileURL({ fileList: ids });
    const map = {};
    (result.fileList || []).forEach((file) => {
      const fileId = file.fileID || file.fileId;
      const url = file.tempFileURL || file.download_url;
      if (fileId && url) map[fileId] = url;
    });
    return map;
  } catch (error) {
    console.warn('Failed to resolve CloudBase image temp URLs.', error);
    return {};
  }
}

async function hydrateItemImages(items = []) {
  const list = Array.isArray(items) ? items : [items];
  const allFileIds = [];
  list.forEach((item) => {
    allFileIds.push(...(item.imageFileIds || []));
    allFileIds.push(...(item.imageUrls || []).filter(isCloudFileId));
  });
  const tempUrlMap = await resolveTempFileUrlMap(allFileIds);

  return list.map((item) => {
    const imageFileIds = unique([
      ...(item.imageFileIds || []),
      ...(item.imageUrls || []).filter(isCloudFileId)
    ]);
    const tempUrls = imageFileIds.map((fileId) => tempUrlMap[fileId]).filter(Boolean);
    const publicUrls = (item.imageUrls || []).filter((url) => (
      isHttpUrl(url) && !isDataImageUrl(url) && !isCloudFileId(url)
    ));
    const imageUrls = unique([...tempUrls, ...publicUrls]);

    return {
      ...item,
      imageFileIds,
      imageUrls,
      thumbUrl: imageUrls[0] || item.thumbUrl || ''
    };
  });
}

function pruneClassifyRateBuckets(nowMs) {
  if (classifyRateBuckets.size < 1000) return;
  for (const [key, bucket] of classifyRateBuckets.entries()) {
    if (bucket.resetAt <= nowMs) classifyRateBuckets.delete(key);
  }
}

function firstTrustedContextValue(context = {}, keys = []) {
  for (const key of keys) {
    const value = context[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function getClassifyRateKey(event = {}, context = {}) {
  void event;
  const serverIdentity = firstTrustedContextValue(context, [
    'OPENID',
    'UNIONID',
    'UID',
    'TCB_UUID',
    'TcbUuid'
  ]);
  const clientIp = firstTrustedContextValue(context, [
    'CLIENTIP',
    'CLIENT_IP',
    'SOURCE_IP',
    'REMOTE_ADDR'
  ]);
  const identity = serverIdentity || (clientIp ? `ip:${clientIp}` : 'anonymous');
  const source = firstTrustedContextValue(context, ['SOURCE', 'ENV', 'APPID']) || 'cloudbase';
  return sha256(`${identity}|${source}|${context.APPID || context.ENV || ''}`);
}

function getWebClientActorId(event = {}) {
  const clientId = String(event.clientId || '').trim();
  if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(clientId)) return '';
  return `web:${sha256(clientId)}`;
}

function getActorId(context = {}, event = {}) {
  const trustedActor = firstTrustedContextValue(context, [
    'OPENID',
    'UNIONID',
    'UID',
    'TCB_UUID',
    'TcbUuid'
  ]);
  if (trustedActor) return trustedActor;
  const tokenPayload = verifyAuthToken(event.authToken);
  if (tokenPayload && tokenPayload.sub) return tokenPayload.sub;
  return getWebClientActorId(event);
}

function requireActorId(context = {}, event = {}) {
  const actorId = getActorId(context, event);
  if (!actorId) {
    return { error: fail('无法识别当前用户，请刷新页面后重试', 'AUTH_REQUIRED') };
  }
  return { actorId };
}

function checkClassifyRateLimit(event = {}, context = {}) {
  const nowMs = Date.now();
  pruneClassifyRateBuckets(nowMs);
  const key = getClassifyRateKey(event, context);
  const bucket = classifyRateBuckets.get(key);

  if (!bucket || bucket.resetAt <= nowMs) {
    classifyRateBuckets.set(key, { count: 1, resetAt: nowMs + CLASSIFY_LIMITS.windowMs });
    return null;
  }

  if (bucket.count >= CLASSIFY_LIMITS.maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
    return fail(`图片识别请求过于频繁，请 ${retryAfter} 秒后再试`, 'RATE_LIMITED');
  }

  bucket.count += 1;
  return null;
}

function isAlreadyExistsError(error) {
  const text = `${error && (error.errCode || error.code || '')} ${error && (error.errMsg || error.message || '')}`;
  return /already|exist|EXISTS|DATABASE_COLLECTION_ALREADY_EXISTS/i.test(text);
}

function isNotFoundError(error) {
  const text = `${error && (error.errCode || error.code || '')} ${error && (error.errMsg || error.message || '')}`;
  return /not.?found|not.?exist|NOT_FOUND|DOCUMENT_NOT_EXIST/i.test(text);
}

async function ensureRateLimitCollection() {
  if (rateLimitCollectionReady) return true;
  if (rateLimitCollectionDisabled) return false;

  try {
    await db.createCollection(COLLECTIONS.rateLimits);
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      rateLimitCollectionDisabled = true;
      return false;
    }
  }

  rateLimitCollectionReady = true;
  return true;
}

async function checkPersistentClassifyRateLimit(event = {}, context = {}) {
  const ready = await ensureRateLimitCollection();
  if (!ready) return checkClassifyRateLimit(event, context);

  const nowMs = Date.now();
  const key = getClassifyRateKey(event, context);
  const resetAt = nowMs + CLASSIFY_LIMITS.windowMs;

  return db.runTransaction(async (transaction) => {
    const doc = transaction.collection(COLLECTIONS.rateLimits).doc(key);
    let current = null;

    try {
      const result = await doc.get();
      current = result && result.data ? result.data : null;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    if (!current || !current.resetAt || current.resetAt <= nowMs) {
      await doc.set({
        data: {
          count: 1,
          resetAt,
          updatedAt: now()
        }
      });
      return null;
    }

    if ((current.count || 0) >= CLASSIFY_LIMITS.maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000));
      return fail(`图片识别请求过于频繁，请 ${retryAfter} 秒后再试`, 'RATE_LIMITED');
    }

    await doc.update({
      data: {
        count: _.inc(1),
        updatedAt: now()
      }
    });
    return null;
  });
}

async function ensureEmailCodeCollection() {
  if (emailCodeCollectionReady) return true;
  if (emailCodeCollectionDisabled) return false;

  try {
    await db.createCollection(COLLECTIONS.emailCodes);
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      emailCodeCollectionDisabled = true;
      return false;
    }
  }

  emailCodeCollectionReady = true;
  return true;
}

function sha256(value, encoding = 'hex') {
  return crypto.createHash('sha256').update(value, 'utf8').digest(encoding);
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function safeEqual(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeShanghaiTechEmail(email = '') {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '';
  return value.endsWith(`@${AUTH_CONFIG.emailDomain}`) ? value : '';
}

function emailHash(email = '') {
  return sha256(normalizeShanghaiTechEmail(email));
}

function sanitizeNickName(value = '', fallback = '网页用户') {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  return (text || fallback).slice(0, 40);
}

function publicEmailUser(user = {}, token = '') {
  return {
    id: user._id || user.id || user.actorId || '',
    actorId: user._openid || user.actorId || '',
    nickName: sanitizeNickName(user.nickName || user.emailPrefix),
    contact: user.email || user.contact || '',
    email: user.email || user.contact || '',
    authProvider: user.authProvider || 'email',
    createdAt: user.createdAt || '',
    authToken: token || ''
  };
}

function createPasswordHash(password = '') {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, AUTH_CONFIG.passwordIterations, 32, 'sha256').toString('hex');
  return { passwordSalt: salt, passwordHash: hash };
}

function verifyPassword(password = '', user = {}) {
  if (!user.passwordSalt || !user.passwordHash) return false;
  const hash = crypto.pbkdf2Sync(String(password), user.passwordSalt, AUTH_CONFIG.passwordIterations, 32, 'sha256').toString('hex');
  return safeEqual(hash, user.passwordHash);
}

function createAuthToken(user = {}) {
  const email = normalizeShanghaiTechEmail(user.email || user.contact || '');
  const actorId = user._openid || user.actorId || `email:${emailHash(email)}`;
  const payload = {
    sub: actorId,
    email,
    name: sanitizeNickName(user.nickName || email.split('@')[0]),
    exp: Date.now() + AUTH_CONFIG.tokenTtlMs
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(AUTH_CONFIG.tokenSecret, body, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${body}.${signature}`;
}

function verifyAuthToken(token = '') {
  const value = String(token || '').trim();
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const expected = hmac(AUTH_CONFIG.tokenSecret, parts[0], 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  if (!safeEqual(expected, parts[1])) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[0]));
    if (!payload.sub || !payload.exp || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function formatUtcDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function signTencentCloudRequest(payloadText, timestamp) {
  const endpointHost = new URL(HUNYUAN_CONFIG.tencentEndpoint).host;
  const date = formatUtcDate(timestamp);
  const canonicalHeaders = [
    'content-type:application/json; charset=utf-8',
    `host:${endpointHost}`,
    `x-tc-action:${HUNYUAN_CONFIG.tencentAction.toLowerCase()}`
  ].join('\n') + '\n';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(payloadText)
  ].join('\n');
  const credentialScope = `${date}/${HUNYUAN_CONFIG.tencentService}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');
  const secretDate = hmac(`TC3${HUNYUAN_CONFIG.secretKey}`, date);
  const secretService = hmac(secretDate, HUNYUAN_CONFIG.tencentService);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  return [
    `TC3-HMAC-SHA256 Credential=${HUNYUAN_CONFIG.secretId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(', ');
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

async function callOpenAICompatibleHunyuanVision(payload) {
  const fetchClient = getFetch();
  const endpoint = `${HUNYUAN_CONFIG.baseUrl}/chat/completions`;
  const prompt = buildVisionPrompt(payload.hint, payload.purpose);

  const response = await fetchClient(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${HUNYUAN_CONFIG.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: HUNYUAN_CONFIG.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: payload.imageUrl } },
            { type: 'text', text: prompt }
          ]
        }
      ],
      temperature: 0.2
    }),
    timeout: 30000
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error && (data.error.message || data.error.code);
    throw new Error(`混元识别失败 ${response.status}${message ? `: ${message}` : ''}`);
  }
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return normalizeHunyuanResult(parseJsonContent(content || ''));
}

async function callTencentCloudHunyuanVision(payload) {
  const fetchClient = getFetch();
  const endpointHost = new URL(HUNYUAN_CONFIG.tencentEndpoint).host;
  const requestBody = {
    Model: HUNYUAN_CONFIG.model,
    Stream: false,
    Temperature: 0.2,
    Messages: [
      {
        Role: 'user',
        Contents: [
          { Type: 'text', Text: buildVisionPrompt(payload.hint, payload.purpose) },
          { Type: 'image_url', ImageUrl: { Url: payload.imageUrl } }
        ]
      }
    ]
  };
  const payloadText = JSON.stringify(requestBody);
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = {
    authorization: signTencentCloudRequest(payloadText, timestamp),
    'content-type': 'application/json; charset=utf-8',
    host: endpointHost,
    'x-tc-action': HUNYUAN_CONFIG.tencentAction,
    'x-tc-timestamp': String(timestamp),
    'x-tc-version': HUNYUAN_CONFIG.tencentVersion
  };
  if (HUNYUAN_CONFIG.tencentRegion) headers['x-tc-region'] = HUNYUAN_CONFIG.tencentRegion;

  const response = await fetchClient(HUNYUAN_CONFIG.tencentEndpoint, {
    method: 'POST',
    headers,
    body: payloadText,
    timeout: 30000
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.Response && data.Response.Error)) {
    const error = data.Response && data.Response.Error;
    const message = error && (error.Message || error.Code);
    throw new Error(`混元识别失败 ${response.status}${message ? `: ${message}` : ''}`);
  }
  const choices = (data.Response && data.Response.Choices) || data.Choices || [];
  const content = choices[0] && choices[0].Message && choices[0].Message.Content;
  return normalizeHunyuanResult(parseJsonContent(content || ''));
}

async function callHunyuanVision(payload) {
  if (HUNYUAN_CONFIG.secretId && HUNYUAN_CONFIG.secretKey) {
    return callTencentCloudHunyuanVision(payload);
  }
  return callOpenAICompatibleHunyuanVision(payload);
}

function mapTagsToCategory(tags = [], hint = '') {
  const source = `${tags.join(' ')} ${hint}`.toLowerCase();
  const categories = Object.keys(CATEGORY_KEYWORDS);
  for (let i = 0; i < categories.length; i += 1) {
    const category = categories[i];
    if (CATEGORY_KEYWORDS[category].some((word) => source.includes(word.toLowerCase()))) {
      return category;
    }
  }
  return '其他';
}

async function ensureUser(openid, profile = {}) {
  const userResult = await db.collection(COLLECTIONS.users).where({ _openid: openid }).limit(1).get();
  if (userResult.data.length) {
    return userResult.data[0];
  }
  const user = {
    nickName: profile.nickName || '微信用户',
    avatarUrl: profile.avatarUrl || '',
    createdAt: now(),
    updatedAt: now()
  };
  const created = await db.collection(COLLECTIONS.users).add({ data: user });
  return { _id: created._id, _openid: openid, ...user };
}

async function getEmailUser(email) {
  const normalized = normalizeShanghaiTechEmail(email);
  if (!normalized) return null;
  const result = await db.collection(COLLECTIONS.users)
    .where({ emailHash: emailHash(normalized), authProvider: 'email' })
    .limit(1)
    .get();
  return (result.data || [])[0] || null;
}

async function getUserByActorId(actorId = '') {
  const id = String(actorId || '').trim();
  if (!id) return null;
  try {
    const result = await db.collection(COLLECTIONS.users).where({ _openid: id }).limit(1).get();
    return (result.data || [])[0] || null;
  } catch (error) {
    console.warn('Failed to load user for email notification.', error && (error.message || error));
    return null;
  }
}

function userEmail(user = {}) {
  const profile = user || {};
  return normalizeShanghaiTechEmail(profile.email || profile.contact || '');
}

function userDisplayName(user = {}, fallback = '网页用户') {
  const profile = user || {};
  return sanitizeNickName(profile.nickName || profile.emailPrefix || fallback, fallback);
}

async function sendTransactionalEmail({ to, subject, text, html }) {
  if (!AUTH_CONFIG.smtpHost || !AUTH_CONFIG.smtpUser || !AUTH_CONFIG.smtpPass || !AUTH_CONFIG.smtpFrom) {
    throw new Error('邮件服务未配置，请在云函数环境变量中配置 SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM');
  }
  const recipient = normalizeShanghaiTechEmail(to);
  if (!recipient) throw new Error('缺少有效的上科大邮箱收件人');
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (error) {
    throw new Error(`云函数缺少 nodemailer 依赖，请重新安装并部署依赖：${error.message}`);
  }
  const transporter = nodemailer.createTransport({
    host: AUTH_CONFIG.smtpHost,
    port: AUTH_CONFIG.smtpPort,
    secure: AUTH_CONFIG.smtpPort === 465,
    auth: {
      user: AUTH_CONFIG.smtpUser,
      pass: AUTH_CONFIG.smtpPass
    }
  });
  await transporter.sendMail({
    from: AUTH_CONFIG.smtpFrom,
    to: recipient,
    subject,
    text,
    html
  });
}

async function sendEmailViaSmtp(to, code) {
  await sendTransactionalEmail({
    to,
    subject: 'LockMyItem 上科大失物招领验证码',
    text: `你的验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略本邮件。`,
    html: `<p>你的验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${escapeHtml(code)}</p><p>10 分钟内有效。若非本人操作，请忽略本邮件。</p>`
  });
}

async function sendEmailCode(event) {
  const email = normalizeShanghaiTechEmail(event.email);
  if (!email) return fail(`请使用 @${AUTH_CONFIG.emailDomain} 邮箱`, 'INVALID_EMAIL');
  const ready = await ensureEmailCodeCollection();
  if (!ready) return fail('验证码存储未就绪，请先在云开发数据库创建 email_login_codes 集合', 'EMAIL_CODE_STORE_ERROR');
  const purpose = event.purpose === 'register' ? 'register' : 'login';
  const existed = await getEmailUser(email);
  if (purpose === 'login' && !existed) {
    return fail('该邮箱尚未注册，请先注册账号', 'EMAIL_NOT_REGISTERED');
  }
  if (purpose === 'register' && existed) {
    return fail('该邮箱已注册，可切换到登录并使用密码或验证码登录', 'EMAIL_EXISTS');
  }

  const hashedEmail = emailHash(email);
  const nowMs = Date.now();
  const recent = await db.collection(COLLECTIONS.emailCodes)
    .where({ emailHash: hashedEmail })
    .orderBy('createdAtMs', 'desc')
    .limit(1)
    .get();
  const latest = (recent.data || [])[0];
  if (latest && latest.createdAtMs && nowMs - latest.createdAtMs < AUTH_CONFIG.codeCooldownMs) {
    return fail('验证码发送过于频繁，请稍后再试', 'CODE_COOLDOWN');
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(12).toString('hex');
  const data = {
    emailHash: hashedEmail,
    codeHash: sha256(`${email}:${code}:${salt}`),
    codeSalt: salt,
    purpose,
    attempts: 0,
    used: false,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + AUTH_CONFIG.codeTtlMs,
    createdAt: now()
  };

  const created = await db.collection(COLLECTIONS.emailCodes).add({ data });
  try {
    await sendEmailViaSmtp(email, code);
  } catch (error) {
    if (created && created._id) {
      await db.collection(COLLECTIONS.emailCodes).doc(created._id).update({
        data: { used: true, failedAt: now(), updatedAt: now() }
      }).catch(() => null);
    }
    return fail(error.message || '验证码邮件发送失败', 'EMAIL_SEND_FAILED');
  }

  return ok({ email, expiresInSeconds: Math.floor(AUTH_CONFIG.codeTtlMs / 1000) });
}

async function verifyEmailCode(email, code) {
  const normalized = normalizeShanghaiTechEmail(email);
  const value = String(code || '').trim();
  if (!normalized || !/^\d{6}$/.test(value)) return fail('验证码格式不正确', 'INVALID_CODE');
  const ready = await ensureEmailCodeCollection();
  if (!ready) return fail('验证码存储未就绪', 'EMAIL_CODE_STORE_ERROR');

  const nowMs = Date.now();
  const result = await db.collection(COLLECTIONS.emailCodes)
    .where({ emailHash: emailHash(normalized), used: false })
    .orderBy('createdAtMs', 'desc')
    .limit(5)
    .get();
  const record = (result.data || []).find((entry) => entry.expiresAtMs && entry.expiresAtMs >= nowMs);
  if (!record) return fail('验证码已过期或不存在，请重新获取', 'CODE_EXPIRED');
  if ((record.attempts || 0) >= AUTH_CONFIG.maxCodeAttempts) {
    return fail('验证码尝试次数过多，请重新获取', 'CODE_LOCKED');
  }
  const expected = sha256(`${normalized}:${value}:${record.codeSalt}`);
  if (!safeEqual(expected, record.codeHash)) {
    await db.collection(COLLECTIONS.emailCodes).doc(record._id).update({
      data: { attempts: _.inc(1), updatedAt: now() }
    });
    return fail('验证码不正确', 'INVALID_CODE');
  }
  await db.collection(COLLECTIONS.emailCodes).doc(record._id).update({
    data: { used: true, usedAt: now(), updatedAt: now() }
  });
  return null;
}

async function createEmailUser({ email, password = '', nickName = '' }) {
  const normalized = normalizeShanghaiTechEmail(email);
  if (!normalized) return null;
  const actorId = `email:${emailHash(normalized)}`;
  const passwordData = password ? createPasswordHash(password) : {};
  const data = {
    _openid: actorId,
    authProvider: 'email',
    email: normalized,
    emailHash: emailHash(normalized),
    emailPrefix: normalized.split('@')[0],
    nickName: sanitizeNickName(nickName || normalized.split('@')[0]),
    avatarUrl: '',
    ...passwordData,
    createdAt: now(),
    updatedAt: now()
  };
  const created = await db.collection(COLLECTIONS.users).add({ data });
  return { _id: created._id, ...data };
}

async function registerWithEmail(event) {
  const email = normalizeShanghaiTechEmail(event.email);
  const password = String(event.password || '');
  if (!email) return fail(`请使用 @${AUTH_CONFIG.emailDomain} 邮箱`, 'INVALID_EMAIL');
  if (password.length < 6) return fail('密码至少需要 6 位', 'WEAK_PASSWORD');
  const existed = await getEmailUser(email);
  if (existed) return fail('该邮箱已注册，请直接登录', 'EMAIL_EXISTS');
  const codeError = await verifyEmailCode(email, event.code);
  if (codeError) return codeError;
  const user = await createEmailUser({ email, password, nickName: event.nickName });
  const token = createAuthToken(user);
  return ok(publicEmailUser(user, token));
}

async function loginWithEmailPassword(event) {
  const email = normalizeShanghaiTechEmail(event.email);
  if (!email) return fail(`请使用 @${AUTH_CONFIG.emailDomain} 邮箱`, 'INVALID_EMAIL');
  const user = await getEmailUser(email);
  if (!user || !verifyPassword(event.password, user)) {
    return fail('邮箱或密码不正确', 'INVALID_CREDENTIALS');
  }
  const token = createAuthToken(user);
  return ok(publicEmailUser(user, token));
}

async function loginWithEmailCode(event) {
  const email = normalizeShanghaiTechEmail(event.email);
  if (!email) return fail(`请使用 @${AUTH_CONFIG.emailDomain} 邮箱`, 'INVALID_EMAIL');
  const user = await getEmailUser(email);
  if (!user) {
    return fail('该邮箱尚未注册，请先完成注册', 'EMAIL_NOT_REGISTERED');
  }
  const codeError = await verifyEmailCode(email, event.code);
  if (codeError) return codeError;
  const token = createAuthToken(user);
  return ok(publicEmailUser(user, token));
}

async function createNotification(userOpenid, type, content, itemId, actorOpenid) {
  if (!userOpenid) return null;
  return db.collection(COLLECTIONS.notifications).add({
    data: {
      userOpenid,
      type,
      itemId,
      actorOpenid,
      content,
      read: false,
      createdAt: now()
    }
  });
}

async function notifyOwnerItemClaimed(item = {}, claimantUser = {}, claimData = {}) {
  const ownerUser = await getUserByActorId(item.ownerOpenid);
  const ownerEmail = userEmail(ownerUser);
  if (!ownerEmail) return { sent: false, reason: 'OWNER_EMAIL_MISSING' };

  const claimantName = claimData.claimantName || userDisplayName(claimantUser);
  const claimantEmail = userEmail(claimantUser) || normalizeShanghaiTechEmail(claimData.claimantContact);
  const title = item.title || '未命名物品';
  const location = itemLocationText(item);
  const subject = `LockMyItem：你的招领物品「${title}」已被认领`;
  const text = [
    `你好，${userDisplayName(ownerUser)}：`,
    '',
    `你发布的招领物品「${title}」已被 ${claimantName} 认领。`,
    `领取者账号/邮箱：${claimantEmail || claimData.claimantContact || '未提供'}`,
    `物品地点：${location}`,
    '',
    '如有疑问，请回到 LockMyItem 查看详情。'
  ].join('\n');
  const html = `
    <p>你好，${escapeHtml(userDisplayName(ownerUser))}：</p>
    <p>你发布的招领物品 <strong>「${escapeHtml(title)}」</strong> 已被 <strong>${escapeHtml(claimantName)}</strong> 认领。</p>
    <ul>
      <li>领取者账号/邮箱：${escapeHtml(claimantEmail || claimData.claimantContact || '未提供')}</li>
      <li>物品地点：${escapeHtml(location)}</li>
    </ul>
    <p>如有疑问，请回到 LockMyItem 查看详情。</p>
  `;

  await sendTransactionalEmail({ to: ownerEmail, subject, text, html });
  return { sent: true, to: ownerEmail };
}

async function notifyLostOwnersAboutFoundMatch(foundItem = {}, finderUser = {}) {
  if (foundItem.type !== 'found' || foundItem.status !== 'active') return [];
  const finderEmail = userEmail(finderUser);
  const finderName = userDisplayName(finderUser, foundItem.ownerName || '招领发布者');
  const result = await db.collection(COLLECTIONS.items)
    .where({ type: 'lost', status: 'active' })
    .orderBy('createdAt', 'desc')
    .limit(80)
    .get();

  const matches = (result.data || [])
    .filter((lostItem) => lostItem.ownerOpenid && lostItem.ownerOpenid !== foundItem.ownerOpenid)
    .map((lostItem) => {
      const match = scoreLostFoundMatch(lostItem, foundItem);
      return { lostItem, ...match };
    })
    .filter((entry) => entry.similarity >= MATCH_EMAIL_CONFIG.threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MATCH_EMAIL_CONFIG.maxRecipients);

  const sent = [];
  for (const match of matches) {
    const lostOwner = await getUserByActorId(match.lostItem.ownerOpenid);
    const lostOwnerEmail = userEmail(lostOwner);
    if (!lostOwnerEmail) continue;
    const lostTitle = match.lostItem.title || '你的寻物线索';
    const foundTitle = foundItem.title || '一件招领物品';
    const location = itemLocationText(foundItem);
    const reasonText = match.reasons.length ? match.reasons.join('、') : '物品特征相似';
    const subject = `LockMyItem：可能找到你的「${lostTitle}」`;
    const text = [
      `你好，${userDisplayName(lostOwner)}：`,
      '',
      `有一条新的招领信息和你的寻物「${lostTitle}」相似度较高。`,
      `招领物品：${foundTitle}`,
      `匹配相似度：${match.similarity}%`,
      `匹配理由：${reasonText}`,
      `招领地点：${location}`,
      `招领发布者：${finderName}`,
      `发布者邮箱：${finderEmail || '未提供'}`,
      '',
      '请回到 LockMyItem 查看详情并确认是否为你的物品。'
    ].join('\n');
    const html = `
      <p>你好，${escapeHtml(userDisplayName(lostOwner))}：</p>
      <p>有一条新的招领信息和你的寻物 <strong>「${escapeHtml(lostTitle)}」</strong> 相似度较高。</p>
      <ul>
        <li>招领物品：${escapeHtml(foundTitle)}</li>
        <li>匹配相似度：${escapeHtml(String(match.similarity))}%</li>
        <li>匹配理由：${escapeHtml(reasonText)}</li>
        <li>招领地点：${escapeHtml(location)}</li>
        <li>招领发布者：${escapeHtml(finderName)}</li>
        <li>发布者邮箱：${escapeHtml(finderEmail || '未提供')}</li>
      </ul>
      <p>请回到 LockMyItem 查看详情并确认是否为你的物品。</p>
    `;

    try {
      await sendTransactionalEmail({ to: lostOwnerEmail, subject, text, html });
      await createNotification(
        match.lostItem.ownerOpenid,
        'match',
        `新的招领「${foundTitle}」可能匹配你的寻物「${lostTitle}」`,
        foundItem._id || foundItem.id,
        foundItem.ownerOpenid
      ).catch(() => null);
      sent.push({ itemId: match.lostItem._id, to: lostOwnerEmail, similarity: match.similarity });
    } catch (error) {
      console.warn('Failed to send match email notification.', error && (error.message || error));
    }
  }
  return sent;
}

async function login(event, context) {
  const actor = requireActorId(context, event);
  if (actor.error) return actor.error;
  const user = await ensureUser(actor.actorId, event.profile || {});
  return ok(user);
}

async function listLocations(event) {
  const keyword = (event.keyword || '').trim();
  const query = { enabled: true };
  if (keyword) {
    query.name = db.RegExp({ regexp: keyword, options: 'i' });
  }
  const result = await db.collection(COLLECTIONS.locations).where(query).orderBy('sortOrder', 'asc').get();
  return ok(result.data);
}

async function classifyImage(event, context) {
  if (!HUNYUAN_CONFIG.apiKey && !(HUNYUAN_CONFIG.secretId && HUNYUAN_CONFIG.secretKey)) {
    return fail('请先配置 HUNYUAN_API_KEY 或 TENCENT_SECRET_ID/TENCENT_SECRET_KEY', 'MODEL_NOT_CONFIGURED');
  }
  const payloadError = validateClassifyImagePayload(event);
  if (payloadError) return payloadError;

  let rateLimitError = null;
  try {
    rateLimitError = await checkPersistentClassifyRateLimit(event, context);
  } catch {
    rateLimitError = checkClassifyRateLimit(event, context);
  }
  if (rateLimitError) return rateLimitError;

  let imageUrl = normalizeImageUrl(event.imageUrl || '');
  if (!imageUrl && event.imageBase64) {
    imageUrl = normalizeImageBase64(event.imageBase64, event.mimeType || event.contentType || 'image/jpeg');
  }
  if (!imageUrl && event.fileId) {
    let tempResult;
    try {
      tempResult = await cloud.getTempFileURL({ fileList: [event.fileId] });
    } catch (error) {
      return fail(error.message || '无法获取图片临时链接', 'IMAGE_URL_FAILED');
    }
    const file = tempResult.fileList && tempResult.fileList[0];
    if (!file || !file.tempFileURL) return fail('无法获取图片临时链接', 'IMAGE_URL_FAILED');
    imageUrl = file.tempFileURL;
  }

  const payload = {
    imageUrl,
    fileId: event.fileId || '',
    hint: event.hint || '',
    purpose: event.purpose || 'item'
  };
  let semantic;
  try {
    semantic = await callHunyuanVision(payload);
  } catch (error) {
    return fail(error.message || '混元识别失败，请检查图片链接或模型权限', 'HUNYUAN_FAILED');
  }
  const aiTags = unique([
    ...semantic.tags,
    ...semantic.colors,
    ...semantic.accessories,
    ...semantic.objects
  ]);
  const category = semantic.category || mapTagsToCategory(aiTags, event.hint || semantic.description);
  const visualDescription = semantic.description || aiTags.join('、');

  return ok({
    title: semantic.title || category,
    category,
    aiTags,
    yoloObjects: semantic.objects,
    semanticTags: semantic.tags,
    visualDescription,
    imageEmbedding: semantic.imageEmbedding,
    semanticEmbedding: semantic.semanticEmbedding,
    modelSources: {
      provider: HUNYUAN_CONFIG.secretId && HUNYUAN_CONFIG.secretKey ? 'tencentcloud-hunyuan' : 'tencent-hunyuan-compatible',
      baseUrl: HUNYUAN_CONFIG.secretId && HUNYUAN_CONFIG.secretKey ? HUNYUAN_CONFIG.tencentEndpoint : HUNYUAN_CONFIG.baseUrl,
      model: HUNYUAN_CONFIG.model
    }
  });
}

async function createItem(event, context) {
  const actor = requireActorId(context, event);
  if (actor.error) return actor.error;
  const payload = event.payload || {};
  const preparedImages = await prepareItemImages(payload.imageUrls || [], actor.actorId);
  if (!preparedImages.imageFileIds.length && !preparedImages.imageUrls.length && !payload.category) return fail('请上传图片或选择分类');
  let location = null;
  if (payload.locationId) {
    try {
      const locationResult = await db.collection(COLLECTIONS.locations).doc(payload.locationId).get();
      location = locationResult.data;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  const customLatitude = optionalNumber(payload.latitude);
  const customLongitude = optionalNumber(payload.longitude);
  const hasCustomLocation = !location && (payload.locationName || (customLatitude && customLongitude));
  const classification = payload.category
    ? { category: payload.category, aiTags: payload.aiTags || [] }
    : classifyByText(`${payload.title} ${payload.description || ''}`);
  const title = (payload.title || '').trim() || classification.category || '未命名物品';
  const data = {
    type: payload.type || 'found',
    title,
    description: payload.description || '',
    category: classification.category,
    aiTags: classification.aiTags,
    imageFileIds: preparedImages.imageFileIds,
    imageUrls: preparedImages.imageUrls,
    thumbUrl: preparedImages.imageUrls[0] || '',
    visualDescription: payload.visualDescription || '',
    yoloObjects: payload.yoloObjects || [],
    semanticTags: payload.semanticTags || [],
    imageEmbedding: payload.imageEmbedding || [],
    semanticEmbedding: payload.semanticEmbedding || [],
    locationId: location ? location._id : (payload.locationId || ''),
    locationName: location ? location.name : (payload.locationName || ''),
    locationArea: location ? location.area : (payload.locationArea || (hasCustomLocation ? '自定义位置' : '')),
    locationNearby: location ? location.nearby || [] : [],
    locationGuide: location ? location.detail || '' : (payload.locationGuide || ''),
    locationDetail: payload.locationDetail || '',
    mapX: location ? location.mapX : optionalNumber(payload.mapX),
    mapY: location ? location.mapY : optionalNumber(payload.mapY),
    latitude: location ? location.latitude : customLatitude,
    longitude: location ? location.longitude : customLongitude,
    status: 'active',
    ownerOpenid: actor.actorId,
    ownerName: payload.ownerName || '微信用户',
    createdAt: now(),
    updatedAt: now()
  };
  const created = await db.collection(COLLECTIONS.items).add({ data });
  const hydrated = await hydrateItemImages([{ _id: created._id, ...data }]);
  if (data.type === 'found') {
    const finderUser = await getUserByActorId(actor.actorId);
    await notifyLostOwnersAboutFoundMatch(hydrated[0], finderUser).catch((error) => {
      console.warn('Failed to send found-match email notifications.', error && (error.message || error));
    });
  }
  return ok(hydrated[0]);
}

async function listItems(event) {
  const filters = event.filters || {};
  const query = { status: filters.status || 'active' };
  if (filters.type) query.type = filters.type;
  if (filters.category && filters.category !== '全部') query.category = filters.category;
  if (filters.locationId) query.locationId = filters.locationId;
  const result = await db.collection(COLLECTIONS.items)
    .where(query)
    .orderBy('createdAt', 'desc')
    .skip(filters.cursor || 0)
    .limit(filters.limit || 20)
    .get();
  const items = await hydrateItemImages(result.data);
  return ok({ items, nextCursor: (filters.cursor || 0) + result.data.length });
}

async function getItemDetail(event) {
  const item = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const comments = await db.collection(COLLECTIONS.comments)
    .where({ itemId: event.itemId, status: 'active' })
    .orderBy('createdAt', 'asc')
    .get();
  const items = await hydrateItemImages([item.data]);
  return ok({ item: items[0], comments: comments.data });
}

async function createComment(event, context) {
  const actor = requireActorId(context, event);
  if (actor.error) return actor.error;
  const content = (event.content || '').trim();
  if (!content) return fail('评论不能为空');
  if (BAD_WORDS.some((word) => content.includes(word))) return fail('评论包含敏感词');
  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  const data = {
    itemId: event.itemId,
    authorOpenid: actor.actorId,
    authorName: event.authorName || '微信用户',
    content,
    status: 'active',
    createdAt: now()
  };
  const created = await db.collection(COLLECTIONS.comments).add({ data });
  if (item.ownerOpenid !== actor.actorId) {
    await createNotification(item.ownerOpenid, 'comment', `${data.authorName} 评论了你的帖子：${item.title}`, event.itemId, actor.actorId);
  }
  return ok({ _id: created._id, ...data });
}

async function sendThanks(event, context) {
  const actor = requireActorId(context, event);
  if (actor.error) return actor.error;
  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  if (item.ownerOpenid === actor.actorId) return fail('不能感谢自己发布的帖子');
  const existed = await db.collection(COLLECTIONS.thanks)
    .where({ itemId: event.itemId, fromOpenid: actor.actorId })
    .limit(1)
    .get();
  if (existed.data.length) return ok(existed.data[0]);
  const data = {
    itemId: event.itemId,
    fromOpenid: actor.actorId,
    toOpenid: item.ownerOpenid,
    createdAt: now()
  };
  const created = await db.collection(COLLECTIONS.thanks).add({ data });
  await createNotification(item.ownerOpenid, 'thanks', '有同学感谢了你发布的失物招领线索', event.itemId, actor.actorId);
  return ok({ _id: created._id, ...data });
}

async function updateReturnStatus(event, context, returned) {
  const actor = requireActorId(context, event);
  if (actor.error) return actor.error;
  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  if (item.ownerOpenid !== actor.actorId) return fail('只能操作自己的帖子', 'FORBIDDEN');
  await db.collection(COLLECTIONS.items).doc(event.itemId).update({
    data: {
      status: returned ? 'returned' : 'active',
      returnedAt: returned ? now() : null,
      claimedAt: null,
      claimedByOpenid: null,
      claimantName: '',
      claimantContact: '',
      updatedAt: now()
    }
  });
  return ok({ itemId: event.itemId, status: returned ? 'returned' : 'active' });
}

function cleanClaimField(value = '', fallback = '', maxLength = 80) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  return (text || fallback).slice(0, maxLength);
}

async function claimItem(event, context) {
  const actor = requireActorId(context, event);
  if (actor.error) return actor.error;
  if (!event.itemId) return fail('缺少 itemId');

  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  if (!item) return fail('物品不存在', 'ITEM_NOT_FOUND');
  if (item.type !== 'found') return fail('只能认领招领物品', 'INVALID_ITEM_TYPE');
  if (item.status === 'returned') return fail('该物品已回家，不能重复认领', 'ALREADY_RETURNED');
  if (item.ownerOpenid === actor.actorId) return fail('不能认领自己发布的物品', 'FORBIDDEN');

  const claimantUser = await getUserByActorId(actor.actorId);
  const claimantEmail = userEmail(claimantUser);
  const claimantName = cleanClaimField(event.claimantName || claimantUser?.nickName || event.nickName, '网页用户', 40);
  const claimantContact = cleanClaimField(claimantEmail || event.claimantContact || event.contact, '', 100);
  const claimedAt = now();
  const updateData = {
    status: 'returned',
    returnedAt: claimedAt,
    claimedAt,
    claimedByOpenid: actor.actorId,
    claimantName,
    claimantContact,
    updatedAt: claimedAt
  };

  await db.collection(COLLECTIONS.items).doc(event.itemId).update({ data: updateData });

  const commentData = {
    itemId: event.itemId,
    authorOpenid: actor.actorId,
    authorName: claimantName,
    content: claimantContact ? `${claimantName} 已认领：${claimantContact}` : `${claimantName} 已认领`,
    status: 'active',
    createdAt: claimedAt
  };
  const comment = await db.collection(COLLECTIONS.comments).add({ data: commentData });
  await createNotification(item.ownerOpenid, 'claim', `${claimantName} 已认领：${item.title}`, event.itemId, actor.actorId);
  await notifyOwnerItemClaimed(item, claimantUser, { claimantName, claimantContact }).catch((error) => {
    console.warn('Failed to send claim email notification.', error && (error.message || error));
  });

  const hydrated = await hydrateItemImages([{ _id: event.itemId, ...item, ...updateData }]);
  return ok({
    item: hydrated[0],
    comment: { _id: comment._id, ...commentData }
  });
}

async function reportContent(event, context) {
  const actor = requireActorId(context, event);
  if (actor.error) return actor.error;
  const data = {
    targetType: event.targetType,
    targetId: event.targetId,
    reason: event.reason || '用户举报',
    reporterOpenid: actor.actorId,
    status: 'open',
    createdAt: now()
  };
  const created = await db.collection(COLLECTIONS.reports).add({ data });
  return ok({ _id: created._id, ...data });
}

exports.main = async (event = {}) => {
  try {
    const context = cloud.getWXContext();
    switch (event.action) {
      case 'login':
        return await login(event, context);
      case 'sendEmailCode':
        return await sendEmailCode(event);
      case 'registerWithEmail':
        return await registerWithEmail(event);
      case 'loginWithEmailPassword':
        return await loginWithEmailPassword(event);
      case 'loginWithEmailCode':
        return await loginWithEmailCode(event);
      case 'createItem':
        return await createItem(event, context);
      case 'classifyImage':
        return await classifyImage(event, context);
      case 'listItems':
        return await listItems(event);
      case 'getItemDetail':
        return await getItemDetail(event);
      case 'listLocations':
        return await listLocations(event);
      case 'createComment':
        return await createComment(event, context);
      case 'sendThanks':
        return await sendThanks(event, context);
      case 'claimItem':
        return await claimItem(event, context);
      case 'markReturned':
        return await updateReturnStatus(event, context, true);
      case 'undoReturned':
        return await updateReturnStatus(event, context, false);
      case 'reportContent':
        return await reportContent(event, context);
      default:
        return fail(`未知 action: ${event.action}`);
    }
  } catch (error) {
    return fail(error.message || '服务异常', 'INTERNAL_ERROR');
  }
};
