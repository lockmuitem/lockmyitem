import { categoryImages, locations, seedItems } from './data.js';
import { classifyByText, getLocation } from './utils.js';

const STORAGE_KEY = 'shanghaitech_lostfound_web_v1';
const AUTH_KEY = 'shanghaitech_lostfound_web_user_v1';
const CLIENT_ID_KEY = 'lockmyitem_web_client_id';

const TCB_ENV_ID = import.meta.env.VITE_CLOUDBASE_ENV_ID || import.meta.env.VITE_TCB_ENV_ID || 'cloud1-d9gnyuxf5b44b6b92';
const TCB_ACCESS_KEY = import.meta.env.VITE_CLOUDBASE_ACCESS_KEY || import.meta.env.VITE_TCB_ACCESS_KEY || '';
const TCB_REGION = import.meta.env.VITE_CLOUDBASE_REGION || import.meta.env.VITE_TCB_REGION || 'ap-shanghai';
const TCB_FUNCTION_NAME = import.meta.env.VITE_CLOUDBASE_FUNCTION_NAME || import.meta.env.VITE_TCB_FUNCTION_NAME || 'lostfound';
const TCB_DATA_ENABLED = import.meta.env.VITE_DISABLE_TCB_DATA !== 'true' && Boolean(TCB_ENV_ID);

let cloudbaseAppPromise = null;

function localStorageSafe() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function unique(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeDate(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  if (value.$date) return normalizeDate(value.$date, fallback);
  if (typeof value.toISOString === 'function') return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
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

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => globalThis.clearTimeout(timer));
}

function readableError(error, fallback = '云端调用失败') {
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
    // Use the fallback below.
  }
  const text = String(error || '');
  return text && text !== '[object Object]' ? text : fallback;
}

export function getClientId() {
  const storage = localStorageSafe();
  if (!storage) return '';
  try {
    const existing = storage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const value = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    storage.setItem(CLIENT_ID_KEY, value);
    return value;
  } catch {
    return '';
  }
}

function getAuthToken() {
  const user = loadUser();
  return user?.authToken || '';
}

async function ensureCloudbaseAuth(app) {
  const auth = typeof app.auth === 'function' ? app.auth({ persistence: 'local' }) : app.auth;
  if (!auth) return;

  const state = await (auth.hasLoginState?.() || auth.getLoginState?.()).catch(() => null);
  if (state) return;

  if (typeof auth.signInAnonymously === 'function') {
    await auth.signInAnonymously();
    return;
  }

  const provider = typeof auth.anonymousAuthProvider === 'function'
    ? auth.anonymousAuthProvider()
    : auth.anonymousAuthProvider;
  if (provider?.signIn) await provider.signIn();
}

async function getCloudbaseApp() {
  if (!TCB_DATA_ENABLED) throw new Error('CloudBase 数据同步未启用');
  if (!cloudbaseAppPromise) {
    cloudbaseAppPromise = Promise.resolve().then(async () => {
      const { default: cloudbase } = await import('@cloudbase/js-sdk');
      try {
        const app = cloudbase.init({ env: TCB_ENV_ID, region: TCB_REGION });
        await ensureCloudbaseAuth(app);
        return app;
      } catch (error) {
        if (!TCB_ACCESS_KEY) throw error;
        console.warn('CloudBase anonymous auth unavailable; continuing with publishable key fallback.', error);
      }
      return cloudbase.init({ env: TCB_ENV_ID, region: TCB_REGION, accessKey: TCB_ACCESS_KEY });
    });
  }
  return cloudbaseAppPromise;
}

async function callLostfound(action, data = {}, timeoutMs = 15000) {
  const app = await getCloudbaseApp();
  const response = await withTimeout(
    app.callFunction({
      name: TCB_FUNCTION_NAME,
      parse: true,
      data: {
        ...data,
        action,
        clientId: getClientId(),
        authToken: data.authToken || getAuthToken()
      }
    }),
    timeoutMs,
    `调用 ${action} 超时`
  );
  const body = unwrapCloudFunctionResponse(response);
  if (body.ok === false) {
    throw new Error(body.message || body.error || body.code || `${action} 返回失败`);
  }
  return body.ok ? body.data : body;
}

function normalizeItem(raw = {}) {
  const category = raw.category || '其他';
  const imageUrls = unique(raw.imageUrls || (raw.image ? [raw.image] : []));
  const tags = unique([
    category,
    ...(raw.tags || []),
    ...(raw.aiTags || []),
    ...(raw.semanticTags || []),
    ...(raw.yoloObjects || [])
  ]);

  return {
    ...raw,
    id: raw.id || raw._id || `item_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    _id: raw._id || raw.id,
    type: raw.type === 'lost' ? 'lost' : 'found',
    title: raw.title || category || '未命名物品',
    description: raw.description || '',
    category,
    tags,
    image: raw.image || raw.thumbUrl || imageUrls[0] || categoryImages[category] || categoryImages.其他,
    imageUrls,
    imageFileIds: raw.imageFileIds || [],
    visualDescription: raw.visualDescription || '',
    rawPredictions: raw.rawPredictions || [],
    locationId: raw.locationId || '',
    locationDetail: raw.locationDetail || raw.locationGuide || '',
    locationImages: raw.locationImages || [],
    ownerName: raw.ownerName || '网页用户',
    status: raw.status === 'returned' ? 'returned' : 'active',
    createdAt: normalizeDate(raw.createdAt),
    updatedAt: normalizeDate(raw.updatedAt || raw.createdAt),
    returnedAt: raw.returnedAt ? normalizeDate(raw.returnedAt, '') : raw.returnedAt,
    claimedAt: raw.claimedAt ? normalizeDate(raw.claimedAt, '') : raw.claimedAt,
    claimedByOpenid: raw.claimedByOpenid || raw.claimedBy || '',
    claimantName: raw.claimantName || raw.claimedByName || '',
    claimantContact: raw.claimantContact || raw.claimedByContact || '',
    claims: raw.claims || []
  };
}

function normalizeComment(raw = {}) {
  return {
    ...raw,
    id: raw.id || raw._id || `comment_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    itemId: raw.itemId,
    authorName: raw.authorName || '网页用户',
    content: raw.content || '',
    status: raw.status || 'active',
    createdAt: normalizeDate(raw.createdAt)
  };
}

function compactItem(item) {
  return {
    ...item,
    image: typeof item.image === 'string' && item.image.startsWith('data:') ? '' : item.image,
    imageUrls: (item.imageUrls || []).filter((image) => !String(image).startsWith('data:')),
    imageFileIds: item.imageFileIds || [],
    locationImages: []
  };
}

export function loadItems() {
  const storage = localStorageSafe();
  if (!storage) return seedItems.map(normalizeItem);
  const saved = storage.getItem(STORAGE_KEY);
  if (!saved) return seedItems.map(normalizeItem);
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : seedItems.map(normalizeItem);
  } catch {
    return seedItems.map(normalizeItem);
  }
}

export function saveItems(items) {
  const storage = localStorageSafe();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ items, cachedAt: new Date().toISOString() }));
  } catch (error) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        items: items.map(compactItem),
        cachedAt: new Date().toISOString()
      }));
    } catch (fallbackError) {
      console.warn('Failed to persist lost-and-found items.', fallbackError || error);
    }
  }
}

export async function loadCloudItems() {
  const localOnlyItems = loadItems().filter((item) => item.localOnly);
  const [activeItems, returnedItems] = await Promise.all([
    listCloudItemsByStatus('active'),
    listCloudItemsByStatus('returned')
  ]);
  const seen = new Set();
  const items = [...localOnlyItems, ...activeItems, ...returnedItems]
    .map(normalizeItem)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  saveItems(items);
  return items;
}

async function listCloudItemsByStatus(status) {
  const items = [];
  const limit = 100;
  let cursor = 0;
  for (let page = 0; page < 5; page += 1) {
    const data = await callLostfound('listItems', { filters: { status, limit, cursor } });
    const batch = Array.isArray(data.items) ? data.items : [];
    items.push(...batch);
    if (batch.length < limit) break;
    cursor = data.nextCursor || items.length;
  }
  return items;
}

function locationPayload(locationId) {
  if (!locationId) return {};
  const location = getLocation(locationId);
  if (!location || !locations.some((entry) => entry.id === location.id)) return {};
  return {
    locationId: location.id,
    locationName: location.name,
    locationArea: location.area,
    locationDetail: location.mapDescription || location.guide || '',
    mapX: location.mapX,
    mapY: location.mapY,
    latitude: location.latitude,
    longitude: location.longitude
  };
}

function buildItemPayload(payload, currentUser) {
  const classification = payload.category
    ? { category: payload.category, tags: payload.tags || [] }
    : classifyByText(`${payload.title || ''} ${payload.description || ''}`);
  const category = classification.category || '其他';
  const title = (payload.title || '').trim() || (payload.type === 'lost' ? '未命名寻物' : '未命名招领');
  const description = (payload.description || '').trim() || '暂无补充描述';
  const imageUrls = unique([
    payload.image && !String(payload.image).startsWith('/assets/') ? payload.image : '',
    ...(payload.imageFileIds || []),
    ...(payload.imageUrls || [])
  ]);
  const location = locationPayload(payload.locationId);

  return {
    type: payload.type || 'found',
    title,
    description,
    category,
    aiTags: unique([category, ...(payload.tags || classification.tags || [])]),
    imageUrls,
    visualDescription: payload.visualDescription || '',
    yoloObjects: payload.yoloObjects || [],
    semanticTags: payload.semanticTags || payload.tags || [],
    imageEmbedding: payload.imageEmbedding || [],
    semanticEmbedding: payload.semanticEmbedding || [],
    ...location,
    locationDetail: payload.locationDetail || location.locationDetail || '',
    ownerName: currentUser?.nickName || payload.ownerName || '网页用户',
    ownerClientId: getClientId()
  };
}

export function loadUser() {
  const storage = localStorageSafe();
  if (!storage) return null;
  const saved = storage.getItem(AUTH_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    const user = parsed && parsed.user ? parsed.user : null;
    const email = user?.email || user?.contact || '';
    if (!user?.authToken || !String(email).toLowerCase().endsWith('@shanghaitech.edu.cn')) return null;
    return user;
  } catch {
    return null;
  }
}

export function saveUser(user) {
  const storage = localStorageSafe();
  if (!storage) return;
  storage.setItem(AUTH_KEY, JSON.stringify({ user: normalizeAuthUser(user) }));
}

export function clearUser() {
  const storage = localStorageSafe();
  if (storage) storage.removeItem(AUTH_KEY);
}

function normalizeAuthUser(user = {}) {
  const email = user.email || user.contact || '';
  return {
    ...user,
    id: user.id || user._id || user.actorId || `user_${Date.now()}`,
    nickName: user.nickName || (email ? email.split('@')[0] : '网页用户'),
    contact: email,
    email,
    authToken: user.authToken || ''
  };
}

export async function sendEmailCode(email, purpose = 'login') {
  return callLostfound('sendEmailCode', { email, purpose }, 15000);
}

export async function registerWithEmail({ email, password, code, nickName }) {
  const data = await callLostfound('registerWithEmail', { email, password, code, nickName }, 15000);
  return normalizeAuthUser(data);
}

export async function loginWithEmailPassword({ email, password }) {
  const data = await callLostfound('loginWithEmailPassword', { email, password }, 15000);
  return normalizeAuthUser(data);
}

export async function loginWithEmailCode({ email, code }) {
  const data = await callLostfound('loginWithEmailCode', { email, code }, 15000);
  return normalizeAuthUser(data);
}

export function createItem(payload) {
  const data = buildItemPayload(payload, { nickName: payload.ownerName });
  return normalizeItem({
    ...data,
    id: `item_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    image: payload.image || categoryImages[data.category] || categoryImages.其他,
    imageFileIds: data.imageFileIds || [],
    localOnly: true,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

export async function createCloudItem(payload, currentUser) {
  const data = await callLostfound('createItem', {
    payload: buildItemPayload(payload, currentUser)
  }, 20000);
  return normalizeItem(data);
}

export async function loadCloudItemDetail(itemId) {
  const data = await callLostfound('getItemDetail', { itemId }, 15000);
  return {
    item: data.item ? normalizeItem(data.item) : null,
    comments: Array.isArray(data.comments) ? data.comments.map(normalizeComment) : []
  };
}

export async function createCloudComment(itemId, content, currentUser) {
  const data = await callLostfound('createComment', {
    itemId,
    content,
    authorName: currentUser?.nickName || '网页用户'
  }, 15000);
  return normalizeComment(data);
}

export async function claimCloudItem(itemId, currentUser) {
  const data = await callLostfound('claimItem', {
    itemId,
    claimantName: currentUser?.nickName || '网页用户',
    claimantContact: currentUser?.contact || ''
  }, 15000);
  return {
    item: data.item ? normalizeItem(data.item) : null,
    comment: data.comment ? normalizeComment(data.comment) : null
  };
}

export async function setCloudReturnStatus(itemId, returned) {
  const data = await callLostfound(returned ? 'markReturned' : 'undoReturned', { itemId }, 15000);
  return {
    itemId: data.itemId || itemId,
    status: data.status || (returned ? 'returned' : 'active')
  };
}

export function cloudErrorMessage(error) {
  return readableError(error);
}
