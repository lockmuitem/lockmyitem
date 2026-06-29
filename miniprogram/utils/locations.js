const LOCATIONS = [
  { _id: 'lib', name: '图书馆', aliases: ['library'], area: '学习区', mapX: 54, mapY: 39, sortOrder: 1, enabled: true },
  { _id: 'sist', name: '信息学院楼', aliases: ['SIST', '信息学院'], area: '教学科研区', mapX: 63, mapY: 35, sortOrder: 2, enabled: true },
  { _id: 'spst', name: '物质学院楼', aliases: ['SPST', '物质学院'], area: '教学科研区', mapX: 48, mapY: 31, sortOrder: 3, enabled: true },
  { _id: 'slst', name: '生命学院楼', aliases: ['SLST', '生命学院'], area: '教学科研区', mapX: 37, mapY: 36, sortOrder: 4, enabled: true },
  { _id: 'dining', name: '学生食堂', aliases: ['食堂', '餐厅'], area: '生活区', mapX: 43, mapY: 58, sortOrder: 5, enabled: true },
  { _id: 'dorm-east', name: '东区宿舍', aliases: ['宿舍', '东宿'], area: '生活区', mapX: 67, mapY: 62, sortOrder: 6, enabled: true },
  { _id: 'dorm-west', name: '西区宿舍', aliases: ['西宿'], area: '生活区', mapX: 24, mapY: 61, sortOrder: 7, enabled: true },
  { _id: 'gym', name: '体育馆', aliases: ['运动场', '健身'], area: '运动区', mapX: 72, mapY: 47, sortOrder: 8, enabled: true },
  { _id: 'admin', name: '行政中心', aliases: ['行政楼'], area: '行政区', mapX: 30, mapY: 42, sortOrder: 9, enabled: true },
  { _id: 'gate', name: '校门口', aliases: ['门口', '入口'], area: '公共区', mapX: 14, mapY: 76, sortOrder: 10, enabled: true }
];

function searchLocations(keyword = '') {
  const normalized = keyword.trim().toLowerCase();
  return LOCATIONS
    .filter((location) => {
      if (!location.enabled) return false;
      if (!normalized) return true;
      const haystack = [location.name, location.area].concat(location.aliases).join(' ').toLowerCase();
      return haystack.includes(normalized);
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

module.exports = {
  LOCATIONS,
  searchLocations
};
