const { LOCATIONS, searchLocations } = require('./locations');
const { classifyByText } = require('./classifier');
const { extractItemFeatures, scoreFeatureMatch } = require('./matcher');
const { BAD_WORDS } = require('./constants');

const KEY_V1 = 'lost_found_state_v1';
const KEY = 'lost_found_state_v2';

const LOCATION_ID_ALIASES = {
  lib: 'library',
  dining: 'silk-road-dining',
  'dining-1': 'silk-road-dining',
  'dining-2': 'shangke-food-court-1f',
  'dining-3': 'magnolia-dining',
  gym: 'athletic-center',
  gate: 'south-gate'
};

const DEMO_THUMBS = {
  item_umbrella_found_1: '/assets/items/umbrella.jpg',
  item_card_1: '/assets/items/card.jpg',
  item_earbuds_found_1: '/assets/items/earbuds.jpg',
  item_keys_found_1: '/assets/items/keys.jpg',
  item_notebook_found_1: '/assets/items/notebook.jpg',
  item_umbrella_1: '/assets/items/umbrella.jpg',
  item_bottle_1: '/assets/items/notebook.jpg'
};

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function createSeedState() {
  const items = [
    {
      _id: 'item_umbrella_found_1',
      type: 'found',
      title: '黑色折叠伞，带红色钥匙扣',
      description: '在丝路餐厅门口捡到，一把黑色雨伞，伞柄上有红色钥匙扣。',
      category: '雨伞',
      aiTags: ['雨伞', '黑色', '红色钥匙扣'],
      imageUrls: [],
      thumbUrl: '',
      locationId: 'silk-road-dining',
      locationName: '丝路餐厅（一号食堂）',
      locationDetail: '',
      mapX: 73,
      mapY: 49,
      latitude: 31.17955,
      longitude: 121.59265,
      status: 'active',
      ownerOpenid: 'demo_owner_umbrella',
      ownerName: '食堂门口同学',
      createdAt: '2026-06-28T13:10:00.000Z',
      updatedAt: '2026-06-28T13:10:00.000Z'
    },
    {
      _id: 'item_card_1',
      type: 'found',
      title: '蓝色校园卡',
      description: '在图书馆二楼自习区靠窗座位旁捡到。',
      category: '校园卡',
      aiTags: ['卡片', '校园卡'],
      imageUrls: [],
      thumbUrl: '',
      locationId: 'library',
      locationName: '图书馆',
      locationDetail: '',
      mapX: 54,
      mapY: 39,
      latitude: 31.1802,
      longitude: 121.5898,
      status: 'active',
      ownerOpenid: 'demo_owner',
      ownerName: '热心同学',
      createdAt: '2026-06-28T11:20:00.000Z',
      updatedAt: '2026-06-28T11:20:00.000Z'
    },
    {
      _id: 'item_earbuds_found_1',
      type: 'found',
      title: '白色无线耳机（右耳缺失）',
      description: '在学生服务中心门口座椅上捡到，充电盒完好，右耳缺失。',
      category: '电子产品',
      aiTags: ['耳机', '白色', '充电盒'],
      imageUrls: [],
      thumbUrl: '/assets/items/earbuds.jpg',
      locationId: 'campus-service',
      locationName: '校园服务中心',
      locationDetail: '',
      status: 'active',
      ownerOpenid: 'demo_owner_earbuds',
      ownerName: '服务中心同学',
      createdAt: '2026-06-28T09:10:00.000Z',
      updatedAt: '2026-06-28T09:10:00.000Z'
    },
    {
      _id: 'item_keys_found_1',
      type: 'found',
      title: '钥匙串（蓝色圆形挂饰）',
      description: '在物质学院楼下自行车停放处捡到。',
      category: '钥匙',
      aiTags: ['钥匙', '蓝色挂饰'],
      imageUrls: [],
      thumbUrl: '/assets/items/keys.jpg',
      locationId: 'spst',
      locationName: '物质科学与技术学院',
      locationDetail: '',
      status: 'active',
      ownerOpenid: 'demo_owner_keys',
      ownerName: '物质学院同学',
      createdAt: '2026-06-27T20:15:00.000Z',
      updatedAt: '2026-06-27T20:15:00.000Z'
    },
    {
      _id: 'item_notebook_found_1',
      type: 'found',
      title: '黑色笔记本',
      description: '封面无字，内有手写笔记。',
      category: '书本资料',
      aiTags: ['笔记本', '黑色'],
      imageUrls: [],
      thumbUrl: '/assets/items/notebook.jpg',
      locationId: 'ihuman',
      locationName: 'iHuman研究所',
      locationDetail: '',
      status: 'active',
      ownerOpenid: 'demo_owner_notebook',
      ownerName: '研究所同学',
      createdAt: '2026-06-27T18:42:00.000Z',
      updatedAt: '2026-06-27T18:42:00.000Z'
    },
    {
      _id: 'item_umbrella_1',
      type: 'lost',
      title: '黑色折叠伞',
      description: '可能落在学生食堂一楼，伞柄上有银色贴纸。',
      category: '雨伞',
      aiTags: ['雨伞'],
      imageUrls: [],
      thumbUrl: '',
      locationId: 'silk-road-dining',
      locationName: '丝路餐厅',
      locationDetail: '',
      mapX: 43,
      mapY: 58,
      latitude: 31.1788,
      longitude: 121.5897,
      status: 'active',
      ownerOpenid: 'demo_user_2',
      ownerName: '赶课人',
      createdAt: '2026-06-27T08:30:00.000Z',
      updatedAt: '2026-06-27T08:30:00.000Z'
    },
    {
      _id: 'item_bottle_1',
      type: 'found',
      title: '白色保温杯',
      description: '体育馆看台第三排发现，杯身有贴纸。',
      category: '水杯',
      aiTags: ['水杯', '保温杯'],
      imageUrls: [],
      thumbUrl: '',
      locationId: 'athletic-center',
      locationName: '体育馆',
      locationDetail: '',
      mapX: 72,
      mapY: 47,
      latitude: 31.1792,
      longitude: 121.5926,
      status: 'returned',
      ownerOpenid: 'demo_user_3',
      ownerName: '体育馆值日生',
      createdAt: '2026-06-26T19:15:00.000Z',
      updatedAt: '2026-06-27T12:00:00.000Z',
      returnedAt: '2026-06-27T12:00:00.000Z'
    }
  ];

  return {
    currentUser: {
      openid: 'local_demo_openid',
      nickName: '微信用户',
      avatarUrl: '',
      email: '',
      emailPrefix: '',
      registered: false,
      loginMethod: ''
    },
    items,
    comments: [
      {
        _id: 'comment_1',
        itemId: 'item_card_1',
        authorOpenid: 'local_demo_openid',
        authorName: '微信用户',
        content: '请问卡面姓名首字母是 L 吗？',
        status: 'active',
        createdAt: '2026-06-28T12:00:00.000Z'
      }
    ],
    thanks: [],
    notifications: [
      {
        _id: 'notice_1',
        userOpenid: 'local_demo_openid',
        type: 'system',
        content: '欢迎来到上科大失物招领，先从失物招领或寻物板块开始看看。',
        read: false,
        createdAt: nowIso()
      }
    ],
    reports: [],
    campus_locations: LOCATIONS
  };
}

function getState() {
  const state = loadState();
  let changed = false;
  const seed = createSeedState();
  const existingIds = new Set((state.items || []).map((item) => item._id));
  seed.items.forEach((item) => {
    if (!existingIds.has(item._id)) {
      state.items.push(item);
      changed = true;
    }
  });
  state.items = (state.items || []).map((item) => {
      const location = findLocation(item.locationId);
    const matchFeatures = item.matchFeatures || extractItemFeatures(item);
    const defaultThumb = DEMO_THUMBS[item._id] || '';
    if (!location) {
      if (!item.thumbUrl && defaultThumb) {
        changed = true;
        return { ...item, thumbUrl: defaultThumb, imageUrls: item.imageUrls && item.imageUrls.length ? item.imageUrls : [defaultThumb] };
      }
      return item;
    }
    if (
      item.latitude
      && item.longitude
      && item.locationId === location._id
      && item.locationArea
      && item.locationGuide
      && item.locationNearby
      && item.matchFeatures
      && (item.thumbUrl || !defaultThumb)
      && Math.abs(item.latitude - location.latitude) < 0.00001
      && Math.abs(item.longitude - location.longitude) < 0.00001
    ) return item;
    changed = true;
    return {
      ...item,
      locationId: location._id,
    locationName: item.locationName || location.name,
      locationArea: item.locationArea || location.area,
      locationNearby: item.locationNearby || location.nearby || [],
      locationGuide: item.locationGuide || location.detail || '',
      matchFeatures,
      thumbUrl: item.thumbUrl || defaultThumb,
      imageUrls: item.imageUrls && item.imageUrls.length ? item.imageUrls : (defaultThumb ? [defaultThumb] : []),
      latitude: location.latitude,
      longitude: location.longitude,
      mapX: item.mapX || location.mapX,
      mapY: item.mapY || location.mapY
    };
  });
  if (changed) setState(state);
  return state;
}

function loadState() {
  const current = wx.getStorageSync(KEY);
  if (current) return current;

  const previous = wx.getStorageSync(KEY_V1);
  if (previous) {
    const migrated = migrateState(previous);
    setState(migrated);
    return migrated;
  }

  return createSeedState();
}

function migrateState(previous) {
  const seed = createSeedState();
  const previousUser = previous.currentUser || {};
  const emailPrefix = previousUser.emailPrefix || extractEmailPrefix(previousUser.email || '');
  const email = previousUser.email || (emailPrefix ? `${emailPrefix}@shanghaitech.edu.cn` : '');
  const registered = Boolean(previousUser.registered || email || emailPrefix);
  return {
    ...seed,
    ...previous,
    currentUser: {
      ...seed.currentUser,
      ...previousUser,
      email,
      emailPrefix,
      registered,
      loginMethod: previousUser.loginMethod || (registered ? 'email' : '')
    },
    items: previous.items || [],
    comments: previous.comments || [],
    thanks: previous.thanks || [],
    notifications: previous.notifications || [],
    reports: previous.reports || [],
    campus_locations: LOCATIONS,
    migratedFrom: KEY_V1,
    migratedAt: nowIso()
  };
}

function findLocation(locationId) {
  const nextId = LOCATION_ID_ALIASES[locationId] || locationId;
  return LOCATIONS.find((entry) => entry._id === nextId);
}

function setState(nextState) {
  wx.setStorageSync(KEY, nextState);
  return nextState;
}

function extractEmailPrefix(email = '') {
  return String(email).replace(/@shanghaitech\.edu\.cn$/i, '').trim();
}

function ensureSeedData() {
  getState();
}

function login() {
  const state = getState();
  if (!state.currentUser) {
    state.currentUser = createSeedState().currentUser;
    setState(state);
  }
  return state.currentUser;
}

function isRegistered() {
  const state = getState();
  return Boolean(state.currentUser && state.currentUser.registered);
}

function normalizeSchoolEmailPrefix(prefix = '') {
  return String(prefix)
    .trim()
    .replace(/@.*/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function registerUser(profile = {}) {
  const state = getState();
  const user = login();
  const emailPrefix = normalizeSchoolEmailPrefix(profile.emailPrefix || profile.email || '');
  if (!emailPrefix && profile.loginMethod !== 'wechat') {
    throw new Error('请输入上科大邮箱前缀');
  }
  const nickName = (profile.nickName || user.nickName || '微信用户').trim();
  state.currentUser = {
    ...user,
    openid: profile.openid || user.openid || 'local_demo_openid',
    nickName,
    avatarUrl: profile.avatarUrl || user.avatarUrl || '',
    emailPrefix,
    email: emailPrefix ? `${emailPrefix}@shanghaitech.edu.cn` : '',
    loginMethod: profile.loginMethod || 'email',
    registered: true,
    registeredAt: user.registeredAt || nowIso(),
    updatedAt: nowIso()
  };
  setState(state);
  return state.currentUser;
}

function updateUserProfile(profile = {}) {
  const state = getState();
  const user = login();
  const emailPrefix = normalizeSchoolEmailPrefix(profile.emailPrefix || profile.email || user.emailPrefix || '');
  const email = emailPrefix ? `${emailPrefix}@shanghaitech.edu.cn` : '';
  state.currentUser = {
    ...user,
    nickName: (profile.nickName || user.nickName || '微信用户').trim(),
    emailPrefix,
    email,
    registered: user.registered || Boolean(emailPrefix),
    updatedAt: nowIso()
  };
  setState(state);
  return state.currentUser;
}

function listItems(filters = {}) {
  const state = getState();
  const status = filters.status || 'active';
  const category = filters.category || '全部';
  return state.items
    .filter((item) => item.status === status)
    .filter((item) => !filters.type || item.type === filters.type)
    .filter((item) => category === '全部' || item.category === category)
    .filter((item) => !filters.locationId || item.locationId === filters.locationId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getItemDetail(itemId) {
  const state = getState();
  const item = state.items.find((entry) => entry._id === itemId);
  const comments = state.comments
    .filter((comment) => comment.itemId === itemId && comment.status === 'active')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return { item, comments };
}

function createItem(payload) {
  const state = getState();
  const user = login();
  const location = findLocation(payload.locationId);
  const classification = payload.category
    ? { category: payload.category, aiTags: payload.aiTags || [] }
    : classifyByText(`${payload.title} ${payload.description || ''}`);
  const title = (payload.title || '').trim() || classification.category || '未命名物品';
  const item = {
    _id: id('item'),
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
    locationArea: location ? location.area : '',
    locationNearby: location ? location.nearby || [] : [],
    locationGuide: location ? location.detail || '' : '',
    locationDetail: payload.locationDetail || '',
    mapX: location ? location.mapX : null,
    mapY: location ? location.mapY : null,
    latitude: location ? location.latitude : null,
    longitude: location ? location.longitude : null,
    status: 'active',
    ownerOpenid: user.openid,
    ownerName: user.nickName,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  item.matchFeatures = extractItemFeatures(item);
  state.items.unshift(item);
  setState(state);
  return item;
}

function scoreItemMatch(lostPayload, foundItem) {
  const featureScore = scoreFeatureMatch(lostPayload, foundItem);
  let score = featureScore.similarity;

  if (lostPayload.locationId && foundItem.locationId === (LOCATION_ID_ALIASES[lostPayload.locationId] || lostPayload.locationId)) {
    score += 6;
  } else if (lostPayload.locationId && foundItem.locationId) {
    const lostLocation = findLocation(lostPayload.locationId);
    const foundLocation = findLocation(foundItem.locationId);
    if (lostLocation && foundLocation) {
      const dLat = lostLocation.latitude - foundLocation.latitude;
      const dLng = lostLocation.longitude - foundLocation.longitude;
      if (Math.sqrt(dLat * dLat + dLng * dLng) < 0.0012) score += 5;
    }
  }

  return {
    similarity: Math.min(score, 98),
    reasons: featureScore.reasons
  };
}

function findPotentialMatches(payload, limit = 3) {
  if ((payload.type || 'found') !== 'lost') return [];
  const state = getState();
  return state.items
    .filter((item) => item.type === 'found' && item.status === 'active')
    .map((item) => {
      const result = scoreItemMatch(payload, item);
      return {
        ...item,
        similarity: result.similarity,
        matchReasons: result.reasons,
        matchReasonText: result.reasons.join('，')
      };
    })
    .filter((item) => item.similarity >= 58)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

function hasBadWords(content) {
  return BAD_WORDS.some((word) => content.includes(word));
}

function createNotification(userOpenid, type, content, itemId, actorOpenid) {
  const state = getState();
  const notification = {
    _id: id('notice'),
    userOpenid,
    type,
    itemId,
    actorOpenid,
    content,
    read: false,
    createdAt: nowIso()
  };
  state.notifications.unshift(notification);
  setState(state);
  return notification;
}

function createComment(itemId, content) {
  if (hasBadWords(content)) {
    throw new Error('评论包含敏感词，请修改后再发布');
  }
  const state = getState();
  const user = login();
  const item = state.items.find((entry) => entry._id === itemId);
  const comment = {
    _id: id('comment'),
    itemId,
    authorOpenid: user.openid,
    authorName: user.nickName,
    content,
    status: 'active',
    createdAt: nowIso()
  };
  state.comments.push(comment);
  setState(state);
  if (item && item.ownerOpenid !== user.openid) {
    createNotification(item.ownerOpenid, 'comment', `${user.nickName} 评论了你的帖子：${item.title}`, itemId, user.openid);
  }
  return comment;
}

function sendThanks(itemId) {
  const state = getState();
  const user = login();
  const item = state.items.find((entry) => entry._id === itemId);
  if (!item) throw new Error('帖子不存在');
  if (item.ownerOpenid === user.openid) throw new Error('不能感谢自己发布的帖子');
  const existed = state.thanks.find((entry) => entry.itemId === itemId && entry.fromOpenid === user.openid);
  if (existed) return existed;
  const thanks = {
    _id: id('thanks'),
    itemId,
    fromOpenid: user.openid,
    toOpenid: item.ownerOpenid,
    createdAt: nowIso()
  };
  state.thanks.push(thanks);
  setState(state);
  createNotification(item.ownerOpenid, 'thanks', `${user.nickName} 感谢了你发布的：${item.title}`, itemId, user.openid);
  return thanks;
}

function markReturned(itemId) {
  const state = getState();
  const user = login();
  const item = state.items.find((entry) => entry._id === itemId);
  if (!item) throw new Error('帖子不存在');
  if (item.ownerOpenid !== user.openid) throw new Error('只能操作自己的帖子');
  item.status = 'returned';
  item.returnedAt = nowIso();
  item.updatedAt = nowIso();
  setState(state);
  return item;
}

function undoReturned(itemId) {
  const state = getState();
  const user = login();
  const item = state.items.find((entry) => entry._id === itemId);
  if (!item) throw new Error('帖子不存在');
  if (item.ownerOpenid !== user.openid) throw new Error('只能操作自己的帖子');
  item.status = 'active';
  item.returnedAt = null;
  item.updatedAt = nowIso();
  setState(state);
  return item;
}

function reportContent(targetType, targetId, reason) {
  const state = getState();
  const user = login();
  const report = {
    _id: id('report'),
    targetType,
    targetId,
    reason,
    reporterOpenid: user.openid,
    createdAt: nowIso(),
    status: 'open'
  };
  state.reports.push(report);
  setState(state);
  return report;
}

function listNotifications() {
  const state = getState();
  const user = login();
  return state.notifications
    .filter((entry) => entry.userOpenid === user.openid)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function listMyItems() {
  const state = getState();
  const user = login();
  return state.items
    .filter((item) => item.ownerOpenid === user.openid)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
  ensureSeedData,
  login,
  isRegistered,
  registerUser,
  updateUserProfile,
  listItems,
  getItemDetail,
  createItem,
  createComment,
  sendThanks,
  markReturned,
  undoReturned,
  reportContent,
  listNotifications,
  listMyItems,
  findPotentialMatches,
  searchLocations,
  classifyByText
};
