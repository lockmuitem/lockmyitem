function transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  ret += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return ret;
}

function transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  ret += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return ret;
}

function wgs84ToGcj02(latitude, longitude) {
  const a = 6378245;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(longitude - 105, latitude - 35);
  let dLng = transformLng(longitude - 105, latitude - 35);
  const radLat = latitude / 180 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return {
    latitude: latitude + dLat,
    longitude: longitude + dLng
  };
}

const CAMPUS_CENTER = wgs84ToGcj02(31.1792808, 121.5902899);

const CAMPUS_BOUNDS = {
  north: 31.1830156,
  south: 31.1755460,
  west: 121.5844916,
  east: 121.5960882
};

function point(latitude, longitude) {
  const gcj = wgs84ToGcj02(latitude, longitude);
  return {
    latitude: Number(gcj.latitude.toFixed(7)),
    longitude: Number(gcj.longitude.toFixed(7)),
    wgs84Latitude: latitude,
    wgs84Longitude: longitude,
    mapX: Math.round(((longitude - CAMPUS_BOUNDS.west) / (CAMPUS_BOUNDS.east - CAMPUS_BOUNDS.west)) * 100),
    mapY: Math.round(((CAMPUS_BOUNDS.north - latitude) / (CAMPUS_BOUNDS.north - CAMPUS_BOUNDS.south)) * 100)
  };
}

const CAMPUS_GCJ_BOUNDS = {
  north: wgs84ToGcj02(CAMPUS_BOUNDS.north, CAMPUS_BOUNDS.east).latitude,
  south: wgs84ToGcj02(CAMPUS_BOUNDS.south, CAMPUS_BOUNDS.west).latitude,
  west: wgs84ToGcj02(CAMPUS_BOUNDS.south, CAMPUS_BOUNDS.west).longitude,
  east: wgs84ToGcj02(CAMPUS_BOUNDS.north, CAMPUS_BOUNDS.east).longitude
};

function gcjPoint(latitude, longitude) {
  return {
    latitude: Number(latitude.toFixed(7)),
    longitude: Number(longitude.toFixed(7)),
    mapX: Math.round(((longitude - CAMPUS_GCJ_BOUNDS.west) / (CAMPUS_GCJ_BOUNDS.east - CAMPUS_GCJ_BOUNDS.west)) * 100),
    mapY: Math.round(((CAMPUS_GCJ_BOUNDS.north - latitude) / (CAMPUS_GCJ_BOUNDS.north - CAMPUS_GCJ_BOUNDS.south)) * 100)
  };
}

const LOCATIONS = [
  {
    _id: 'library',
    name: '图书馆',
    aliases: ['library', '图书馆', '主图', '阅览室', '自习区'],
    area: '学习区',
    detail: '主图书馆，靠近学生公寓与白玉兰餐厅',
    nearby: ['白玉兰一楼餐厅（三号食堂）', '学生公寓7-10号楼', '塔楼'],
    ...point(31.1773981, 121.5923408),
    sortOrder: 1,
    enabled: true
  },
  {
    _id: 'slst',
    name: '生命科学与技术学院',
    aliases: ['SLST', '生命学院', '生院', '生命楼'],
    area: '学院楼',
    detail: '生命科学与技术学院楼',
    nearby: ['物质科学与技术学院', '北门（海科路230号）'],
    ...point(31.1817988, 121.5901764),
    sortOrder: 2,
    enabled: true
  },
  {
    _id: 'sist',
    name: '信息科学与技术学院',
    aliases: ['SIST', '信息学院', '信院', '信息楼'],
    area: '学院楼',
    detail: '信息科学与技术学院楼',
    nearby: ['校园服务中心', '学生创新中心'],
    ...point(31.1803726, 121.5901525),
    sortOrder: 3,
    enabled: true
  },
  {
    _id: 'spst',
    name: '物质科学与技术学院',
    aliases: ['SPST', '物质学院', '物院', '物质楼'],
    area: '学院楼',
    detail: '物质科学与技术学院楼',
    nearby: ['生命科学与技术学院', '免疫化学研究所'],
    ...point(31.1795879, 121.5891026),
    sortOrder: 4,
    enabled: true
  },
  {
    _id: 'sbme',
    name: '生物医学工程学院',
    aliases: ['BME', '生医工', '生物医学工程', '生物医学工程学院'],
    area: '学院楼',
    detail: '生物医学工程学院楼',
    nearby: ['信息科学与技术学院', '创业与管理学院', '物质科学与技术学院'],
    ...point(31.1798000, 121.5903500),
    sortOrder: 4.5,
    enabled: true
  },
  {
    _id: 'sem',
    name: '创业与管理学院',
    aliases: ['SEM', '创管学院', '创业管理学院'],
    area: '学院楼',
    detail: '创业与管理学院楼',
    nearby: ['教学中心', '学生创新中心'],
    ...point(31.1787237, 121.5906064),
    sortOrder: 5,
    enabled: true
  },
  {
    _id: 'sca',
    name: '创意与艺术学院',
    aliases: ['SCA', '创艺学院', '艺术学院'],
    area: '学院楼',
    detail: '创意与艺术学院楼',
    nearby: ['行政中心', '物质科学与技术学院'],
    ...point(31.1787320, 121.5892745),
    sortOrder: 6,
    enabled: true
  },
  {
    _id: 'ihuman',
    name: 'iHuman研究所',
    aliases: ['iHuman', '人类表型组', 'ihuman institute'],
    area: '科研机构',
    ...point(31.1822434, 121.5904078),
    sortOrder: 7,
    enabled: true
  },
  {
    _id: 'sias',
    name: '免疫化学研究所',
    aliases: ['SIAS', '免疫化学', '免化所'],
    area: '科研机构',
    ...point(31.1822434, 121.5904078),
    sortOrder: 8,
    enabled: true
  },
  {
    _id: 'admin',
    name: '行政中心',
    aliases: ['行政楼', '行政中心'],
    area: '行政服务',
    ...point(31.1773933, 121.5891213),
    sortOrder: 9,
    enabled: true
  },
  {
    _id: 'teaching-center',
    name: '教学中心',
    aliases: ['教学楼', 'Teaching Center', '教室'],
    area: '教学区',
    ...point(31.1777189, 121.5909274),
    sortOrder: 10,
    enabled: true
  },
  {
    _id: 'auditorium',
    name: '报告厅',
    aliases: ['报告厅', 'Auditorium', '会堂'],
    area: '公共区',
    ...point(31.1782115, 121.5914937),
    sortOrder: 11,
    enabled: true
  },
  {
    _id: 'student-innovation',
    name: '学生创新中心',
    aliases: ['学生创新中心', '创新中心', 'Student Innovation Center'],
    area: '公共区',
    ...point(31.1788028, 121.5917070),
    sortOrder: 12,
    enabled: true
  },
  {
    _id: 'campus-service',
    name: '校园服务中心',
    aliases: ['校园服务中心', '服务中心', 'Campus Service Center'],
    area: '公共服务',
    ...point(31.1797866, 121.5921362),
    sortOrder: 13,
    enabled: true
  },
  {
    _id: 'student-center',
    name: '学生活动中心',
    aliases: ['学生活动中心', '学生中心', 'Student Center', '咖啡厅'],
    area: '生活区',
    ...point(31.1807090, 121.5937817),
    sortOrder: 14,
    enabled: true
  },
  {
    _id: 'silk-road-dining',
    name: '丝路餐厅（一号食堂）',
    aliases: ['一号食堂', '一食', '第一食堂', '食堂', '餐厅', 'Dining Hall 1', 'Silk Road'],
    area: '餐饮',
    detail: '一号食堂主要餐饮点',
    nearby: ['学生活动中心', '清真餐厅', '尚科美食广场1楼'],
    ...point(31.1804466, 121.5929943),
    sortOrder: 15,
    enabled: true
  },
  {
    _id: 'dining-1-2f',
    name: '一号食堂二楼餐厅',
    aliases: ['一号食堂二楼', '一食二楼', '第一食堂二楼', '食堂', '餐厅'],
    area: '餐饮',
    detail: '一号食堂二楼',
    nearby: ['丝路餐厅（一号食堂）', '清真餐厅'],
    ...point(31.1802804, 121.5930591),
    sortOrder: 16,
    enabled: true
  },
  {
    _id: 'shangke-food-court-1f',
    name: '尚科美食广场1楼',
    aliases: ['二号食堂', '二食', '第二食堂', '尚科美食广场', '尚科餐厅', '食堂', '餐厅'],
    area: '餐饮',
    detail: '二号食堂一楼',
    nearby: ['尚科美食广场2楼', '西餐厅'],
    ...point(31.1794923, 121.5927618),
    sortOrder: 17,
    enabled: true
  },
  {
    _id: 'shangke-food-court-2f',
    name: '尚科美食广场2楼',
    aliases: ['二号食堂二楼', '二食二楼', '尚科美食广场', '尚科餐厅', '食堂', '餐厅'],
    area: '餐饮',
    detail: '二号食堂二楼',
    nearby: ['尚科美食广场1楼', '西餐厅'],
    ...point(31.1794731, 121.5927473),
    sortOrder: 18,
    enabled: true
  },
  {
    _id: 'western-dining',
    name: '西餐厅',
    aliases: ['西餐厅', '西餐', 'Western Dining', '二号食堂', '食堂', '餐厅'],
    area: '餐饮',
    ...point(31.1797080, 121.5928299),
    sortOrder: 19,
    enabled: true
  },
  {
    _id: 'magnolia-dining',
    name: '白玉兰一楼餐厅（三号食堂）',
    aliases: ['白玉兰餐厅', '白玉兰一楼', '三号食堂', '三食堂', '3食堂', '食堂', '餐厅'],
    area: '餐饮',
    detail: '白玉兰一楼餐厅，常称三号食堂',
    nearby: ['图书馆', '塔楼', '学生公寓7-10号楼'],
    ...point(31.1785475, 121.5922741),
    sortOrder: 20,
    enabled: true
  },
  {
    _id: 'halal-dining',
    name: '清真餐厅',
    aliases: ['清真', '清真食堂', '清真餐厅', '食堂', '餐厅'],
    area: '餐饮',
    ...point(31.1784444, 121.5922522),
    sortOrder: 21,
    enabled: true
  },
  {
    _id: 'kfc',
    name: 'KFC（上科大店）',
    aliases: ['KFC', '肯德基', '食堂', '餐厅'],
    area: '餐饮',
    ...point(31.1797536, 121.5928461),
    sortOrder: 22,
    enabled: true
  },
  {
    _id: 'dorm-1-6',
    name: '学生公寓1-6号楼',
    aliases: ['宿舍', '学生公寓', '1号楼', '2号楼', '3号楼', '4号楼', '5号楼', '6号楼'],
    area: '住宿区',
    ...point(31.1792819, 121.5939718),
    sortOrder: 23,
    enabled: true
  },
  {
    _id: 'dorm-7-10',
    name: '学生公寓7-10号楼',
    aliases: ['宿舍', '学生公寓', '7号楼', '8号楼', '9号楼', '10号楼'],
    area: '住宿区',
    ...point(31.1780693, 121.5935876),
    sortOrder: 24,
    enabled: true
  },
  {
    _id: 'faculty-village',
    name: '教师公寓',
    aliases: ['教师公寓', 'Faculty Village', '专家公寓'],
    area: '住宿区',
    ...point(31.1774642, 121.5934732),
    sortOrder: 25,
    enabled: true
  },
  {
    _id: 'athletic-center',
    name: '体育馆',
    aliases: ['体育馆', '健身', 'Athletic Center'],
    area: '运动区',
    ...point(31.1786671, 121.5938098),
    sortOrder: 26,
    enabled: true
  },
  {
    _id: 'stadium',
    name: '体育场',
    aliases: ['体育场', '操场', '田径场', '足球场', 'Stadium'],
    area: '运动区',
    ...point(31.1786671, 121.5938098),
    sortOrder: 27,
    enabled: true
  },
  {
    _id: 'swimming',
    name: '游泳馆',
    aliases: ['游泳馆', 'Swimming Facilities', '泳池'],
    area: '运动区',
    ...point(31.1819873, 121.5928600),
    sortOrder: 28,
    enabled: true
  },
  {
    _id: 'conference-center',
    name: '会议中心',
    aliases: ['会议中心', 'Conference Center'],
    area: '公共区',
    ...point(31.1822026, 121.5933742),
    sortOrder: 29,
    enabled: true
  },
  {
    _id: 'tower',
    name: '塔楼',
    aliases: ['塔楼', 'Tower'],
    area: '公共区',
    ...point(31.1764991, 121.5920087),
    sortOrder: 30,
    enabled: true
  },
  {
    _id: 'north-gate',
    name: '北门（海科路230号）',
    aliases: ['北门', '海科路230号', '海科路门'],
    area: '出入口',
    ...point(31.1828811, 121.5913791),
    sortOrder: 31,
    enabled: true
  },
  {
    _id: 'east-gate',
    name: '东门（中科路1号）',
    aliases: ['东门', '中科路1号', '中科路门'],
    area: '出入口',
    ...point(31.1810205, 121.5952219),
    sortOrder: 32,
    enabled: true
  },
  {
    _id: 'south-gate',
    name: '南门（华夏中路393号）',
    aliases: ['南门', '华夏中路393号', '华夏门', '校门口'],
    area: '出入口',
    ...point(31.1759519, 121.5904763),
    sortOrder: 33,
    enabled: true
  },
  {
    _id: 'west-gate',
    name: '西门（集慧路249号）',
    aliases: ['西门', '集慧路249号', '集慧路门'],
    area: '出入口',
    ...point(31.1784008, 121.5853787),
    sortOrder: 34,
    enabled: true
  },
  {
    _id: 'family-mart',
    name: '全家便利店',
    aliases: ['全家', '便利店', 'FamilyMart'],
    area: '生活服务',
    ...gcjPoint(31.1771665, 121.5973837),
    sortOrder: 35,
    enabled: true
  },
  {
    _id: 'coffee-shop',
    name: '咖啡厅',
    aliases: ['咖啡', 'Cafe'],
    area: '餐饮',
    ...gcjPoint(31.1785931, 121.5974827),
    sortOrder: 36,
    enabled: true
  },
  {
    _id: 'medical-room',
    name: '医务室',
    aliases: ['医疗', '医务', '医生'],
    area: '生活服务',
    ...gcjPoint(31.1785384, 121.5968287),
    sortOrder: 37,
    enabled: true
  },
  {
    _id: 'printing-room',
    name: '文印室',
    aliases: ['文印', '打印'],
    area: '生活服务',
    ...gcjPoint(31.1753914, 121.5964267),
    sortOrder: 38,
    enabled: true
  },
  {
    _id: 'self-print',
    name: '自助打印',
    aliases: ['打印', '自助打印'],
    area: '生活服务',
    ...gcjPoint(31.1757441, 121.5952073),
    sortOrder: 39,
    enabled: true
  },
  {
    _id: 'hair-salon',
    name: '校园理发中心',
    aliases: ['理发', '理发店'],
    area: '生活服务',
    ...gcjPoint(31.1777562, 121.5965344),
    sortOrder: 40,
    enabled: true
  },
  {
    _id: 'cainiao',
    name: '菜鸟驿站',
    aliases: ['快递', '驿站', '菜鸟'],
    area: '生活服务',
    ...gcjPoint(31.1773421, 121.5970801),
    sortOrder: 41,
    enabled: true
  },
  {
    _id: 'bank',
    name: '上海银行',
    aliases: ['银行', 'ATM'],
    area: '生活服务',
    ...gcjPoint(31.1784765, 121.5987650),
    sortOrder: 42,
    enabled: true
  },
  {
    _id: 'bank-atm',
    name: '上海银行ATM',
    aliases: ['ATM', '银行'],
    area: '生活服务',
    ...gcjPoint(31.1753914, 121.5964267),
    sortOrder: 43,
    enabled: true
  },
  {
    _id: 'basketball-court',
    name: '篮球场',
    aliases: ['篮球', '球场'],
    area: '运动区',
    ...gcjPoint(31.1776480, 121.5993140),
    sortOrder: 44,
    enabled: true
  },
  {
    _id: 'volleyball-court',
    name: '排球场',
    aliases: ['排球', '球场'],
    area: '运动区',
    ...gcjPoint(31.1781696, 121.5991783),
    sortOrder: 45,
    enabled: true
  },
  {
    _id: 'tennis-court',
    name: '网球场',
    aliases: ['网球', '球场'],
    area: '运动区',
    ...gcjPoint(31.1794116, 121.5961256),
    sortOrder: 46,
    enabled: true
  },
  {
    _id: 'fitness-ground',
    name: '健身场',
    aliases: ['健身', '运动'],
    area: '运动区',
    ...gcjPoint(31.1773651, 121.5996765),
    sortOrder: 47,
    enabled: true
  },
  {
    _id: 'school-bus',
    name: '学校班车',
    aliases: ['班车', '校车'],
    area: '交通',
    ...gcjPoint(31.1760447, 121.5988197),
    sortOrder: 48,
    enabled: true
  }
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

function distanceMeters(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function nearestCampusLocations(coords = CAMPUS_CENTER, limit = 3) {
  const current = {
    latitude: Number(coords.latitude) || CAMPUS_CENTER.latitude,
    longitude: Number(coords.longitude) || CAMPUS_CENTER.longitude
  };
  const accuracy = Number(coords.accuracy) || 0;
  return LOCATIONS
    .filter((location) => location.enabled)
    .map((location) => {
      const distance = Math.round(distanceMeters(current, location));
      const withinAccuracy = accuracy > 0 && distance <= Math.max(accuracy, 35);
      return {
        ...location,
        distance,
        withinAccuracy,
        distanceText: withinAccuracy ? '定位范围内' : `${distance}m`
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

function nearestCampusLocation(coords = CAMPUS_CENTER) {
  return nearestCampusLocations(coords, 1)[0];
}

module.exports = {
  CAMPUS_CENTER,
  LOCATIONS,
  searchLocations,
  nearestCampusLocation,
  nearestCampusLocations
};
