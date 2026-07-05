const cloud = require('wx-server-sdk');
const fetch = require('node-fetch');
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
  locations: 'campus_locations'
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

function ok(data = {}) {
  return { ok: true, data };
}

function fail(message, code = 'BAD_REQUEST') {
  return { ok: false, code, message };
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

function unique(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
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

function sha256(value, encoding = 'hex') {
  return crypto.createHash('sha256').update(value, 'utf8').digest(encoding);
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
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

function buildVisionPrompt(hint = '') {
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
  const endpoint = `${HUNYUAN_CONFIG.baseUrl}/chat/completions`;
  const prompt = buildVisionPrompt(payload.hint);

  const response = await fetch(endpoint, {
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
  const endpointHost = new URL(HUNYUAN_CONFIG.tencentEndpoint).host;
  const requestBody = {
    Model: HUNYUAN_CONFIG.model,
    Stream: false,
    Temperature: 0.2,
    Messages: [
      {
        Role: 'user',
        Contents: [
          { Type: 'text', Text: buildVisionPrompt(payload.hint) },
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

  const response = await fetch(HUNYUAN_CONFIG.tencentEndpoint, {
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

async function createNotification(userOpenid, type, content, itemId, actorOpenid) {
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

async function login(event, context) {
  const user = await ensureUser(context.OPENID, event.profile || {});
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

async function getPublicConfig() {
  return ok({
    locationPicker: {
      key: process.env.TENCENT_MAP_KEY || process.env.LOCATION_PICKER_KEY || '',
      referer: process.env.TENCENT_MAP_REFERER || 'LockMyItem',
      category: process.env.TENCENT_MAP_CATEGORY || '大学,餐饮,生活服务'
    }
  });
}

async function classifyImage(event) {
  if (!HUNYUAN_CONFIG.apiKey && !(HUNYUAN_CONFIG.secretId && HUNYUAN_CONFIG.secretKey)) {
    return fail('请先配置 HUNYUAN_API_KEY 或 TENCENT_SECRET_ID/TENCENT_SECRET_KEY', 'MODEL_NOT_CONFIGURED');
  }
  if (!event.fileId && !event.imageUrl && !event.imageBase64) {
    return fail('缺少图片 fileId、imageUrl 或 imageBase64');
  }

  let imageUrl = event.imageUrl || '';
  if (!imageUrl && event.imageBase64) {
    imageUrl = normalizeImageBase64(event.imageBase64, event.mimeType || event.contentType || 'image/jpeg');
  }
  if (!imageUrl && event.fileId) {
    const tempResult = await cloud.getTempFileURL({ fileList: [event.fileId] });
    const file = tempResult.fileList && tempResult.fileList[0];
    if (!file || !file.tempFileURL) return fail('无法获取图片临时链接');
    imageUrl = file.tempFileURL;
  }

  const payload = {
    imageUrl,
    fileId: event.fileId || '',
    hint: event.hint || ''
  };
  const semantic = await callHunyuanVision(payload);
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
  const payload = event.payload || {};
  if (!(payload.imageUrls || []).length && !payload.category) return fail('请上传图片或选择分类');
  let location = null;
  if (payload.locationId) {
    const locationResult = await db.collection(COLLECTIONS.locations).doc(payload.locationId).get();
    location = locationResult.data;
  }
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
    imageUrls: payload.imageUrls || [],
    thumbUrl: (payload.imageUrls || [])[0] || '',
    visualDescription: payload.visualDescription || '',
    yoloObjects: payload.yoloObjects || [],
    semanticTags: payload.semanticTags || [],
    imageEmbedding: payload.imageEmbedding || [],
    semanticEmbedding: payload.semanticEmbedding || [],
    locationId: location ? location._id : '',
    locationName: location ? location.name : '',
    locationDetail: '',
    mapX: location ? location.mapX : null,
    mapY: location ? location.mapY : null,
    status: 'active',
    ownerOpenid: context.OPENID,
    ownerName: payload.ownerName || '微信用户',
    createdAt: now(),
    updatedAt: now()
  };
  const created = await db.collection(COLLECTIONS.items).add({ data });
  return ok({ _id: created._id, ...data });
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
  return ok({ items: result.data, nextCursor: (filters.cursor || 0) + result.data.length });
}

async function getItemDetail(event) {
  const item = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const comments = await db.collection(COLLECTIONS.comments)
    .where({ itemId: event.itemId, status: 'active' })
    .orderBy('createdAt', 'asc')
    .get();
  return ok({ item: item.data, comments: comments.data });
}

async function createComment(event, context) {
  const content = (event.content || '').trim();
  if (!content) return fail('评论不能为空');
  if (BAD_WORDS.some((word) => content.includes(word))) return fail('评论包含敏感词');
  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  const data = {
    itemId: event.itemId,
    authorOpenid: context.OPENID,
    authorName: event.authorName || '微信用户',
    content,
    status: 'active',
    createdAt: now()
  };
  const created = await db.collection(COLLECTIONS.comments).add({ data });
  if (item.ownerOpenid !== context.OPENID) {
    await createNotification(item.ownerOpenid, 'comment', `${data.authorName} 评论了你的帖子：${item.title}`, event.itemId, context.OPENID);
  }
  return ok({ _id: created._id, ...data });
}

async function sendThanks(event, context) {
  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  if (item.ownerOpenid === context.OPENID) return fail('不能感谢自己发布的帖子');
  const existed = await db.collection(COLLECTIONS.thanks)
    .where({ itemId: event.itemId, fromOpenid: context.OPENID })
    .limit(1)
    .get();
  if (existed.data.length) return ok(existed.data[0]);
  const data = {
    itemId: event.itemId,
    fromOpenid: context.OPENID,
    toOpenid: item.ownerOpenid,
    createdAt: now()
  };
  const created = await db.collection(COLLECTIONS.thanks).add({ data });
  await createNotification(item.ownerOpenid, 'thanks', '有同学感谢了你发布的失物招领线索', event.itemId, context.OPENID);
  return ok({ _id: created._id, ...data });
}

async function updateReturnStatus(event, context, returned) {
  const itemResult = await db.collection(COLLECTIONS.items).doc(event.itemId).get();
  const item = itemResult.data;
  if (item.ownerOpenid !== context.OPENID) return fail('只能操作自己的帖子', 'FORBIDDEN');
  await db.collection(COLLECTIONS.items).doc(event.itemId).update({
    data: {
      status: returned ? 'returned' : 'active',
      returnedAt: returned ? now() : null,
      updatedAt: now()
    }
  });
  return ok({ itemId: event.itemId, status: returned ? 'returned' : 'active' });
}

async function reportContent(event, context) {
  const data = {
    targetType: event.targetType,
    targetId: event.targetId,
    reason: event.reason || '用户举报',
    reporterOpenid: context.OPENID,
    status: 'open',
    createdAt: now()
  };
  const created = await db.collection(COLLECTIONS.reports).add({ data });
  return ok({ _id: created._id, ...data });
}

exports.main = async (event) => {
  const context = cloud.getWXContext();
  try {
    switch (event.action) {
      case 'login':
        return login(event, context);
      case 'createItem':
        return createItem(event, context);
      case 'classifyImage':
        return classifyImage(event);
      case 'listItems':
        return listItems(event);
      case 'getItemDetail':
        return getItemDetail(event);
      case 'listLocations':
        return listLocations(event);
      case 'getPublicConfig':
        return getPublicConfig();
      case 'createComment':
        return createComment(event, context);
      case 'sendThanks':
        return sendThanks(event, context);
      case 'markReturned':
        return updateReturnStatus(event, context, true);
      case 'undoReturned':
        return updateReturnStatus(event, context, false);
      case 'reportContent':
        return reportContent(event, context);
      default:
        return fail(`未知 action: ${event.action}`);
    }
  } catch (error) {
    return fail(error.message || '服务异常', 'INTERNAL_ERROR');
  }
};
