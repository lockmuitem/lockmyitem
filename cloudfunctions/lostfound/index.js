const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { isProtectedFoundItem, maskSensitiveText, privacyPromptLines, sanitizeFoundItemPrivacy } = require('./privacy');
const {
  CLAIM_REQUEST_STATUS,
  canActorSeeClaimant,
  canViewerSeeComment,
  canCompleteActiveClaim,
  evaluateFixedWindow,
  evaluateOtpRecord,
  isClaimTokenPayloadValid,
  isApprovedToViewRequest,
  redactInternalImageReferences,
  redactInternalItemSource,
  reviewStatusForDecision,
  redactProtectedImages,
  shouldNotifyOwner
} = require('./security-policy');
const {
  applyQQReviewCorrections,
  applyQQRouteGuards,
  matchCampusLocation,
  normalizeQQExtraction,
  qqReplyDeadlineMs,
  qqReplyMessageId,
  resolveQQReviewOwner,
  qqSignatureMessage,
  routeQQExtraction
} = require('./qq-ingestion-policy');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  users: 'users',
  items: 'items',
  comments: 'comments',
  claimRequests: 'claim_requests',
  thanks: 'thanks',
  notifications: 'notifications',
  reports: 'reports',
  locations: 'campus_locations',
  emailCodes: 'email_login_codes',
  rateLimits: 'classify_rate_limits',
  qqEvents: 'qq_ingest_events',
  qqDrafts: 'qq_ingest_drafts',
  qqOutbox: 'qq_bot_outbox'
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
  maxCodesPerEmailWindow: positiveNumber(process.env.AUTH_CODE_EMAIL_RATE_MAX, 5),
  maxCodesPerRequesterWindow: positiveNumber(process.env.AUTH_CODE_REQUESTER_RATE_MAX, 10),
  codeRateWindowMs: positiveNumber(process.env.AUTH_CODE_RATE_WINDOW_MS, 60 * 60 * 1000),
  passwordIterations: positiveNumber(process.env.AUTH_PASSWORD_ITERATIONS, 120000),
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: positiveNumber(process.env.SMTP_PORT, 465),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  tokenSecret: process.env.AUTH_TOKEN_SECRET || process.env.LOCKMYITEM_AUTH_SECRET || ''
};

const MATCH_EMAIL_CONFIG = {
  threshold: positiveNumber(process.env.MATCH_EMAIL_THRESHOLD, 70),
  maxRecipients: positiveNumber(process.env.MATCH_EMAIL_MAX_RECIPIENTS, 5)
};

const CLAIM_CONFIG = {
  tokenTtlMs: positiveNumber(process.env.CLAIM_TOKEN_TTL_MS, 10 * 60 * 1000),
  maxDescriptionLength: positiveNumber(process.env.CLAIM_DESCRIPTION_MAX_LENGTH, 260),
  minModelConfidence: positiveNumber(process.env.CLAIM_MODEL_MIN_CONFIDENCE, 0.55),
  maxAttempts: positiveNumber(process.env.CLAIM_RATE_LIMIT_MAX, 5),
  attemptWindowMs: positiveNumber(process.env.CLAIM_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
  attemptCooldownMs: positiveNumber(process.env.CLAIM_RATE_LIMIT_COOLDOWN_MS, 15 * 1000),
  maxUserAttempts: positiveNumber(process.env.CLAIM_USER_RATE_LIMIT_MAX, 20),
  userAttemptWindowMs: positiveNumber(process.env.CLAIM_USER_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
  userAttemptCooldownMs: positiveNumber(process.env.CLAIM_USER_RATE_LIMIT_COOLDOWN_MS, 3 * 1000),
  ownerNotificationCooldownMs: positiveNumber(process.env.CLAIM_OWNER_NOTIFICATION_COOLDOWN_MS, 10 * 60 * 1000)
};

const QQ_REVIEW_OWNER = resolveQQReviewOwner({
  actorId: process.env.QQ_REVIEW_OWNER_ACTOR_ID,
  email: process.env.QQ_REVIEW_OWNER_EMAIL,
  emailDomain: AUTH_CONFIG.emailDomain
});

const QQ_INGEST_CONFIG = {
  secret: process.env.QQ_INGEST_SECRET || '',
  adminSecret: process.env.QQ_ADMIN_SECRET || '',
  reviewOwnerActorId: QQ_REVIEW_OWNER.actorId,
  reviewOwnerEmail: QQ_REVIEW_OWNER.email,
  allowedGroupName: process.env.QQ_ALLOWED_GROUP_NAME || '上科大健忘者互助协会',
  allowedGroupIds: new Set(String(process.env.QQ_ALLOWED_GROUP_IDS || '').split(',').map((value) => value.trim()).filter(Boolean)),
  signatureTtlMs: positiveNumber(process.env.QQ_SIGNATURE_TTL_MS, 5 * 60 * 1000),
  highConfidence: positiveNumber(process.env.QQ_AUTO_PUBLISH_CONFIDENCE, 0.8),
  mediumConfidence: positiveNumber(process.env.QQ_REVIEW_CONFIDENCE, 0.45),
  publicBaseUrl: String(process.env.WEB_PUBLIC_BASE_URL || '').replace(/\/$/, '')
};

const classifyRateBuckets = new Map();
let rateLimitCollectionReady = false;
let rateLimitCollectionDisabled = false;
let emailCodeCollectionReady = false;
let emailCodeCollectionDisabled = false;
let claimRequestCollectionReady = false;
let claimRequestCollectionDisabled = false;
let qqCollectionsReady = false;
let qqCollectionsDisabled = false;
let qqLocationCache = { expiresAtMs: 0, locations: [] };

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

async function uploadItemDataImage(dataUrl, actorId = '', stableNamespace = '') {
  const parsed = parseDataImageUrl(dataUrl);
  if (!parsed) return '';
  const safeActorId = sha256(actorId || 'anonymous').slice(0, 16);
  const contentHash = crypto.createHash('sha256').update(parsed.buffer).digest('hex').slice(0, 32);
  const fileName = stableNamespace
    ? `${sha256(stableNamespace).slice(0, 24)}-${contentHash}`
    : `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const cloudPath = `lostfound/items/${safeActorId}/${fileName}.${parsed.extension}`;
  const result = await cloud.uploadFile({
    cloudPath,
    fileContent: parsed.buffer
  });
  return result.fileID || result.fileId || '';
}

async function prepareItemImages(imageUrls = [], actorId = '', stableNamespace = '') {
  const imageFileIds = [];
  const publicImageUrls = [];
  const sources = unique(imageUrls).slice(0, 6);

  for (const source of sources) {
    const value = String(source || '').trim();
    if (!value) continue;

    if (isDataImageUrl(value)) {
      const fileId = await uploadItemDataImage(value, actorId, stableNamespace);
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
  const tokenPayload = verifyAuthToken(event.authToken);
  if (tokenPayload && tokenPayload.sub) return tokenPayload.sub;
  const trustedActor = firstTrustedContextValue(context, [
    'OPENID',
    'UNIONID',
    'UID',
    'TCB_UUID',
    'TcbUuid'
  ]);
  if (trustedActor) return trustedActor;
  return getWebClientActorId(event);
}

function requireActorId(context = {}, event = {}) {
  const actorId = getActorId(context, event);
  if (!actorId) {
    return { error: fail('无法识别当前用户，请刷新页面后重试', 'AUTH_REQUIRED') };
  }
  return { actorId };
}

function requireVerifiedActor(event = {}) {
  const tokenPayload = verifyAuthToken(event.authToken);
  if (!tokenPayload || !tokenPayload.sub) {
    return { error: fail('请先使用上科大邮箱登录', 'AUTH_REQUIRED') };
  }
  return { actorId: tokenPayload.sub, tokenPayload };
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

async function checkPersistentActionRateLimit({ namespace, identity, maxRequests, windowMs, minIntervalMs = 0, message = '请求过于频繁' }) {
  const ready = await ensureRateLimitCollection();
  const key = sha256(`${namespace}:${identity}`);
  const nowMs = Date.now();

  if (!ready) {
    return fail('安全限流服务暂不可用，请稍后再试', 'RATE_LIMIT_STORE_UNAVAILABLE');
  }

  return db.runTransaction(async (transaction) => {
    const doc = transaction.collection(COLLECTIONS.rateLimits).doc(key);
    let current = null;
    try {
      const result = await doc.get();
      current = result && result.data ? result.data : null;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const decision = evaluateFixedWindow(current, {
      nowMs,
      maxRequests,
      windowMs,
      minIntervalMs
    });
    if (!decision.allowed) {
      return fail(`${message}，请 ${decision.retryAfterSeconds} 秒后再试`, 'RATE_LIMITED');
    }
    await doc.set({
      data: {
        ...decision.next,
        namespace,
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

async function ensureClaimRequestCollection() {
  if (claimRequestCollectionReady) return true;
  if (claimRequestCollectionDisabled) return false;

  try {
    await db.createCollection(COLLECTIONS.claimRequests);
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      claimRequestCollectionDisabled = true;
      return false;
    }
  }

  claimRequestCollectionReady = true;
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

function requireAuthTokenSecret() {
  if (!AUTH_CONFIG.tokenSecret) {
    throw new Error('认证签名凭据未配置');
  }
  return AUTH_CONFIG.tokenSecret;
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
  const tokenSecret = requireAuthTokenSecret();
  const signature = hmac(tokenSecret, body, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${body}.${signature}`;
}

function verifyAuthToken(token = '') {
  if (!AUTH_CONFIG.tokenSecret) return null;
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

function canSeeClaimantInfo(item = {}, actorId = '') {
  return canActorSeeClaimant(item, actorId);
}

function createClaimToken(itemId, claimantOpenid) {
  const issuedAt = Date.now();
  const payload = {
    typ: 'claim',
    itemId,
    sub: claimantOpenid,
    iat: issuedAt,
    exp: issuedAt + CLAIM_CONFIG.tokenTtlMs,
    nonce: crypto.randomBytes(8).toString('hex')
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const tokenSecret = requireAuthTokenSecret();
  const signature = hmac(tokenSecret, `claim.${body}`, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${body}.${signature}`;
}

function verifyClaimToken(token = '', itemId = '', claimantOpenid = '') {
  if (!AUTH_CONFIG.tokenSecret) return null;
  const value = String(token || '').trim();
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const expected = hmac(AUTH_CONFIG.tokenSecret, `claim.${parts[0]}`, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  if (!safeEqual(expected, parts[1])) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[0]));
    if (!isClaimTokenPayloadValid(payload, { itemId, claimantOpenid, nowMs: Date.now() })) return null;
    return payload;
  } catch {
    return null;
  }
}

function claimTokenNotBeforeMs(item = {}) {
  const value = item.claimTokenNotBefore;
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  if (value.$date) {
    const nested = value.$date.$numberLong || value.$date;
    const number = Number(nested);
    if (Number.isFinite(number)) return number;
    const parsed = Date.parse(String(nested));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function claimTokenAllowsItem(tokenPayload, item = {}) {
  if (!tokenPayload) return false;
  const notBeforeMs = claimTokenNotBeforeMs(item);
  if (!notBeforeMs) return true;
  const issuedAt = Number(tokenPayload.iat || 0);
  return Number.isFinite(issuedAt) && issuedAt >= notBeforeMs;
}

function itemBelongsToActor(item = {}, actorId = '') {
  return Boolean(actorId && item.ownerOpenid === actorId);
}

function stripProtectedImages(item = {}) {
  return redactProtectedImages(item);
}

function stripInternalItemFields(item = {}) {
  const {
    claimTokenNotBefore,
    claimImageResetReason,
    ...publicItem
  } = item;
  return redactInternalItemSource(redactInternalImageReferences(publicItem));
}

function canViewProtectedImages(item = {}, event = {}, actorId = '') {
  if (!isProtectedFoundItem(item)) return true;
  if (itemBelongsToActor(item, actorId) || canActorSeeClaimant(item, actorId)) return true;
  const tokenPayload = verifyClaimToken(event.claimToken, item._id || item.id || event.itemId, actorId);
  return claimTokenAllowsItem(tokenPayload, item);
}

function sanitizeItemForViewer(item = {}, event = {}, actorId = '') {
  const safeItem = sanitizeFoundItemPrivacy(sanitizeClaimantInfo(item, canSeeClaimantInfo(item, actorId)));
  if (!isProtectedFoundItem(safeItem)) {
    return stripInternalItemFields({ ...safeItem, claimProtected: false, claimImageLocked: false });
  }
  if (canViewProtectedImages(safeItem, event, actorId)) {
    return stripInternalItemFields({ ...safeItem, claimProtected: true, claimImageLocked: false });
  }
  return stripInternalItemFields(stripProtectedImages(safeItem));
}

function sanitizeClaimantInfo(item = {}, canSeeClaimant = false) {
  if (canSeeClaimant) return item;
  return {
    ...item,
    claimantName: '',
    claimantContact: '',
    claimedByOpenid: '',
    claims: []
  };
}

function sanitizeCommentsForViewer(comments = [], canSeeClaimant = false) {
  return comments.filter((comment) => canViewerSeeComment(comment, canSeeClaimant));
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

function buildVisionPrompt(hint = '', purpose = 'item', itemType = '') {
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
    ...privacyPromptLines(itemType),
    '必须只返回 JSON，不要 Markdown，不要解释。',
    'JSON 字段：title, description, category, tags, colors, accessories, objects。',
    'category 从以下中文类别中选择：证件、电子产品、书本资料、衣物、钥匙、校园卡、雨伞、水杯、其他。',
    'title/description/tags/colors/accessories/objects 必须使用简体中文。',
    `用户补充描述：${hint || '无'}`
  ].join('\n');
}

function normalizeModelImageUrls(imageUrl = '', imageUrls = []) {
  return unique([...(Array.isArray(imageUrls) ? imageUrls : []), imageUrl]).filter(Boolean).slice(0, 6);
}

async function callOpenAICompatibleHunyuanVisionJson({ imageUrl, imageUrls = [], prompt, temperature = 0.2 }) {
  const fetchClient = getFetch();
  const endpoint = `${HUNYUAN_CONFIG.baseUrl}/chat/completions`;
  const modelImages = normalizeModelImageUrls(imageUrl, imageUrls);

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
            ...modelImages.map((url) => ({ type: 'image_url', image_url: { url } })),
            { type: 'text', text: prompt }
          ]
        }
      ],
      temperature
    }),
    timeout: 30000
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error && (data.error.message || data.error.code);
    throw new Error(`混元识别失败 ${response.status}${message ? `: ${message}` : ''}`);
  }
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return parseJsonContent(content || '');
}

async function callTencentCloudHunyuanVisionJson({ imageUrl, imageUrls = [], prompt, temperature = 0.2 }) {
  const fetchClient = getFetch();
  const endpointHost = new URL(HUNYUAN_CONFIG.tencentEndpoint).host;
  const modelImages = normalizeModelImageUrls(imageUrl, imageUrls);
  const requestBody = {
    Model: HUNYUAN_CONFIG.model,
    Stream: false,
    Temperature: temperature,
    Messages: [
      {
        Role: 'user',
        Contents: [
          { Type: 'text', Text: prompt },
          ...modelImages.map((url) => ({ Type: 'image_url', ImageUrl: { Url: url } }))
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
  return parseJsonContent(content || '');
}

async function callHunyuanVisionJson(payload) {
  if (HUNYUAN_CONFIG.secretId && HUNYUAN_CONFIG.secretKey) {
    return callTencentCloudHunyuanVisionJson(payload);
  }
  return callOpenAICompatibleHunyuanVisionJson(payload);
}

async function callOpenAICompatibleHunyuanVision(payload) {
  const prompt = buildVisionPrompt(payload.hint, payload.purpose, payload.itemType);
  const raw = await callOpenAICompatibleHunyuanVisionJson({
    imageUrl: payload.imageUrl,
    prompt,
    temperature: 0.2
  });
  return normalizeHunyuanResult(raw);
}

async function callTencentCloudHunyuanVision(payload) {
  const prompt = buildVisionPrompt(payload.hint, payload.purpose, payload.itemType);
  const raw = await callTencentCloudHunyuanVisionJson({
    imageUrl: payload.imageUrl,
    prompt,
    temperature: 0.2
  });
  return normalizeHunyuanResult(raw);
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
    nickName: profile.nickName || '网页用户',
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

function isQQManagedItem(item = {}) {
  return item?.source?.platform === 'qq';
}

function ownerEmailForItem(item = {}, ownerUser = {}) {
  return userEmail(ownerUser) || (isQQManagedItem(item) ? QQ_INGEST_CONFIG.reviewOwnerEmail : '');
}

function ownerNameForItem(item = {}, ownerUser = {}) {
  return userDisplayName(ownerUser, isQQManagedItem(item) ? 'QQ群代发布管理员' : '网页用户');
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

async function sendEmailCode(event, context = {}) {
  const email = normalizeShanghaiTechEmail(event.email);
  if (!email) return fail(`请使用 @${AUTH_CONFIG.emailDomain} 邮箱`, 'INVALID_EMAIL');
  const requesterIdentity = getClassifyRateKey(event, context);
  const emailRateError = await checkPersistentActionRateLimit({
    namespace: 'otp-email',
    identity: emailHash(email),
    maxRequests: AUTH_CONFIG.maxCodesPerEmailWindow,
    windowMs: AUTH_CONFIG.codeRateWindowMs,
    minIntervalMs: AUTH_CONFIG.codeCooldownMs,
    message: '该邮箱验证码发送过于频繁'
  });
  if (emailRateError) return emailRateError;
  const requesterRateError = await checkPersistentActionRateLimit({
    namespace: 'otp-requester',
    identity: requesterIdentity,
    maxRequests: AUTH_CONFIG.maxCodesPerRequesterWindow,
    windowMs: AUTH_CONFIG.codeRateWindowMs,
    minIntervalMs: AUTH_CONFIG.codeCooldownMs,
    message: '验证码请求过于频繁'
  });
  if (requesterRateError) return requesterRateError;
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
  return db.runTransaction(async (transaction) => {
    const doc = transaction.collection(COLLECTIONS.emailCodes).doc(record._id);
    const latest = (await doc.get()).data;
    const expected = sha256(`${normalized}:${value}:${latest.codeSalt}`);
    const decision = evaluateOtpRecord(latest, {
      nowMs: Date.now(),
      maxAttempts: AUTH_CONFIG.maxCodeAttempts,
      matches: safeEqual(expected, latest.codeHash)
    });
    if (decision.reason === 'expired') return fail('验证码已过期或不存在，请重新获取', 'CODE_EXPIRED');
    if (decision.reason === 'locked') return fail('验证码尝试次数过多，请重新获取', 'CODE_LOCKED');
    if (decision.incrementAttempts) {
      await doc.update({ data: { attempts: _.inc(1), updatedAt: now() } });
      return fail('验证码不正确', 'INVALID_CODE');
    }
    await doc.update({ data: { used: true, usedAt: now(), updatedAt: now() } });
    return null;
  });
}

async function ensureQQCollections() {
  if (qqCollectionsReady) return true;
  if (qqCollectionsDisabled) return false;
  for (const name of [COLLECTIONS.qqEvents, COLLECTIONS.qqDrafts, COLLECTIONS.qqOutbox]) {
    try {
      await db.createCollection(name);
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        qqCollectionsDisabled = true;
        return false;
      }
    }
  }
  qqCollectionsReady = true;
  return true;
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

async function updateUserProfile(event) {
  const tokenPayload = verifyAuthToken(event.authToken);
  if (!tokenPayload || !tokenPayload.sub) {
    return fail('请先登录后再修改账号资料', 'AUTH_REQUIRED');
  }

  const user = await getUserByActorId(tokenPayload.sub);
  if (!user || !user._id) {
    return fail('账号不存在，请重新登录', 'USER_NOT_FOUND');
  }

  const nickName = sanitizeNickName(event.nickName || '', '');
  if (!nickName) return fail('昵称不能为空', 'INVALID_NICKNAME');
  if (nickName.length > 20) return fail('昵称最多 20 个字', 'INVALID_NICKNAME');

  const updatedAt = now();
  await db.collection(COLLECTIONS.users).doc(user._id).update({
    data: {
      nickName,
      updatedAt
    }
  });

  const updatedUser = { ...user, nickName, updatedAt };
  const token = createAuthToken(updatedUser);
  return ok(publicEmailUser(updatedUser, token));
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
  const safeItem = sanitizeFoundItemPrivacy(item);
  const ownerUser = await getUserByActorId(item.ownerOpenid);
  const ownerEmail = ownerEmailForItem(item, ownerUser);
  if (!ownerEmail) return { sent: false, reason: 'OWNER_EMAIL_MISSING' };

  const claimantName = claimData.claimantName || userDisplayName(claimantUser);
  const claimantEmail = userEmail(claimantUser) || normalizeShanghaiTechEmail(claimData.claimantContact);
  const title = safeItem.title || '未命名物品';
  const location = itemLocationText(safeItem);
  const subject = `LockMyItem：你的招领物品「${title}」已被认领`;
  const text = [
    `你好，${ownerNameForItem(item, ownerUser)}：`,
    '',
    `你发布的招领物品「${title}」已被 ${claimantName} 认领。`,
    `领取者账号/邮箱：${claimantEmail || claimData.claimantContact || '未提供'}`,
    `物品地点：${location}`,
    '',
    '如有疑问，请回到 LockMyItem 查看详情。'
  ].join('\n');
  const html = `
    <p>你好，${escapeHtml(ownerNameForItem(item, ownerUser))}：</p>
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

async function notifyOwnerClaimReviewRequested(item = {}, request = {}) {
  const safeItem = sanitizeFoundItemPrivacy(item);
  const ownerUser = await getUserByActorId(item.ownerOpenid);
  const ownerEmail = ownerEmailForItem(item, ownerUser);
  if (!ownerEmail) return { sent: false, reason: 'OWNER_EMAIL_MISSING' };

  const claimantName = cleanClaimField(request.claimantName, '网页用户', 40);
  const claimantContact = cleanClaimField(request.claimantContact, '', 100);
  const title = safeItem.title || '一件招领物品';
  const location = itemLocationText(safeItem);
  const description = cleanClaimField(request.description, '未填写', CLAIM_CONFIG.maxDescriptionLength);
  const modelReason = cleanClaimField(request.modelDecision?.reason, '模型未能直接判断', 160);
  const subject = `LockMyItem：敏感卡面物品「${title}」需要你确认认领`;
  const text = [
    `你好，${ownerNameForItem(item, ownerUser)}：`,
    '',
    `${claimantName} 提交了敏感卡面物品认领描述，模型未能直接判断，需要你人工确认。`,
    `招领物品：${title}`,
    `物品地点：${location}`,
    `认领人账号/邮箱：${claimantContact || '未提供'}`,
    `认领描述：${description}`,
    `模型判断：${modelReason}`,
    '',
    '请回到 LockMyItem 的物品详情，在“待确认认领”中选择通过或拒绝。',
    '请避免在评论或邮件里直接交流个人敏感信息；如需进一步核验，请让对方回到 LockMyItem 认领表单补充。'
  ].join('\n');
  const html = `
    <p>你好，${escapeHtml(ownerNameForItem(item, ownerUser))}：</p>
    <p><strong>${escapeHtml(claimantName)}</strong> 提交了敏感卡面物品认领描述，模型未能直接判断，需要你人工确认。</p>
    <ul>
      <li>招领物品：${escapeHtml(title)}</li>
      <li>物品地点：${escapeHtml(location)}</li>
      <li>认领人账号/邮箱：${escapeHtml(claimantContact || '未提供')}</li>
      <li>认领描述：${escapeHtml(description)}</li>
      <li>模型判断：${escapeHtml(modelReason)}</li>
    </ul>
    <p>请回到 LockMyItem 的物品详情，在“待确认认领”中选择通过或拒绝。</p>
    <p>请避免在评论或邮件里直接交流个人敏感信息；如需进一步核验，请让对方回到 LockMyItem 认领表单补充。</p>
  `;

  await sendTransactionalEmail({ to: ownerEmail, subject, text, html });
  return { sent: true, to: ownerEmail };
}

async function notifyLostOwnersAboutFoundMatch(foundItem = {}, finderUser = {}) {
  if (foundItem.type !== 'found' || foundItem.status !== 'active') return [];
  const safeFoundItem = sanitizeFoundItemPrivacy(foundItem);
  const finderEmail = ownerEmailForItem(foundItem, finderUser);
  const finderName = ownerNameForItem(foundItem, finderUser) || safeFoundItem.ownerName || '招领发布者';
  const result = await db.collection(COLLECTIONS.items)
    .where({ type: 'lost', status: 'active' })
    .orderBy('createdAt', 'desc')
    .limit(80)
    .get();

  const matches = (result.data || [])
    .filter((lostItem) => lostItem.ownerOpenid)
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
    const foundTitle = safeFoundItem.title || '一件招领物品';
    const location = itemLocationText(safeFoundItem);
    const reasonText = match.reasons.length ? match.reasons.join('、') : '物品特征相似';
    const claimNotice = isProtectedFoundItem(safeFoundItem) ? '含敏感卡面或证件信息，需先提交可验证特征；敏感内容仅用于核验，不会公开展示。' : '';
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
      claimNotice,
      '',
      '请回到 LockMyItem 查看详情并确认是否为你的物品。'
    ].filter((line) => line !== '').join('\n');
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
        ${claimNotice ? `<li>${escapeHtml(claimNotice)}</li>` : ''}
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

async function notifyLostOwnerAboutExistingFoundMatches(lostItem = {}, lostOwner = {}) {
  if (lostItem.type !== 'lost' || lostItem.status !== 'active') return [];
  const lostOwnerEmail = ownerEmailForItem(lostItem, lostOwner);
  if (!lostOwnerEmail) return [];

  const result = await db.collection(COLLECTIONS.items)
    .where({ type: 'found', status: 'active' })
    .orderBy('createdAt', 'desc')
    .limit(80)
    .get();

  const matches = (result.data || [])
    .filter((foundItem) => foundItem.ownerOpenid)
    .map((foundItem) => {
      const match = scoreLostFoundMatch(lostItem, foundItem);
      return { foundItem, ...match };
    })
    .filter((entry) => entry.similarity >= MATCH_EMAIL_CONFIG.threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MATCH_EMAIL_CONFIG.maxRecipients);

  const sent = [];
  for (const match of matches) {
    const safeFoundItem = sanitizeFoundItemPrivacy(match.foundItem);
    const foundOwner = await getUserByActorId(match.foundItem.ownerOpenid);
    const finderEmail = ownerEmailForItem(match.foundItem, foundOwner);
    const finderName = ownerNameForItem(match.foundItem, foundOwner) || safeFoundItem.ownerName || '招领发布者';
    const lostTitle = lostItem.title || '你的寻物线索';
    const foundTitle = safeFoundItem.title || '一件招领物品';
    const location = itemLocationText(safeFoundItem);
    const reasonText = match.reasons.length ? match.reasons.join('、') : '物品特征相似';
    const claimNotice = isProtectedFoundItem(safeFoundItem) ? '含敏感卡面或证件信息，需先提交可验证特征；敏感内容仅用于核验，不会公开展示。' : '';
    const subject = `LockMyItem：可能找到你的「${lostTitle}」`;
    const text = [
      `你好，${ownerNameForItem(lostItem, lostOwner)}：`,
      '',
      `已有一条招领信息和你刚发布的寻物「${lostTitle}」相似度较高。`,
      `招领物品：${foundTitle}`,
      `匹配相似度：${match.similarity}%`,
      `匹配理由：${reasonText}`,
      `招领地点：${location}`,
      `招领发布者：${finderName}`,
      `发布者邮箱：${finderEmail || '未提供'}`,
      claimNotice,
      '',
      '请回到 LockMyItem 查看详情并确认是否为你的物品。'
    ].filter((line) => line !== '').join('\n');
    const html = `
      <p>你好，${escapeHtml(ownerNameForItem(lostItem, lostOwner))}：</p>
      <p>已有一条招领信息和你刚发布的寻物 <strong>「${escapeHtml(lostTitle)}」</strong> 相似度较高。</p>
      <ul>
        <li>招领物品：${escapeHtml(foundTitle)}</li>
        <li>匹配相似度：${escapeHtml(String(match.similarity))}%</li>
        <li>匹配理由：${escapeHtml(reasonText)}</li>
        <li>招领地点：${escapeHtml(location)}</li>
        <li>招领发布者：${escapeHtml(finderName)}</li>
        <li>发布者邮箱：${escapeHtml(finderEmail || '未提供')}</li>
        ${claimNotice ? `<li>${escapeHtml(claimNotice)}</li>` : ''}
      </ul>
      <p>请回到 LockMyItem 查看详情并确认是否为你的物品。</p>
    `;

    try {
      await sendTransactionalEmail({ to: lostOwnerEmail, subject, text, html });
      await createNotification(
        lostItem.ownerOpenid,
        'match',
        `已有招领「${foundTitle}」可能匹配你的寻物「${lostTitle}」`,
        match.foundItem._id || match.foundItem.id,
        match.foundItem.ownerOpenid
      ).catch(() => null);
      sent.push({ itemId: match.foundItem._id, to: lostOwnerEmail, similarity: match.similarity });
    } catch (error) {
      console.warn('Failed to send reverse match email notification.', error && (error.message || error));
    }
  }
  return sent;
}

function normalizeClaimDescription(value = '') {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, CLAIM_CONFIG.maxDescriptionLength);
}

const CLAIM_NON_NAME_TERMS = new Set([
  '校园卡',
  '银行卡',
  '信用卡',
  '借记卡',
  '身份证',
  '手机号',
  '学生证',
  '工作证',
  '上海',
  '大学',
  '科技',
  '蓝色',
  '紫色',
  '黑色',
  '白色',
  '卡套',
  '姓名',
  '学号',
  '卡号'
]);
const CLAIM_SURNAME_CHARS = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾甘厉戎祖武符刘景詹龙叶幸司韶郜黎蓟薄印宿白怀蒲台从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍桑桂濮牛寿通边扈燕冀郏浦尚农温庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';
const CLAIM_NON_NAME_FRAGMENT_PATTERN = /卡|套|色|证|件|银行|校园|大学|学院|科技|手机|电话|号码|编号|有效期/;
const CLAIM_MATCH_CONFIDENCE_FLOOR = 0.7;
const CLAIM_EVIDENCE_CONFIDENCE_FLOOR = 0.6;
const CLAIM_CONTRADICTION_CONFIDENCE_FLOOR = 0.65;
const CLAIM_GENERIC_ONLY_PATTERN = /^(?:我|我的|本人|自己|这个|这张|这件|那个|那张|一张|一个|是|的|卡|物品|东西|失物|丢的|遗失|认领|领取|找回|哈|哈哈)+$/;
const CLAIM_OWNERSHIP_ONLY_PATTERN = /^(?:这|这个|这张|那个|那张)?(?:是)?(?:我|本人|自己)?的?(?:卡|物品|东西|失物|证|证件)?$/;

function compactDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function hasVariedDigits(value = '', minDistinct = 3) {
  const digits = compactDigits(value);
  return digits.length > 0 && new Set(Array.from(digits)).size >= minDistinct;
}

function isPossibleChineseName(value = '') {
  const text = String(value || '').trim();
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(text)) return false;
  if (CLAIM_NON_NAME_TERMS.has(text)) return false;
  if (CLAIM_NON_NAME_FRAGMENT_PATTERN.test(text)) return false;
  if (new Set(Array.from(text)).size <= 1) return false;
  return CLAIM_SURNAME_CHARS.includes(text[0]);
}

function compactClaimDescription(value = '') {
  return String(value || '').replace(/[\s,，.。;；:：!！?？'"“”‘’()[\]{}<>《》【】、/\\|_-]+/g, '');
}

function isLowInformationClaimPhrase(phrase = '') {
  const compact = String(phrase || '').replace(/[\s,，.。;；:：!！?？'"“”‘’()[\]{}<>《》【】、/\\|_-]+/g, '');
  if (!compact) return true;
  if (compact.length >= 4 && new Set(Array.from(compact)).size <= 2) return true;
  return CLAIM_GENERIC_ONLY_PATTERN.test(compact) || CLAIM_OWNERSHIP_ONLY_PATTERN.test(compact);
}

function cleanupClaimStorageText(value = '') {
  return String(value || '')
    .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
    .replace(/([，。！？；：、,.!?;:])\s+/g, '$1')
    .replace(/[、,，;；:：]{2,}/g, '，')
    .replace(/[、,，;；:：]+([。.!！?？])/g, '$1')
    .replace(/^[\s,，;；:：、]+|[\s,，;；:：、]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function maskStandaloneClaimNames(value = '') {
  return String(value || '').replace(
    /(^|[\s,，、;；:：])([\u4e00-\u9fa5]{2,4})(?=$|[\s,，、;；:：.。!！?？])/g,
    (match, prefix, name) => (isPossibleChineseName(name) ? `${prefix}姓名` : match)
  );
}

const LEGACY_CLAIM_MASK_SUFFIX = [0x5df2, 0x9690, 0x85cf].map((code) => String.fromCharCode(code)).join('');
const LEGACY_CLAIM_MASK_SUFFIX_PATTERN = new RegExp(LEGACY_CLAIM_MASK_SUFFIX, 'g');

function claimMaskReasonSummary(reasons = []) {
  const labels = unique(reasons.map((reason) => String(reason || '').replace(LEGACY_CLAIM_MASK_SUFFIX_PATTERN, '').trim()));
  return labels.length ? `${labels.join('、')}已处理` : '已提交可核验信息';
}

function maskClaimDescriptionForStorage(description = '') {
  const masked = maskSensitiveText(description, { maskNames: true });
  const text = cleanupClaimStorageText(maskStandaloneClaimNames(masked.text));
  if (text) return text.slice(0, CLAIM_CONFIG.maxDescriptionLength);
  if (masked.changed) return claimMaskReasonSummary(masked.reasons);
  return '已提交认领信息';
}

function claimDescriptionFingerprint(description = '') {
  if (!AUTH_CONFIG.tokenSecret) return '';
  return hmac(AUTH_CONFIG.tokenSecret, `claim-description.${description}`, 'hex');
}

function validateClaimDescriptionQuality(description = '') {
  const text = String(description || '').trim();
  const meaningfulText = compactClaimDescription(text);
  if (!meaningfulText) {
    return '请至少提供一个图中可验证的信息，例如姓名、编号、颜色、卡套、标志或使用痕迹';
  }
  if (isLowInformationClaimPhrase(meaningfulText) || /我的卡|是我的|我丢的|本人认领|本人领取/.test(text)) {
    return '请至少提供一个图中可验证的信息，不要只写“我的卡”或“是我的”';
  }

  const hasLetterOrChinese = /[A-Za-z\u4e00-\u9fa5]/.test(meaningfulText);
  const distinctChars = new Set(Array.from(meaningfulText)).size;
  const digitCount = (meaningfulText.match(/\d/g) || []).length;
  const alphaChineseCount = (meaningfulText.match(/[A-Za-z\u4e00-\u9fa5]/g) || []).length;
  const onlyDigits = digitCount > 0 && digitCount === meaningfulText.length;

  if (meaningfulText.length >= 4 && distinctChars <= 2) {
    return '请补充更具体的物品特征，不能只输入重复字符';
  }
  if (onlyDigits && (!hasVariedDigits(meaningfulText, 3) || digitCount < 6)) {
    return '请描述颜色、外观、卡套、标志或使用痕迹等可核验特征，不能只输入无意义数字';
  }
  if (!hasLetterOrChinese && !hasVariedDigits(meaningfulText, 3)) {
    return '请描述颜色、外观、卡套、标志、姓名或编号等可核验信息';
  }
  if (meaningfulText.length < 2) {
    return '请补充更具体的物品特征，不能只输入重复字符';
  }
  if (digitCount > 0 && !onlyDigits && alphaChineseCount < 2) {
    return '请补充更具体的物品特征';
  }
  return '';
}

function claimVerificationImageUrl(item = {}) {
  return unique([
    ...(item.imageUrls || []),
    item.thumbUrl,
    item.image
  ])
    .map((value) => normalizeImageUrl(value))
    .find((value) => isHttpUrl(value) && !isDataImageUrl(value) && !isCloudFileId(value)) || '';
}

function buildClaimVisionVerificationPrompt(item = {}, description = '') {
  const safeItem = sanitizeFoundItemPrivacy(item);
  const context = {
    category: safeItem.category || '',
    location: itemLocationText(safeItem)
  };
  return [
    '你是校园失物招领系统的认领视觉核验助手。',
    '任务：从认领人描述中提取具体可核验声明，并逐条判断这些声明是否能从图片中看到或比对到。',
    '只能把图片可见内容作为支持证据。下方脱敏上下文只帮助理解场景，不能作为 match 证据。',
    '不要因为描述与图片“不矛盾”、物品类型大致相近或上下文相近就返回 match。',
    '可以内部比对认领人主动提供的姓名、卡号、学号、工号、手机号、证件号等敏感线索是否与图片一致。',
    '不要要求用户补充完整卡号、身份证号、手机号、工号、学号、护照号、二维码、条码或任何唯一编号；但用户已经主动提供时可以用于本次内部核验。',
    '不要在输出中复述具体姓名、学号、卡号、证件号、手机号、二维码或条码内容，也不要输出用户原文。',
    '泛化词如“卡”“校园卡”“银行卡”“我的卡”“证件”只能作为 generic，不得作为 unlockEvidence。',
    '只有姓名、编号、学校/银行/组织标志、颜色、卡套、贴纸、可见文字、磨损、配件、放置环境等具体声明被图片支持时，unlockEvidence 才能为 true。',
    '如果描述包含多个声明，需要分别判断。任一关键声明与图片明显矛盾，例如颜色、卡套、组织名称、姓名或编号不一致，decision 应为 mismatch。',
    '如果没有任何具体声明被图片支持，即使没有明显矛盾，也必须返回 uncertain。',
    '必须只返回 JSON，不要 Markdown，不要解释。',
    'JSON 字段：decision, confidence, claims, reason。',
    'decision 只能是 match、uncertain、mismatch。',
    'confidence 是 0 到 1 的数字。',
    'claims 是数组，每项字段：index, type, specificity, support, confidence, unlockEvidence, reason。',
    'type 可用 name、number、organization、brand、color、container、visibleText、appearance、generic、other。',
    'specificity 只能是 generic、specific、sensitive。',
    'support 只能是 supported、contradicted、not_visible、uncertain。',
    'reason 只能用类别化描述，例如“姓名线索匹配”“编号线索未见”“颜色特征矛盾”“泛化类型不足以核验”，不得复述敏感原文。',
    `非证据脱敏上下文：${JSON.stringify(context)}`,
    `认领人描述（仅用于本次核验，不要复述）：${description}`
  ].join('\n');
}

function normalizeClaimSpecificity(value = '') {
  const text = String(value || '').toLowerCase();
  if (/generic|泛|笼统|类别|类型/.test(text)) return 'generic';
  if (/sensitive|敏感|姓名|编号|号码|证件|手机号|学号|工号|卡号/.test(text)) return 'sensitive';
  return 'specific';
}

function normalizeClaimSupport(value = '') {
  const text = String(value || '').toLowerCase();
  if (/contradict|mismatch|conflict|矛盾|不一致|相反|错误/.test(text)) return 'contradicted';
  if (/not[_ -]?visible|not[_ -]?seen|unseen|未见|不可见|看不到|未显示/.test(text)) return 'not_visible';
  if (/support|match|visible|seen|consistent|支持|匹配|可见|看到|一致/.test(text)) return 'supported';
  return 'uncertain';
}

function normalizeClaimBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(?:true|yes|1|是|对|可以)$/i.test(String(value).trim());
}

function normalizeModelClaim(rawClaim = {}, fallbackIndex = 1) {
  const index = Number.isInteger(Number(rawClaim.index)) && Number(rawClaim.index) > 0
    ? Number(rawClaim.index)
    : fallbackIndex;
  const support = normalizeClaimSupport(rawClaim.support || rawClaim.status || rawClaim.result);
  const confidence = Math.max(0, Math.min(1, Number(rawClaim.confidence) || 0));
  const specificity = normalizeClaimSpecificity(rawClaim.specificity || rawClaim.type);
  const reason = maskSensitiveText(rawClaim.reason || '').text;
  const unlockEvidence = normalizeClaimBoolean(rawClaim.unlockEvidence)
    && support === 'supported'
    && specificity !== 'generic'
    && confidence >= CLAIM_EVIDENCE_CONFIDENCE_FLOOR;
  return {
    index,
    type: cleanClaimField(rawClaim.type || 'other', 'other', 32),
    specificity,
    support,
    confidence,
    unlockEvidence,
    reason: cleanClaimField(reason, support === 'supported' ? '具体线索匹配' : '线索未能核验', 120)
  };
}

function normalizeModelClaims(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 12)
    .map((claim, index) => normalizeModelClaim(claim, index + 1));
}

function isUnlockEvidenceClaim(claim = {}) {
  return Boolean(
    claim.unlockEvidence
    && claim.support === 'supported'
    && claim.specificity !== 'generic'
    && claim.confidence >= CLAIM_EVIDENCE_CONFIDENCE_FLOOR
  );
}

function isContradictedClaim(claim = {}) {
  return claim.support === 'contradicted' && claim.confidence >= CLAIM_CONTRADICTION_CONFIDENCE_FLOOR;
}

function normalizeClaimModelDecision(raw = {}, fallbackReason = '') {
  let decision = ['match', 'uncertain', 'mismatch'].includes(raw.decision) ? raw.decision : 'uncertain';
  let confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const claims = normalizeModelClaims(raw.claims);
  const unlockClaims = claims.filter(isUnlockEvidenceClaim);
  const contradictedClaims = claims.filter(isContradictedClaim);
  const matchedClaimIndexes = unlockClaims.map((claim) => claim.index);
  const contradictedClaimIndexes = contradictedClaims.map((claim) => claim.index);
  let fallback = fallbackReason || '需要发布者人工确认';
  let reason = raw.reason || fallback;

  if (contradictedClaimIndexes.length) {
    decision = 'mismatch';
    fallback = '有关键可验证信息与图片不一致，转人工确认';
  } else if (decision === 'match' && matchedClaimIndexes.length === 0) {
    decision = 'uncertain';
    confidence = Math.min(confidence, CLAIM_MATCH_CONFIDENCE_FLOOR - 0.01);
    fallback = claims.length ? '模型未指出图中匹配的具体可见证据，转人工确认' : '模型未提取到可核验声明，转人工确认';
    reason = fallback;
  }

  const maskedReason = maskSensitiveText(reason).text;
  return {
    decision,
    confidence,
    claims,
    matchedClaimIndexes,
    contradictedClaimIndexes,
    reason: cleanClaimField(maskedReason, fallback, 160)
  };
}

function claimDecisionAllowsToken(modelDecision = {}) {
  return modelDecision.decision === 'match'
    && modelDecision.confidence >= Math.max(CLAIM_CONFIG.minModelConfidence, CLAIM_MATCH_CONFIDENCE_FLOOR)
    && (modelDecision.claims || []).some(isUnlockEvidenceClaim)
    && !(modelDecision.claims || []).some(isContradictedClaim);
}

async function verifyClaimDescriptionWithModel(item = {}, description = '') {
  if (!HUNYUAN_CONFIG.apiKey && !(HUNYUAN_CONFIG.secretId && HUNYUAN_CONFIG.secretKey)) {
    throw new Error('模型未配置');
  }
  const imageUrl = claimVerificationImageUrl(item);
  if (!imageUrl) {
    return normalizeClaimModelDecision({
      decision: 'uncertain',
      confidence: 0,
      reason: '缺少可用于视觉核验的图片，转人工确认'
    });
  }
  const raw = await callHunyuanVisionJson({
    imageUrl,
    prompt: buildClaimVisionVerificationPrompt(item, description),
    temperature: 0.1
  });
  return {
    ...normalizeClaimModelDecision(raw),
    method: 'vision'
  };
}

async function getLatestClaimRequest(itemId, claimantOpenid) {
  const ready = await ensureClaimRequestCollection();
  if (!ready) return null;
  const result = await db.collection(COLLECTIONS.claimRequests)
    .where({ itemId, claimantOpenid })
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();
  return (result.data && result.data[0]) || null;
}

async function getApprovedClaimRequest(requestId, itemId, claimantOpenid, item = {}) {
  if (!requestId) return null;
  const ready = await ensureClaimRequestCollection();
  if (!ready) return null;
  let request = null;
  try {
    const result = await db.collection(COLLECTIONS.claimRequests).doc(requestId).get();
    request = result.data;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  if (!request) return null;
  if (!isApprovedToViewRequest(request, itemId, claimantOpenid, { notBeforeMs: claimTokenNotBeforeMs(item) })) return null;
  return { _id: requestId, ...request };
}

async function markClaimRequestModelVerified(request = {}, description = '', modelDecision = {}, descriptionFingerprint = '') {
  if (!request || request.status !== 'pending_review' || !request._id) return null;
  const data = {
    description: maskClaimDescriptionForStorage(description),
    descriptionFingerprint,
    status: 'model_verified',
    modelDecision,
    updatedAt: now()
  };
  await db.collection(COLLECTIONS.claimRequests).doc(request._id).update({ data });
  return { ...request, ...data };
}

async function upsertPendingClaimRequest({ item, itemId, claimantOpenid, claimantUser, description, descriptionFingerprint = '', modelDecision, attemptCount, existingRequest }) {
  const ready = await ensureClaimRequestCollection();
  if (!ready) throw new Error('认领请求存储未就绪，请先创建 claim_requests 集合');
  const data = {
    itemId,
    itemTitle: sanitizeFoundItemPrivacy(item).title || '一件招领物品',
    ownerOpenid: item.ownerOpenid,
    claimantOpenid,
    claimantName: userDisplayName(claimantUser, '网页用户'),
    claimantContact: userEmail(claimantUser),
    description: maskClaimDescriptionForStorage(description),
    descriptionFingerprint,
    status: 'pending_review',
    modelDecision,
    attemptCount,
    updatedAt: now()
  };

  if (existingRequest && existingRequest.status === 'pending_review' && existingRequest._id) {
    await db.collection(COLLECTIONS.claimRequests).doc(existingRequest._id).update({ data });
    return { ...existingRequest, ...data };
  }

  const created = await db.collection(COLLECTIONS.claimRequests).add({
    data: {
      ...data,
      createdAt: now()
    }
  });
  return { _id: created._id, ...data };
}

async function listPendingClaimRequests(itemId) {
  const ready = await ensureClaimRequestCollection();
  if (!ready) return [];
  const result = await db.collection(COLLECTIONS.claimRequests)
    .where({ itemId, status: 'pending_review' })
    .orderBy('updatedAt', 'desc')
    .limit(20)
    .get();
  return result.data || [];
}

async function completeClaim({ itemId, item, claimantOpenid, claimantUser = {}, claimantName = '', claimantContact = '', notifyOwner = true }) {
  const cleanName = cleanClaimField(claimantName || claimantUser.nickName, '网页用户', 40);
  const cleanContact = cleanClaimField(userEmail(claimantUser) || claimantContact, '', 100);
  const claimedAt = now();
  const updateData = {
    status: 'returned',
    returnedAt: claimedAt,
    claimedAt,
    claimedByOpenid: claimantOpenid,
    claimantName: cleanName,
    claimantContact: cleanContact,
    updatedAt: claimedAt
  };

  const reservation = await db.runTransaction(async (transaction) => {
    const doc = transaction.collection(COLLECTIONS.items).doc(itemId);
    let currentItem = null;
    try {
      currentItem = (await doc.get()).data;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    if (!currentItem || !canCompleteActiveClaim(currentItem)) {
      return { completed: false, item: currentItem };
    }
    await doc.update({ data: updateData });
    return { completed: true, item: currentItem };
  });
  if (!reservation.completed) return { conflict: true };
  const currentItem = reservation.item || item;

  const commentData = {
    itemId,
    authorOpenid: claimantOpenid,
    authorName: cleanName,
    content: cleanContact ? `${cleanName} 已认领：${cleanContact}` : `${cleanName} 已认领`,
    visibility: 'claim_parties',
    status: 'active',
    createdAt: claimedAt
  };
  const comment = await db.collection(COLLECTIONS.comments).add({ data: commentData }).catch((error) => {
    console.warn('Failed to create claim comment after atomic claim transition.', error && (error.message || error));
    return null;
  });
  const safeItem = sanitizeFoundItemPrivacy(currentItem);
  await createNotification(currentItem.ownerOpenid, 'claim', `${cleanName} 已认领：${safeItem.title}`, itemId, claimantOpenid).catch((error) => {
    console.warn('Failed to create claim notification after atomic claim transition.', error && (error.message || error));
  });
  if (notifyOwner) {
    await notifyOwnerItemClaimed(currentItem, claimantUser, { claimantName: cleanName, claimantContact: cleanContact }).catch((error) => {
      console.warn('Failed to send claim email notification.', error && (error.message || error));
    });
  }

  const hydrated = await hydrateItemImages([{ _id: itemId, ...currentItem, ...updateData }]).catch(() => ([{ _id: itemId, ...currentItem, ...updateData }]));
  return {
    item: sanitizeItemForViewer(hydrated[0], {}, claimantOpenid),
    comment: comment ? { _id: comment._id, ...commentData } : null
  };
}

async function verifyClaimDescription(event, context) {
  const actor = requireVerifiedActor(event);
  if (actor.error) return actor.error;
  if (!event.itemId) return fail('缺少 itemId');
  const description = normalizeClaimDescription(event.description);
  const descriptionFingerprint = claimDescriptionFingerprint(description);
  const descriptionQualityError = validateClaimDescriptionQuality(description);
  if (descriptionQualityError) {
    return fail(descriptionQualityError, 'DESCRIPTION_REQUIRED');
  }

  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  if (!item) return fail('物品不存在', 'ITEM_NOT_FOUND');
  if (item.type !== 'found') return fail('只能校验招领物品', 'INVALID_ITEM_TYPE');
  if (item.status === 'returned') return fail('该物品已回家，不能重复认领', 'ALREADY_RETURNED');
  if (item.ownerOpenid === actor.actorId) return fail('不能认领自己发布的物品', 'FORBIDDEN');

  const hydratedItem = (await hydrateItemImages([item]))[0] || item;
  const safeItem = sanitizeFoundItemPrivacy(hydratedItem);
  if (!isProtectedFoundItem(safeItem)) {
    return ok({
      status: 'verified',
      verified: true,
      claimToken: createClaimToken(event.itemId, actor.actorId),
      expiresInSeconds: Math.floor(CLAIM_CONFIG.tokenTtlMs / 1000),
      modelDecision: { decision: 'match', confidence: 1, reason: '普通物品无需描述校验' }
    });
  }

  const claimantUser = await getUserByActorId(actor.actorId);
  const existingRequest = await getLatestClaimRequest(event.itemId, actor.actorId);
  if (isApprovedToViewRequest(existingRequest, event.itemId, actor.actorId, { notBeforeMs: claimTokenNotBeforeMs(item) })) {
    return ok({
      status: 'verified',
      verified: true,
      requestId: existingRequest._id,
      claimToken: createClaimToken(event.itemId, actor.actorId),
      expiresInSeconds: Math.floor(CLAIM_CONFIG.tokenTtlMs / 1000),
      modelDecision: existingRequest.modelDecision || {},
      message: '发布者已通过，请查看图片后由你确认认领'
    });
  }
  if (
    existingRequest
    && existingRequest.status === 'pending_review'
    && existingRequest.descriptionFingerprint
    && descriptionFingerprint
    && safeEqual(existingRequest.descriptionFingerprint, descriptionFingerprint)
  ) {
    return ok({
      status: 'pending_review',
      requestId: existingRequest._id,
      modelDecision: existingRequest.modelDecision || {},
      message: '已提交发布者人工确认'
    });
  }

  const userClaimRateError = await checkPersistentActionRateLimit({
    namespace: 'claim-model-user',
    identity: actor.actorId,
    maxRequests: CLAIM_CONFIG.maxUserAttempts,
    windowMs: CLAIM_CONFIG.userAttemptWindowMs,
    minIntervalMs: CLAIM_CONFIG.userAttemptCooldownMs,
    message: '认领描述校验总量过于频繁'
  });
  if (userClaimRateError) return userClaimRateError;

  const claimRateError = await checkPersistentActionRateLimit({
    namespace: 'claim-model',
    identity: `${event.itemId}:${actor.actorId}`,
    maxRequests: CLAIM_CONFIG.maxAttempts,
    windowMs: CLAIM_CONFIG.attemptWindowMs,
    minIntervalMs: CLAIM_CONFIG.attemptCooldownMs,
    message: '认领描述校验过于频繁'
  });
  if (claimRateError) return claimRateError;

  const attemptCount = (existingRequest?.attemptCount || 0) + 1;
  let modelDecision;
  try {
    modelDecision = await verifyClaimDescriptionWithModel(safeItem, description);
  } catch (error) {
    modelDecision = normalizeClaimModelDecision({}, error.message || '模型不可用，转人工确认');
  }

  if (claimDecisionAllowsToken(modelDecision)) {
    await markClaimRequestModelVerified(existingRequest, description, modelDecision, descriptionFingerprint).catch((error) => {
      console.warn('Failed to update claim request after model verification.', error && (error.message || error));
    });
    return ok({
      status: 'verified',
      verified: true,
      claimToken: createClaimToken(event.itemId, actor.actorId),
      expiresInSeconds: Math.floor(CLAIM_CONFIG.tokenTtlMs / 1000),
      modelDecision
    });
  }

  const request = await upsertPendingClaimRequest({
    item,
    itemId: event.itemId,
    claimantOpenid: actor.actorId,
    claimantUser,
    description,
    descriptionFingerprint,
    modelDecision,
    attemptCount,
    existingRequest
  });
  const notificationNowMs = Date.now();
  if (shouldNotifyOwner(existingRequest || request, notificationNowMs, CLAIM_CONFIG.ownerNotificationCooldownMs)) {
    await createNotification(
      item.ownerOpenid,
      'claim_review',
      `${request.claimantName} 提交了敏感物品认领描述，等待你确认：${safeItem.title}`,
      event.itemId,
      actor.actorId
    ).catch(() => null);
    const notifyResult = await notifyOwnerClaimReviewRequested(item, request).catch((error) => {
      console.warn('Failed to send claim review email notification.', error && (error.message || error));
      return { sent: false };
    });
    await db.collection(COLLECTIONS.claimRequests).doc(request._id).update({
      data: {
        ownerNotifiedAtMs: notificationNowMs,
        ownerNotifiedAt: now(),
        ownerNotificationSent: Boolean(notifyResult.sent),
        updatedAt: now()
      }
    }).catch(() => null);
  }

  return ok({
    status: 'pending_review',
    requestId: request._id,
    modelDecision,
    message: '描述已提交发布者人工确认'
  });
}

async function reviewClaimRequest(event, context) {
  const actor = requireVerifiedActor(event);
  if (actor.error) return actor.error;
  const requestId = String(event.requestId || '').trim();
  const action = String(event.decision || event.reviewAction || '').trim();
  if (!requestId) return fail('缺少 requestId');
  if (!['approve', 'reject'].includes(action)) return fail('缺少有效审核动作', 'INVALID_REVIEW_ACTION');
  const ready = await ensureClaimRequestCollection();
  if (!ready) return fail('认领请求存储未就绪，请先创建 claim_requests 集合', 'CLAIM_REQUEST_STORE_ERROR');

  const reviewedAtMs = Date.now();
  const reviewedAt = now();
  const reviewData = {
    status: reviewStatusForDecision(action),
    reviewerOpenid: actor.actorId,
    reviewedAtMs,
    reviewedAt,
    updatedAt: reviewedAt
  };
  const reviewResult = await db.runTransaction(async (transaction) => {
    const requestDoc = transaction.collection(COLLECTIONS.claimRequests).doc(requestId);
    let request = null;
    try {
      request = (await requestDoc.get()).data;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    if (!request) return { error: fail('认领请求不存在', 'REQUEST_NOT_FOUND') };
    if (request.status !== 'pending_review') return { error: fail('该认领请求已处理', 'REQUEST_ALREADY_REVIEWED') };

    const itemDoc = transaction.collection(COLLECTIONS.items).doc(request.itemId);
    let item = null;
    try {
      item = (await itemDoc.get()).data;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    if (!item) return { error: fail('物品不存在', 'ITEM_NOT_FOUND') };
    if (item.ownerOpenid !== actor.actorId) return { error: fail('只能处理自己发布物品的认领请求', 'FORBIDDEN') };
    if (item.status === 'returned') return { error: fail('该物品已回家，不能重复认领', 'ALREADY_RETURNED') };

    await requestDoc.update({ data: reviewData });
    return { request, item };
  });
  if (reviewResult.error) return reviewResult.error;
  const { request, item } = reviewResult;

  if (action === 'reject') {
    await createNotification(request.claimantOpenid, 'claim_review', `发布者未通过你的认领描述：${sanitizeFoundItemPrivacy(item).title}`, request.itemId, actor.actorId).catch(() => null);
    return ok({ request: { _id: requestId, ...request, ...reviewData } });
  }

  await createNotification(request.claimantOpenid, 'claim_review', `发布者已通过你的认领描述；请查看图片后确认：${sanitizeFoundItemPrivacy(item).title}`, request.itemId, actor.actorId).catch(() => null);
  return ok({
    request: { _id: requestId, ...request, ...reviewData }
  });
}

async function getClaimRequestStatus(event) {
  const actor = requireVerifiedActor(event);
  if (actor.error) return actor.error;
  const requestId = String(event.requestId || '').trim();
  const itemId = String(event.itemId || '').trim();
  if (!requestId || !itemId) return fail('缺少 itemId 或 requestId');
  const ready = await ensureClaimRequestCollection();
  if (!ready) return fail('认领请求存储未就绪', 'CLAIM_REQUEST_STORE_ERROR');
  let request;
  try {
    request = (await db.collection(COLLECTIONS.claimRequests).doc(requestId).get()).data;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  if (!request || request.itemId !== itemId || request.claimantOpenid !== actor.actorId) {
    return fail('认领请求不存在', 'REQUEST_NOT_FOUND');
  }
  if (request.status === CLAIM_REQUEST_STATUS.APPROVED_TO_VIEW) {
    let item = null;
    try {
      item = (await db.collection(COLLECTIONS.items).doc(itemId).get()).data;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    const approvalStillValid = item
      && canCompleteActiveClaim(item)
      && isApprovedToViewRequest(request, itemId, actor.actorId, { notBeforeMs: claimTokenNotBeforeMs(item) });
    if (!approvalStillValid) {
      return ok({
        status: 'invalidated',
        requestId,
        message: '物品状态已变化，请重新提交认领描述'
      });
    }
    return ok({
      status: 'verified',
      requestId,
      claimToken: createClaimToken(itemId, actor.actorId),
      expiresInSeconds: Math.floor(CLAIM_CONFIG.tokenTtlMs / 1000),
      message: '发布者已通过，请查看图片后确认认领'
    });
  }
  return ok({
    status: request.status,
    requestId,
    message: request.status === CLAIM_REQUEST_STATUS.REJECTED ? '发布者未通过该认领描述' : '仍在等待发布者确认'
  });
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
    return fail('请先在云函数环境中配置模型服务凭据', 'MODEL_NOT_CONFIGURED');
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
    purpose: event.purpose || 'item',
    itemType: event.itemType || event.type || ''
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

  const data = sanitizeFoundItemPrivacy({
    type: event.itemType || event.type || '',
    title: semantic.title || category,
    description: visualDescription,
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
  return ok(data);
}

async function createItem(event, context) {
  const actor = requireVerifiedActor(event);
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
  const data = sanitizeFoundItemPrivacy({
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
    ownerName: payload.ownerName || '网页用户',
    createdAt: now(),
    updatedAt: now()
  });
  const created = await db.collection(COLLECTIONS.items).add({ data });
  const hydrated = await hydrateItemImages([{ _id: created._id, ...data }]);
  if (data.type === 'found') {
    const finderUser = await getUserByActorId(actor.actorId);
    await notifyLostOwnersAboutFoundMatch(hydrated[0], finderUser).catch((error) => {
      console.warn('Failed to send found-match email notifications.', error && (error.message || error));
    });
  } else if (data.type === 'lost') {
    const lostOwner = await getUserByActorId(actor.actorId);
    await notifyLostOwnerAboutExistingFoundMatches(hydrated[0], lostOwner).catch((error) => {
      console.warn('Failed to send existing-found match email notifications.', error && (error.message || error));
    });
  }
  return ok(hydrated[0]);
}

function verifyQQIngestSignature(event = {}) {
  if (!QQ_INGEST_CONFIG.secret) return fail('QQ 接入密钥未配置', 'QQ_INGEST_NOT_CONFIGURED');
  const timestamp = Number(event.timestamp || 0);
  const signature = String(event.signature || '').trim().toLowerCase();
  if (!timestamp || Math.abs(Date.now() - timestamp) > QQ_INGEST_CONFIG.signatureTtlMs) {
    return fail('QQ 接入签名已过期', 'INVALID_QQ_SIGNATURE');
  }
  const expected = hmac(QQ_INGEST_CONFIG.secret, qqSignatureMessage(event.action, timestamp, event.payload || {}), 'hex');
  return safeEqual(expected, signature) ? null : fail('QQ 接入签名无效', 'INVALID_QQ_SIGNATURE');
}

function verifyQQAdminSignature(event = {}) {
  if (!QQ_INGEST_CONFIG.adminSecret) return fail('QQ 审核密钥未配置', 'QQ_ADMIN_NOT_CONFIGURED');
  const timestamp = Number(event.timestamp || 0);
  const signature = String(event.signature || '').trim().toLowerCase();
  if (!timestamp || Math.abs(Date.now() - timestamp) > QQ_INGEST_CONFIG.signatureTtlMs) {
    return fail('QQ 审核签名已过期', 'INVALID_QQ_ADMIN_SIGNATURE');
  }
  const expected = hmac(QQ_INGEST_CONFIG.adminSecret, qqSignatureMessage(event.action, timestamp, event.payload || {}), 'hex');
  return safeEqual(expected, signature) ? null : fail('QQ 审核签名无效', 'INVALID_QQ_ADMIN_SIGNATURE');
}

function buildQQExtractionPrompt(payload = {}) {
  return [
    '你是校园失物招领结构化助手。结合群消息文字与图片，判断是否为真实失物/招领线索。',
    '只返回 JSON：isLostFound, confidence(0-1), type(found/lost), title, description, category, locationRaw, locationName, occurredAtText, sensitivityLevel(normal/important/sensitive), aiTags, reason。',
    'locationRaw 保留原文地点，locationName 规范为校园建筑或区域；无法确定时留空。',
    '校园卡、银行卡、证件、带姓名学号的纸张为 sensitive；手机、耳机、AirPods、钱包、钥匙、鼠标、耳机盒等贵重物品为 important；其余普通物品为 normal。',
    '不要抄录姓名、学号、卡号、手机号、二维码内容或任何唯一编号。',
    `群消息：${String(payload.text || '').slice(0, 1200) || '（无文字，仅有图片）'}`,
    `发送时间：${String(payload.sentAt || '').slice(0, 80) || '未知'}`
  ].join('\n');
}

async function resolveQQCampusLocation(extraction = {}) {
  const nowMs = Date.now();
  if (qqLocationCache.expiresAtMs <= nowMs) {
    const result = await db.collection(COLLECTIONS.locations).where({ enabled: true }).limit(100).get();
    qqLocationCache = { expiresAtMs: nowMs + 10 * 60 * 1000, locations: result.data || [] };
  }
  const requestedId = String(extraction.locationId || '').trim();
  if (requestedId) return qqLocationCache.locations.find((location) => location._id === requestedId) || null;
  const text = [extraction.locationName, extraction.locationRaw].filter(Boolean).join(' ');
  return matchCampusLocation(qqLocationCache.locations, text);
}

async function ingestQQBatch(event) {
  const signatureError = verifyQQIngestSignature(event);
  if (signatureError) return signatureError;
  const payload = event.payload || {};
  const messageIds = unique(payload.messageIds || []).sort();
  const groupName = String(payload.groupName || '').trim();
  const groupId = String(payload.groupId || '').trim();
  if (!messageIds.length || !groupId || !payload.senderId) return fail('QQ 事件缺少消息 ID、群或发送者', 'INVALID_QQ_EVENT');
  const groupAllowed = QQ_INGEST_CONFIG.allowedGroupIds.size
    ? QQ_INGEST_CONFIG.allowedGroupIds.has(groupId)
    : groupName === QQ_INGEST_CONFIG.allowedGroupName;
  if (!groupAllowed) return fail('该 QQ 群不在接入白名单', 'QQ_GROUP_NOT_ALLOWED');
  if (!await ensureQQCollections()) return fail('QQ 接入集合未就绪', 'QQ_STORE_ERROR');

  const batchId = sha256(`${groupId}:${messageIds.join(',')}`);
  const eventDoc = db.collection(COLLECTIONS.qqEvents).doc(batchId);
  const messageLockIds = messageIds.map((messageId) => `msg_${sha256(`${groupId}:${messageId}`)}`);
  const leaseNowMs = Date.now();
  const reservation = await db.runTransaction(async (transaction) => {
    const doc = transaction.collection(COLLECTIONS.qqEvents).doc(batchId);
    let existing = null;
    try {
      existing = (await doc.get()).data;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    if (existing?.result) return { acquired: false, result: existing.result };
    if (existing?.status === 'processing' && Number(existing.leaseExpiresAtMs || 0) > leaseNowMs) {
      return { acquired: false, processing: true };
    }
    for (const lockId of messageLockIds) {
      const lockDoc = transaction.collection(COLLECTIONS.qqEvents).doc(lockId);
      let lock = null;
      try {
        lock = (await lockDoc.get()).data;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
      if (lock?.status === 'completed' || (lock?.status === 'processing' && Number(lock.leaseExpiresAtMs || 0) > leaseNowMs)) {
        return { acquired: false, duplicateMessage: true, duplicateBatchId: lock.batchId || '' };
      }
    }
    await doc.set({
      data: {
        status: 'processing',
        leaseExpiresAtMs: leaseNowMs + 2 * 60 * 1000,
        messageIds,
        updatedAt: now()
      }
    });
    for (let index = 0; index < messageLockIds.length; index += 1) {
      await transaction.collection(COLLECTIONS.qqEvents).doc(messageLockIds[index]).set({
        data: {
          status: 'processing',
          batchId,
          groupId,
          messageId: messageIds[index],
          leaseExpiresAtMs: leaseNowMs + 2 * 60 * 1000,
          updatedAt: now()
        }
      });
    }
    return { acquired: true };
  });
  if (!reservation.acquired) {
    if (reservation.result) return ok({ ...reservation.result, duplicate: true });
    return ok({
      status: reservation.duplicateMessage ? 'duplicate_message' : 'processing',
      duplicate: true,
      duplicateBatchId: reservation.duplicateBatchId || '',
      replyText: ''
    });
  }

  const actorId = `qq:${sha256(`${groupId}:${payload.senderId}`).slice(0, 40)}`;
  const images = Array.isArray(payload.images) ? payload.images.slice(0, 6) : [];
  const preparedImages = await prepareItemImages(images, actorId, `qq:${batchId}`);
  const hydrated = (await hydrateItemImages([{
    _id: batchId,
    imageFileIds: preparedImages.imageFileIds,
    imageUrls: preparedImages.imageUrls
  }]))[0] || {};
  let rawExtraction = {};
  let modelError = '';
  const modelImages = unique(hydrated.imageUrls || (hydrated.image ? [hydrated.image] : [])).slice(0, 6);
  if (HUNYUAN_CONFIG.apiKey || (HUNYUAN_CONFIG.secretId && HUNYUAN_CONFIG.secretKey)) {
    try {
      rawExtraction = await callHunyuanVisionJson({
        imageUrls: modelImages,
        prompt: buildQQExtractionPrompt(payload),
        temperature: 0.1
      });
    } catch (error) {
      modelError = error.message || '模型提取失败';
    }
  } else {
    modelError = '模型未配置';
  }
  if (!Object.keys(rawExtraction || {}).length) {
    const fallback = classifyByText(payload.text || '');
    rawExtraction = {
      isLostFound: Boolean(images.length || String(payload.text || '').trim()),
      confidence: images.length ? 0.5 : 0.35,
      type: 'found',
      title: fallback.category || 'QQ群失物招领',
      description: payload.text || '来自QQ群的图片线索',
      category: fallback.category || '其他',
      locationRaw: '',
      locationName: '',
      aiTags: fallback.aiTags || [],
      reason: modelError
    };
  }

  const extraction = normalizeQQExtraction(rawExtraction, payload.text || '');
  const matchedLocation = await resolveQQCampusLocation(extraction).catch(() => null);
  const privacySafe = sanitizeFoundItemPrivacy({
    ...extraction,
    type: extraction.type,
    locationSuggested: extraction.locationName,
    locationId: matchedLocation?._id || '',
    locationName: matchedLocation?.name || '',
    locationArea: matchedLocation?.area || '',
    locationNearby: matchedLocation?.nearby || [],
    locationGuide: matchedLocation?.detail || '',
    mapX: optionalNumber(matchedLocation?.mapX),
    mapY: optionalNumber(matchedLocation?.mapY),
    latitude: optionalNumber(matchedLocation?.latitude),
    longitude: optionalNumber(matchedLocation?.longitude)
  });
  let route = routeQQExtraction(privacySafe, {
    high: QQ_INGEST_CONFIG.highConfidence,
    medium: QQ_INGEST_CONFIG.mediumConfidence
  });
  route = applyQQRouteGuards(route, {
    importMode: String(payload.importMode || ''),
    isProtected: isProtectedFoundItem(privacySafe),
    hasReviewOwner: Boolean(QQ_INGEST_CONFIG.reviewOwnerActorId)
  });
  const source = {
    platform: 'qq',
    groupId,
    groupName,
    messageId: messageIds[0],
    messageIds,
    senderHash: sha256(String(payload.senderId)),
    sentAt: String(payload.sentAt || ''),
    ingestedAtMs: Date.now()
  };
  if (payload.importMode === 'loose_images') {
    source.importMode = 'loose_images';
    source.identifiersSynthetic = true;
  }
  let result;

  if (route === 'published') {
    const itemData = sanitizeFoundItemPrivacy({
      type: privacySafe.type,
      title: privacySafe.title,
      description: privacySafe.description,
      category: privacySafe.category,
      aiTags: privacySafe.aiTags,
      imageFileIds: preparedImages.imageFileIds,
      imageUrls: [],
      thumbUrl: '',
      visualDescription: privacySafe.description,
      locationId: privacySafe.locationId,
      locationName: privacySafe.locationName,
      locationArea: privacySafe.locationArea || 'QQ 群线索',
      locationNearby: privacySafe.locationNearby || [],
      locationGuide: privacySafe.locationGuide || '',
      locationDetail: privacySafe.locationRaw,
      mapX: privacySafe.mapX,
      mapY: privacySafe.mapY,
      latitude: privacySafe.latitude,
      longitude: privacySafe.longitude,
      occurredAtText: privacySafe.occurredAtText,
      status: 'active',
      ownerOpenid: QQ_INGEST_CONFIG.reviewOwnerActorId || actorId,
      ownerName: '上科大健忘者互助协会',
      source,
      createdAt: now(),
      updatedAt: now()
    });
    const itemId = `qq_${batchId.slice(0, 28)}`;
    await db.collection(COLLECTIONS.items).doc(itemId).set({ data: itemData });
    const itemUrl = QQ_INGEST_CONFIG.publicBaseUrl ? `${QQ_INGEST_CONFIG.publicBaseUrl}/?item=${encodeURIComponent(itemId)}` : '';
    const replyText = `已录入 LockMyItem${itemUrl ? `：${itemUrl}` : ''}`;
    await db.collection(COLLECTIONS.qqOutbox).doc(`qqo_${batchId.slice(0, 28)}`).set({
      data: {
        status: 'pending',
        groupId,
        messageId: messageIds[0],
        replyUntilMs: qqReplyDeadlineMs(source.sentAt),
        content: replyText,
        attempts: 0,
        createdAt: now(),
        updatedAt: now()
      }
    });
    result = { status: 'published', itemId, itemUrl, replyText, replyQueued: true };
  } else if (route === 'needs_review') {
    const draftId = `qqd_${batchId.slice(0, 28)}`;
    await db.collection(COLLECTIONS.qqDrafts).doc(draftId).set({
      data: {
        status: 'pending_review',
        extraction: privacySafe,
        imageFileIds: preparedImages.imageFileIds,
        source,
        modelError,
        createdAt: now(),
        updatedAt: now()
      }
    });
    result = { status: 'needs_review', draftId, replyText: '' };
  } else {
    if (preparedImages.imageFileIds.length) {
      await cloud.deleteFile({ fileList: preparedImages.imageFileIds }).catch(() => null);
    }
    result = { status: 'ignored', replyText: '' };
  }

  await eventDoc.set({ data: { status: 'completed', source, route, result, leaseExpiresAtMs: 0, createdAt: now(), updatedAt: now() } });
  await Promise.all(messageLockIds.map((lockId) => db.collection(COLLECTIONS.qqEvents).doc(lockId).update({
    data: { status: 'completed', batchId, resultStatus: result.status, leaseExpiresAtMs: 0, updatedAt: now() }
  }).catch(() => null)));
  return ok(result);
}

async function listQQDrafts(event) {
  const signatureError = verifyQQAdminSignature(event);
  if (signatureError) return signatureError;
  if (!await ensureQQCollections()) return fail('QQ 接入集合未就绪', 'QQ_STORE_ERROR');
  const limit = Math.min(50, Math.max(1, Number(event.payload?.limit || 20)));
  const drafts = await db.collection(COLLECTIONS.qqDrafts)
    .where({ status: 'pending_review' })
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return ok({ drafts: (drafts.data || []).map((draft) => ({
    id: draft._id,
    extraction: draft.extraction,
    source: draft.source,
    createdAt: draft.createdAt
  })) });
}

async function reviewQQDraft(event) {
  const signatureError = verifyQQAdminSignature(event);
  if (signatureError) return signatureError;
  const draftId = String(event.payload?.draftId || '').trim();
  const decision = String(event.payload?.decision || '').trim();
  if (!draftId || !['approve', 'reject'].includes(decision)) return fail('缺少有效 draftId 或审核动作');
  if (!await ensureQQCollections()) return fail('QQ 接入集合未就绪', 'QQ_STORE_ERROR');
  const draft = (await db.collection(COLLECTIONS.qqDrafts).doc(draftId).get()).data;
  if (!draft) return fail('QQ 草稿不存在', 'QQ_DRAFT_NOT_FOUND');
  if (draft.status !== 'pending_review') return fail('QQ 草稿已处理', 'QQ_DRAFT_ALREADY_REVIEWED');
  if (decision === 'reject') {
    const rejectedAt = now();
    const rejection = await db.runTransaction(async (transaction) => {
      const doc = transaction.collection(COLLECTIONS.qqDrafts).doc(draftId);
      const current = (await doc.get()).data;
      if (!current || current.status !== 'pending_review') {
        return { error: fail('QQ 草稿已处理', 'QQ_DRAFT_ALREADY_REVIEWED') };
      }
      await doc.update({ data: { status: 'rejected', reviewedAt: rejectedAt, updatedAt: rejectedAt } });
      return { draft: current };
    });
    if (rejection.error) return rejection.error;
    if (Array.isArray(draft.imageFileIds) && draft.imageFileIds.length) {
      await cloud.deleteFile({ fileList: draft.imageFileIds }).catch(() => null);
    }
    return ok({ status: 'rejected', draftId });
  }

  const corrected = applyQQReviewCorrections(draft.extraction || {}, event.payload?.corrections || {});
  if (!corrected.title || !corrected.description || !corrected.category) {
    return fail('批准前必须补全标题、描述和分类', 'QQ_REVIEW_FIELDS_REQUIRED');
  }
  const matchedLocation = await resolveQQCampusLocation(corrected).catch(() => null);
  if (!matchedLocation) {
    return fail('批准前必须选择唯一有效的校园地点', 'QQ_REVIEW_LOCATION_REQUIRED');
  }
  const extraction = sanitizeFoundItemPrivacy({
    ...corrected,
    type: corrected.type || 'found',
    locationId: matchedLocation._id,
    locationName: matchedLocation.name,
    locationArea: matchedLocation.area || '',
    locationNearby: matchedLocation.nearby || [],
    locationGuide: matchedLocation.detail || '',
    mapX: optionalNumber(matchedLocation.mapX),
    mapY: optionalNumber(matchedLocation.mapY),
    latitude: optionalNumber(matchedLocation.latitude),
    longitude: optionalNumber(matchedLocation.longitude)
  });
  if (isProtectedFoundItem(extraction) && !QQ_INGEST_CONFIG.reviewOwnerActorId) {
    return fail('敏感 QQ 物品需要先配置 QQ_REVIEW_OWNER_EMAIL 或 QQ_REVIEW_OWNER_ACTOR_ID，供人工认领复核', 'QQ_REVIEW_OWNER_REQUIRED');
  }
  const itemData = sanitizeFoundItemPrivacy({
    type: extraction.type,
    title: extraction.title,
    description: extraction.description,
    category: extraction.category,
    aiTags: extraction.aiTags || [],
    imageFileIds: draft.imageFileIds || [],
    imageUrls: [],
    thumbUrl: '',
    visualDescription: extraction.description,
    locationId: extraction.locationId || '',
    locationName: extraction.locationName,
    locationArea: extraction.locationArea || 'QQ 群线索',
    locationNearby: extraction.locationNearby || [],
    locationGuide: extraction.locationGuide || '',
    locationDetail: extraction.locationRaw,
    mapX: optionalNumber(extraction.mapX),
    mapY: optionalNumber(extraction.mapY),
    latitude: optionalNumber(extraction.latitude),
    longitude: optionalNumber(extraction.longitude),
    occurredAtText: extraction.occurredAtText,
    status: 'active',
    ownerOpenid: QQ_INGEST_CONFIG.reviewOwnerActorId || `qq:${sha256(`${draft.source?.groupId || ''}:${draft.source?.senderHash || ''}`).slice(0, 40)}`,
    ownerName: '上科大健忘者互助协会',
    source: draft.source,
    createdAt: now(),
    updatedAt: now()
  });
  const itemId = `qq_${sha256(`draft:${draftId}`).slice(0, 28)}`;
  const itemUrl = QQ_INGEST_CONFIG.publicBaseUrl ? `${QQ_INGEST_CONFIG.publicBaseUrl}/?item=${encodeURIComponent(itemId)}` : '';
  const replyText = `已录入 LockMyItem${itemUrl ? `：${itemUrl}` : ''}`;
  const approvedAt = now();
  const approval = await db.runTransaction(async (transaction) => {
    const draftDoc = transaction.collection(COLLECTIONS.qqDrafts).doc(draftId);
    const current = (await draftDoc.get()).data;
    if (!current || current.status !== 'pending_review') {
      return { error: fail('QQ 草稿已处理', 'QQ_DRAFT_ALREADY_REVIEWED') };
    }
    await transaction.collection(COLLECTIONS.items).doc(itemId).set({ data: itemData });
    if (draft.source?.groupId && draft.source?.messageId) {
      await transaction.collection(COLLECTIONS.qqOutbox).doc(`qqoa_${sha256(draftId).slice(0, 27)}`).set({
        data: {
          status: 'pending',
          groupId: draft.source.groupId,
          messageId: draft.source.messageId,
          replyUntilMs: qqReplyDeadlineMs(draft.source.sentAt),
          content: replyText,
          attempts: 0,
          createdAt: approvedAt,
          updatedAt: approvedAt
        }
      });
    }
    await draftDoc.update({
      data: { status: 'approved', itemId, reviewedAt: approvedAt, updatedAt: approvedAt }
    });
    return { approved: true };
  });
  if (approval.error) return approval.error;
  return ok({ status: 'published', draftId, itemId, itemUrl, replyText });
}

async function pullQQOutbox(event) {
  const signatureError = verifyQQIngestSignature(event);
  if (signatureError) return signatureError;
  if (!await ensureQQCollections()) return fail('QQ 接入集合未就绪', 'QQ_STORE_ERROR');
  const nowMs = Date.now();
  const expired = await db.collection(COLLECTIONS.qqOutbox)
    .where({ status: 'processing', leaseExpiresAtMs: _.lt(nowMs) })
    .limit(10)
    .get();
  await Promise.all((expired.data || []).map((entry) => db.collection(COLLECTIONS.qqOutbox).doc(entry._id).update({
    data: { status: 'pending', updatedAt: now() }
  }).catch(() => null)));
  const pending = await db.collection(COLLECTIONS.qqOutbox)
    .where({ status: 'pending' })
    .orderBy('createdAt', 'asc')
    .limit(Math.min(10, Math.max(1, Number(event.payload?.limit || 5))))
    .get();
  const messages = [];
  for (const candidate of pending.data || []) {
    const claimed = await db.runTransaction(async (transaction) => {
      const doc = transaction.collection(COLLECTIONS.qqOutbox).doc(candidate._id);
      const current = (await doc.get()).data;
      if (!current || current.status !== 'pending') return null;
      await doc.update({
        data: { status: 'processing', leaseExpiresAtMs: nowMs + 60 * 1000, attempts: _.inc(1), updatedAt: now() }
      });
      return {
        id: candidate._id,
        groupId: current.groupId,
        messageId: qqReplyMessageId(current.messageId, current.replyUntilMs, nowMs),
        content: current.content
      };
    });
    if (claimed) messages.push(claimed);
  }
  return ok({ messages });
}

async function ackQQOutbox(event) {
  const signatureError = verifyQQIngestSignature(event);
  if (signatureError) return signatureError;
  const outboxId = String(event.payload?.outboxId || '').trim();
  const sent = event.payload?.sent === true;
  if (!outboxId) return fail('缺少 outboxId');
  const current = (await db.collection(COLLECTIONS.qqOutbox).doc(outboxId).get()).data;
  if (!current) return fail('回复任务不存在', 'QQ_OUTBOX_NOT_FOUND');
  const attempts = Number(current.attempts || 0);
  await db.collection(COLLECTIONS.qqOutbox).doc(outboxId).update({
    data: {
      status: sent ? 'sent' : (attempts >= 5 ? 'failed' : 'pending'),
      lastError: sent ? '' : String(event.payload?.error || 'QQ reply failed').slice(0, 300),
      leaseExpiresAtMs: 0,
      sentAt: sent ? now() : null,
      updatedAt: now()
    }
  });
  return ok({ outboxId, status: sent ? 'sent' : (attempts >= 5 ? 'failed' : 'pending') });
}

async function listItems(event) {
  const filters = event.filters || {};
  const actorId = getActorId({}, event);
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
  const visibleItems = (result.data || [])
    .map((item) => sanitizeItemForViewer(item, event, actorId));
  const items = await hydrateItemImages(visibleItems);
  return ok({ items, nextCursor: (filters.cursor || 0) + result.data.length });
}

async function getItemDetail(event) {
  const actorId = getActorId({}, event);
  const item = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const comments = await db.collection(COLLECTIONS.comments)
    .where({ itemId: event.itemId, status: 'active' })
    .orderBy('createdAt', 'asc')
    .get();
  const items = await hydrateItemImages([item.data]);
  const visibleItem = sanitizeItemForViewer(items[0], event, actorId);
  const claimRequests = itemBelongsToActor(items[0], actorId) && isProtectedFoundItem(sanitizeFoundItemPrivacy(items[0]))
    ? await listPendingClaimRequests(event.itemId)
    : [];
  return ok({
    item: visibleItem,
    comments: sanitizeCommentsForViewer(comments.data, canSeeClaimantInfo(items[0], actorId)),
    claimRequests
  });
}

async function createComment(event, context) {
  const actor = requireVerifiedActor(event);
  if (actor.error) return actor.error;
  const content = (event.content || '').trim();
  if (!content) return fail('评论不能为空');
  if (BAD_WORDS.some((word) => content.includes(word))) return fail('评论包含敏感词');
  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  const data = {
    itemId: event.itemId,
    authorOpenid: actor.actorId,
    authorName: event.authorName || '网页用户',
    content,
    status: 'active',
    createdAt: now()
  };
  const created = await db.collection(COLLECTIONS.comments).add({ data });
  if (item.ownerOpenid !== actor.actorId) {
    const safeItem = sanitizeFoundItemPrivacy(item);
    await createNotification(item.ownerOpenid, 'comment', `${data.authorName} 评论了你的帖子：${safeItem.title}`, event.itemId, actor.actorId);
  }
  return ok({ _id: created._id, ...data });
}

async function sendThanks(event, context) {
  const actor = requireVerifiedActor(event);
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
  const actor = requireVerifiedActor(event);
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
      claimTokenNotBefore: now(),
      claimImageResetReason: returned ? 'owner_marked_returned' : 'owner_reopened_item',
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
  const actor = requireVerifiedActor(event);
  if (actor.error) return actor.error;
  if (!event.itemId) return fail('缺少 itemId');

  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  if (!item) return fail('物品不存在', 'ITEM_NOT_FOUND');
  if (item.type !== 'found') return fail('只能认领招领物品', 'INVALID_ITEM_TYPE');
  if (item.status === 'returned') return fail('该物品已回家，不能重复认领', 'ALREADY_RETURNED');
  if (item.ownerOpenid === actor.actorId) return fail('不能认领自己发布的物品', 'FORBIDDEN');

  let approvedRequest = null;
  if (isProtectedFoundItem(sanitizeFoundItemPrivacy(item))) {
    const tokenPayload = verifyClaimToken(event.claimToken, event.itemId, actor.actorId);
    const validToken = claimTokenAllowsItem(tokenPayload, item);
    approvedRequest = await getApprovedClaimRequest(event.requestId, event.itemId, actor.actorId, item);
    if (!validToken && !approvedRequest) {
      return fail('敏感卡面物品需先提交特征描述，通过后才能认领', 'CLAIM_VERIFICATION_REQUIRED');
    }
  }

  const claimantUser = await getUserByActorId(actor.actorId);
  const result = await completeClaim({
    itemId: event.itemId,
    item,
    claimantOpenid: actor.actorId,
    claimantUser,
    claimantName: event.claimantName || event.nickName,
    claimantContact: event.claimantContact || event.contact,
    notifyOwner: true
  });
  if (result.conflict) return fail('该物品已回家，不能重复认领', 'ALREADY_RETURNED');
  if (approvedRequest?._id) {
    await db.collection(COLLECTIONS.claimRequests).doc(approvedRequest._id).update({
      data: { status: CLAIM_REQUEST_STATUS.COMPLETED, completedAt: now(), updatedAt: now() }
    }).catch(() => null);
  }
  return ok(result);
}

async function reportContent(event, context) {
  const actor = requireVerifiedActor(event);
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
    if (typeof event.body === 'string') {
      const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      event = JSON.parse(rawBody || '{}');
    } else if (event.body && typeof event.body === 'object') {
      event = event.body;
    }
    const context = cloud.getWXContext();
    switch (event.action) {
      case 'login':
        return await login(event, context);
      case 'sendEmailCode':
        return await sendEmailCode(event, context);
      case 'registerWithEmail':
        return await registerWithEmail(event);
      case 'loginWithEmailPassword':
        return await loginWithEmailPassword(event);
      case 'loginWithEmailCode':
        return await loginWithEmailCode(event);
      case 'updateUserProfile':
        return await updateUserProfile(event);
      case 'createItem':
        return await createItem(event, context);
      case 'classifyImage':
        return await classifyImage(event, context);
      case 'ingestQQBatch':
        return await ingestQQBatch(event);
      case 'listQQDrafts':
        return await listQQDrafts(event);
      case 'reviewQQDraft':
        return await reviewQQDraft(event);
      case 'pullQQOutbox':
        return await pullQQOutbox(event);
      case 'ackQQOutbox':
        return await ackQQOutbox(event);
      case 'listItems':
        return await listItems(event);
      case 'getItemDetail':
        return await getItemDetail(event);
      case 'listLocations':
        return await listLocations(event);
      case 'createComment':
        return await createComment(event, context);
      case 'verifyClaimDescription':
        return await verifyClaimDescription(event, context);
      case 'reviewClaimRequest':
        return await reviewClaimRequest(event, context);
      case 'getClaimRequestStatus':
        return await getClaimRequestStatus(event);
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
