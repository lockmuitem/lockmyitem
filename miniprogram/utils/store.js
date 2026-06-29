const { LOCATIONS, searchLocations } = require('./locations');
const { classifyByText } = require('./classifier');
const { BAD_WORDS } = require('./constants');

const KEY = 'lost_found_state_v1';

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function createSeedState() {
  const items = [
    {
      _id: 'item_card_1',
      type: 'found',
      title: '蓝色校园卡',
      description: '在图书馆二楼自习区靠窗座位旁捡到。',
      category: '校园卡',
      aiTags: ['卡片', '校园卡'],
      imageUrls: [],
      thumbUrl: '',
      locationId: 'lib',
      locationName: '图书馆',
      locationDetail: '',
      mapX: 54,
      mapY: 39,
      status: 'active',
      ownerOpenid: 'demo_owner',
      ownerName: '热心同学',
      createdAt: '2026-06-28T11:20:00.000Z',
      updatedAt: '2026-06-28T11:20:00.000Z'
    },
    {
      _id: 'item_umbrella_1',
      type: 'lost',
      title: '黑色折叠伞',
      description: '可能落在学生食堂一楼。',
      category: '雨伞',
      aiTags: ['雨伞'],
      imageUrls: [],
      thumbUrl: '',
      locationId: 'dining',
      locationName: '学生食堂',
      locationDetail: '',
      mapX: 43,
      mapY: 58,
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
      locationId: 'gym',
      locationName: '体育馆',
      locationDetail: '',
      mapX: 72,
      mapY: 47,
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
      avatarUrl: ''
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
        content: '欢迎来到上科大失物招领，先从地图或分类开始找找看。',
        read: false,
        createdAt: nowIso()
      }
    ],
    reports: [],
    campus_locations: LOCATIONS
  };
}

function getState() {
  return wx.getStorageSync(KEY) || createSeedState();
}

function setState(nextState) {
  wx.setStorageSync(KEY, nextState);
  return nextState;
}

function ensureSeedData() {
  if (!wx.getStorageSync(KEY)) {
    setState(createSeedState());
  }
}

function login() {
  const state = getState();
  if (!state.currentUser) {
    state.currentUser = createSeedState().currentUser;
    setState(state);
  }
  return state.currentUser;
}

function listItems(filters = {}) {
  const state = getState();
  const status = filters.status || 'active';
  const category = filters.category || '全部';
  return state.items
    .filter((item) => item.status === status)
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
  const location = LOCATIONS.find((entry) => entry._id === payload.locationId);
  const classification = payload.category ? { category: payload.category, aiTags: payload.aiTags || [] } : classifyByText(`${payload.title} ${payload.description}`);
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
    locationId: location ? location._id : '',
    locationName: location ? location.name : '',
    locationDetail: '',
    mapX: location ? location.mapX : null,
    mapY: location ? location.mapY : null,
    status: 'active',
    ownerOpenid: user.openid,
    ownerName: user.nickName,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.items.unshift(item);
  setState(state);
  return item;
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
  searchLocations,
  classifyByText
};
