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

function envValue(value = '') {
  return String(value || '').trim();
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTencentMapSk(value = '') {
  return envValue(value).replace(/^sk\s*[:：]\s*/i, '');
}

const TENCENT_MAP_CONFIG = {
  key: envValue(process.env.TENCENT_MAP_KEY),
  sk: normalizeTencentMapSk(process.env.TENCENT_MAP_SK || process.env.TENCENT_MAP_SECRET_KEY),
  networkUrl: envValue(process.env.TENCENT_MAP_NETWORK_URL) || 'https://apis.map.qq.com/ws/location/v1/network'
};

const AMAP_CONFIG = {
  key: envValue(process.env.AMAP_KEY || process.env.GAODE_MAP_KEY),
  hardwareUrl: envValue(process.env.AMAP_HARDWARE_URL) || 'https://restapi.amap.com/v5/position/IoT',
  deviceId: envValue(process.env.AMAP_DEVICE_ID) || 'shanghaitech-findloss-miniprogram'
};

const BAIDU_LOC_CONFIG = {
  key: envValue(process.env.BAIDU_LOC_KEY || process.env.BAIDU_MAP_AK || process.env.BAIDU_AK),
  hardwareUrl: envValue(process.env.BAIDU_LOC_URL) || 'https://api.map.baidu.com/locapi/v2',
  src: envValue(process.env.BAIDU_LOC_SRC) || 'shanghaitech_findloss',
  prod: envValue(process.env.BAIDU_LOC_PROD) || 'lockmyitem',
  deviceId: envValue(process.env.BAIDU_LOC_DEVICE_ID) || 'shanghaitech-findloss-miniprogram'
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

function normalizeSignalRssi(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return -85;
  if (number < 0) return Math.round(number);
  return Math.round(-100 + Math.min(100, number) * 0.5);
}

function normalizeMac(value) {
  return String(value || '').trim().replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}

function formatMacWithColons(value) {
  const mac = normalizeMac(value);
  if (mac.length !== 12) return '';
  return mac.match(/.{1,2}/g).join(':');
}

function wifiEntriesFromEvent(event = {}) {
  const wifi = event.wifi || {};
  const entries = []
    .concat(wifi.connected ? [wifi.connected] : [])
    .concat(wifi.list || []);
  const seen = {};
  return entries.filter((entry) => {
    const mac = normalizeMac(entry.BSSID || entry.bssid || entry.mac);
    if (!mac || seen[mac]) return false;
    seen[mac] = true;
    return true;
  });
}

function tencentMapSignatureValue(value) {
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildTencentMapSig(pathname, payload, queryParams = {}) {
  const params = { ...queryParams, ...payload };
  delete params.sig;
  const query = Object.keys(params)
    .sort()
    .map((key) => `${key}=${tencentMapSignatureValue(params[key])}`)
    .join('&');
  return crypto.createHash('md5').update(`${pathname}?${query}${TENCENT_MAP_CONFIG.sk}`, 'utf8').digest('hex').toLowerCase();
}

function buildIndoorNetworkPayload(event = {}) {
  const ble = event.ble || {};
  const wifiinfo = wifiEntriesFromEvent(event)
    .map((entry) => ({
      mac: normalizeMac(entry.BSSID || entry.bssid || entry.mac),
      rssi: normalizeSignalRssi(entry.signalStrength || entry.RSSI || entry.rssi)
    }))
    .filter((entry) => entry.mac)
    .slice(0, 30);
  const beaconinfo = (ble.devices || [])
    .map((device) => ({
      mac: normalizeMac(device.deviceId || device.mac),
      rssi: normalizeSignalRssi(device.RSSI || device.rssi),
      time: Date.now()
    }))
    .filter((entry) => entry.mac)
    .slice(0, 30);
  const payload = {
    key: TENCENT_MAP_CONFIG.key,
    device_id: event.deviceId || 'shanghaitech-findloss-indoor'
  };
  if (wifiinfo.length) payload.wifiinfo = wifiinfo;
  if (beaconinfo.length) payload.beaconinfo = beaconinfo;
  return payload;
}

function baiduWifiRssi(entry = {}) {
  const rssi = Number(entry.RSSI || entry.rssi);
  if (Number.isFinite(rssi) && rssi !== 0) return Math.round(rssi);
  return normalizeSignalRssi(entry.signalStrength);
}

function buildBaiduHardwarePayload(event = {}) {
  const entries = wifiEntriesFromEvent(event)
    .map((entry) => ({
      mac: formatMacWithColons(entry.BSSID || entry.bssid || entry.mac),
      rssi: baiduWifiRssi(entry),
      ssid: String(entry.SSID || entry.ssid || '').replace(/[|,;]/g, '').slice(0, 32)
    }))
    .filter((entry) => entry.mac)
    .slice(0, 30);
  if (entries.length < 2) return null;
  const traceId = event.traceId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = {
    imei: event.deviceId || BAIDU_LOC_CONFIG.deviceId,
    accesstype: '1',
    macs: entries.map((entry) => `${entry.mac},${entry.rssi},${entry.ssid}`).join('|'),
    mmac: `${entries[0].mac},${entries[0].rssi},${entries[0].ssid}`,
    ctime: String(Math.floor(Date.now() / 1000)),
    need_rgc: 'Y',
    coor: 'GCJ02'
  };
  return {
    key: BAIDU_LOC_CONFIG.key,
    src: BAIDU_LOC_CONFIG.src,
    prod: BAIDU_LOC_CONFIG.prod,
    ver: '1.0',
    trace: traceId,
    body
  };
}

function baiduResultCandidates(data = {}) {
  const buckets = [
    data.result,
    data.results,
    data.body,
    data.content,
    data.data,
    data
  ];
  return buckets.reduce((list, entry) => {
    if (!entry) return list;
    if (Array.isArray(entry)) return list.concat(entry);
    return list.concat([entry]);
  }, []);
}

function parseBaiduLocation(data = {}) {
  const candidate = baiduResultCandidates(data).find((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.error !== undefined && Number(entry.error) !== 0) return false;
    return entry.location || entry.loc || entry.lng || entry.longitude;
  });
  if (!candidate) return null;
  const locationText = candidate.location || candidate.loc || '';
  const parts = String(locationText).split(',');
  const longitude = Number(candidate.longitude || candidate.lng || parts[0]);
  const latitude = Number(candidate.latitude || candidate.lat || parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    accuracy: Number(candidate.radius || candidate.accuracy || candidate.precision) || 0,
    confidence: candidate.radius ? Math.max(0, Math.min(1, 1 - Number(candidate.radius) / 300)) : 0,
    address: candidate.addr || candidate.address || candidate.formatted_address || '',
    adInfo: {
      city: candidate.city || '',
      adcode: candidate.adcode || ''
    },
    requestId: data.trace || data.request_id || '',
    rawInfo: data.message || data.msg || ''
  };
}

async function callBaiduHardwareLocation(event = {}) {
  if (!BAIDU_LOC_CONFIG.key) {
    return fail('百度智能硬件定位未配置 BAIDU_LOC_KEY', 'BAIDU_NOT_CONFIGURED');
  }
  const payload = buildBaiduHardwarePayload(event);
  if (!payload) {
    return fail('未采集到百度定位所需的 2 个以上 Wi-Fi 信号', 'BAIDU_SIGNAL_EMPTY');
  }
  const response = await fetch(BAIDU_LOC_CONFIG.hardwareUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 8000
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || Number(data.status) !== 0) {
    const message = data.message || data.msg || data.info || `百度智能硬件定位失败 HTTP ${response.status}`;
    return fail(message, 'BAIDU_NETWORK_FAILED');
  }
  const location = parseBaiduLocation(data);
  if (!location) {
    return fail(data.message || data.msg || '百度未返回可用坐标', 'BAIDU_LOCATION_EMPTY');
  }
  return ok({
    provider: 'baidu-hardware-locapi',
    ...location,
    signalCount: {
      wifi: payload.body.macs.split('|').length,
      ble: 0
    }
  });
}

function amapMainSignalStrength(entry = {}, fallback = -65) {
  const signalStrength = Number(entry.signalStrength);
  if (Number.isFinite(signalStrength) && signalStrength > 0) {
    return Math.round(Math.min(100, signalStrength));
  }
  const rssi = Number(entry.RSSI || entry.rssi);
  if (Number.isFinite(rssi) && rssi !== 0) return Math.round(rssi);
  return fallback;
}

function amapNearbySignalStrength(entry = {}) {
  const rssi = Number(entry.RSSI || entry.rssi);
  if (Number.isFinite(rssi) && rssi !== 0) return Math.round(rssi);
  return normalizeSignalRssi(entry.signalStrength);
}

function buildAmapHardwarePayload(event = {}) {
  const entries = wifiEntriesFromEvent(event)
    .map((entry, index) => ({
      mac: formatMacWithColons(entry.BSSID || entry.bssid || entry.mac),
      rssi: index === 0 ? amapMainSignalStrength(entry) : amapNearbySignalStrength(entry),
      ssid: String(entry.SSID || entry.ssid || '').replace(/[|,]/g, '').slice(0, 32)
    }))
    .filter((entry) => entry.mac)
    .slice(0, 20);
  if (!entries.length) return null;
  const main = entries[0];
  const payload = {
    key: AMAP_CONFIG.key,
    accesstype: '2',
    output: 'json',
    cdma: '0',
    network: 'GSM',
    platform: 'rest',
    diu: event.deviceId || AMAP_CONFIG.deviceId,
    mmac: `${main.mac},${main.rssi},${main.ssid},0`
  };
  if (entries.length > 1) {
    payload.macs = entries
      .slice(1)
      .map((entry) => `${entry.mac},${entry.rssi},${entry.ssid},0`)
      .join('|');
  }
  return payload;
}

function parseAmapLocation(data = {}) {
  const result = data.result || data.position || data.data || {};
  const locationText = result.location || result.loc || data.location || '';
  const parts = String(locationText).split(',');
  const longitude = Number(result.longitude || result.lng || parts[0]);
  const latitude = Number(result.latitude || result.lat || parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    accuracy: Number(result.radius || result.accuracy || result.precision) || 0,
    confidence: result.radius ? Math.max(0, Math.min(1, 1 - Number(result.radius) / 300)) : 0,
    address: result.desc || result.address || result.formatted_address || '',
    adInfo: {
      city: result.city || '',
      adcode: result.adcode || ''
    },
    requestId: data.traceid || data.trace_id || data.request_id || '',
    rawInfo: data.info || ''
  };
}

async function callAmapHardwareLocation(event = {}) {
  if (!AMAP_CONFIG.key) {
    return fail('高德智能硬件定位未配置 AMAP_KEY', 'AMAP_NOT_CONFIGURED');
  }
  const payload = buildAmapHardwarePayload(event);
  if (!payload) {
    return fail('未采集到可用于高德定位的 Wi-Fi 信号', 'AMAP_SIGNAL_EMPTY');
  }
  const endpoint = new URL(AMAP_CONFIG.hardwareUrl);
  Object.keys(payload).forEach((key) => endpoint.searchParams.set(key, payload[key]));
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    timeout: 8000
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || String(data.status) !== '1') {
    const message = data.info || data.message || `高德智能硬件定位失败 HTTP ${response.status}`;
    return fail(message, 'AMAP_NETWORK_FAILED');
  }
  const location = parseAmapLocation(data);
  if (!location) {
    return fail(data.info || '高德未返回可用坐标', 'AMAP_LOCATION_EMPTY');
  }
  return ok({
    provider: 'amap-hardware-iot',
    ...location,
    signalCount: {
      wifi: (payload.macs ? payload.macs.split('|').length : 0) + 1,
      ble: 0
    }
  });
}

async function callTencentIndoorNetwork(event = {}) {
  if (!TENCENT_MAP_CONFIG.key) {
    return fail('腾讯地图网络定位未配置 TENCENT_MAP_KEY', 'INDOOR_NOT_CONFIGURED');
  }
  const payload = buildIndoorNetworkPayload(event);
  if (!payload.wifiinfo && !payload.beaconinfo) {
    return fail('未采集到可用于腾讯地图网络定位的 Wi-Fi/BLE 信号', 'INDOOR_SIGNAL_EMPTY');
  }
  const endpoint = new URL(TENCENT_MAP_CONFIG.networkUrl);
  if (TENCENT_MAP_CONFIG.sk) {
    const queryParams = {};
    endpoint.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });
    endpoint.searchParams.set('sig', buildTencentMapSig(endpoint.pathname, payload, queryParams));
  }
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 8000
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status !== 0) {
    const message = data.message || `腾讯地图网络定位失败 HTTP ${response.status}`;
    const hint = /签名|sig|sn/i.test(message)
      ? '。请确认 TENCENT_MAP_SK 填的是纯 SK 值，不要带 sk: 前缀，并确认它属于当前 TENCENT_MAP_KEY'
      : '';
    return fail(`${message}${hint}`, 'INDOOR_NETWORK_FAILED');
  }
  const result = data.result || {};
  const location = result.location || {};
  return ok({
    provider: 'tencent-map-network',
    latitude: Number(location.latitude) || null,
    longitude: Number(location.longitude) || null,
    accuracy: Number(location.accuracy) || 0,
    confidence: location.accuracy ? Math.max(0, Math.min(1, 1 - Number(location.accuracy) / 300)) : 0,
    address: result.address || '',
    adInfo: result.ad_info || {},
    requestId: data.request_id || '',
    signalCount: {
      wifi: (payload.wifiinfo || []).length,
      ble: (payload.beaconinfo || []).length
    }
  });
}

async function resolveIndoorSignals(event = {}) {
  const errors = [];
  if (BAIDU_LOC_CONFIG.key) {
    const baiduResult = await callBaiduHardwareLocation(event);
    if (baiduResult.ok) return baiduResult;
    errors.push(`百度：${baiduResult.message}`);
  }
  if (AMAP_CONFIG.key) {
    const amapResult = await callAmapHardwareLocation(event);
    if (amapResult.ok) return amapResult;
    errors.push(`高德：${amapResult.message}`);
  }
  if (TENCENT_MAP_CONFIG.key) {
    const tencentResult = await callTencentIndoorNetwork(event);
    if (tencentResult.ok) return tencentResult;
    errors.push(`腾讯：${tencentResult.message}`);
  }
  if (!BAIDU_LOC_CONFIG.key && !AMAP_CONFIG.key && !TENCENT_MAP_CONFIG.key) {
    return fail('请先配置 BAIDU_LOC_KEY、AMAP_KEY 或 TENCENT_MAP_KEY', 'INDOOR_NOT_CONFIGURED');
  }
  return fail(errors.join('；') || '未能解析当前位置', 'INDOOR_NETWORK_FAILED');
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
    imageUrls: payload.imageUrls || [],
    thumbUrl: (payload.imageUrls || [])[0] || '',
    visualDescription: payload.visualDescription || '',
    yoloObjects: payload.yoloObjects || [],
    semanticTags: payload.semanticTags || [],
    imageEmbedding: payload.imageEmbedding || [],
    semanticEmbedding: payload.semanticEmbedding || [],
    locationId: location ? location._id : '',
    locationName: location ? location.name : (payload.locationName || ''),
    locationArea: location ? location.area : (payload.locationArea || (hasCustomLocation ? '自定义位置' : '')),
    locationNearby: location ? location.nearby || [] : [],
    locationGuide: location ? location.detail || '' : '',
    locationDetail: payload.locationDetail || '',
    mapX: location ? location.mapX : optionalNumber(payload.mapX),
    mapY: location ? location.mapY : optionalNumber(payload.mapY),
    latitude: location ? location.latitude : customLatitude,
    longitude: location ? location.longitude : customLongitude,
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
      case 'resolveIndoorSignals':
        return resolveIndoorSignals(event);
      case 'listItems':
        return listItems(event);
      case 'getItemDetail':
        return getItemDetail(event);
      case 'listLocations':
        return listLocations(event);
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
