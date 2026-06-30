const { classifyByText } = require('./classifier');

const COLOR_WORDS = [
  '黑色', '白色', '红色', '蓝色', '绿色', '黄色', '灰色', '银色', '金色',
  '粉色', '紫色', '棕色', '橙色', '透明', '深蓝', '浅蓝', '米色'
];

const ACCESSORY_WORDS = [
  '钥匙扣', '挂件', '贴纸', '姓名', '学号', 'logo', '标志', '吊牌', '卡套',
  '保护壳', '伞柄', '拉链', '挂绳', '徽章', '刻字', '划痕'
];

const SHAPE_WORDS = ['折叠', '长柄', '圆形', '方形', '透明', '双肩', '手提', '帆布', '皮质'];

function uniq(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function includesAny(text, words) {
  return words.filter((word) => text.includes(word.toLowerCase()));
}

function tokenize(text = '') {
  return uniq(
    text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 2)
  );
}

function extractItemFeatures(payload = {}) {
  const source = [
    payload.title,
    payload.description,
    payload.category,
    ...(payload.aiTags || []),
    payload.locationName
  ].join(' ').toLowerCase();
  const classification = payload.category
    ? { category: payload.category, aiTags: payload.aiTags || [] }
    : classifyByText(`${payload.title || ''} ${payload.description || ''}`);
  const colors = includesAny(source, COLOR_WORDS);
  const accessories = includesAny(source, ACCESSORY_WORDS);
  const shapes = includesAny(source, SHAPE_WORDS);
  const tokens = tokenize(source);
  const signature = uniq([
    classification.category,
    ...classification.aiTags,
    ...colors,
    ...accessories,
    ...shapes,
    ...tokens
  ]);

  return {
    category: classification.category,
    aiTags: classification.aiTags,
    colors,
    accessories,
    shapes,
    tokens,
    signature,
    imageFingerprint: (payload.imageUrls || []).join('|')
  };
}

function sharedCount(a = [], b = []) {
  const target = new Set(b);
  return a.filter((entry) => target.has(entry)).length;
}

function scoreFeatureMatch(query = {}, candidate = {}) {
  const queryFeatures = query.matchFeatures || extractItemFeatures(query);
  const candidateFeatures = candidate.matchFeatures || extractItemFeatures(candidate);
  let score = 0;
  const reasons = [];

  if (queryFeatures.category && queryFeatures.category === candidateFeatures.category) {
    score += 28;
    reasons.push(`同为${queryFeatures.category}`);
  }

  const colorHits = sharedCount(queryFeatures.colors, candidateFeatures.colors);
  if (colorHits) {
    score += Math.min(colorHits * 14, 22);
    reasons.push(`颜色匹配：${queryFeatures.colors.filter((word) => candidateFeatures.colors.includes(word)).join('、')}`);
  }

  const accessoryHits = sharedCount(queryFeatures.accessories, candidateFeatures.accessories);
  if (accessoryHits) {
    score += Math.min(accessoryHits * 22, 28);
    reasons.push(`细节匹配：${queryFeatures.accessories.filter((word) => candidateFeatures.accessories.includes(word)).join('、')}`);
  }

  const shapeHits = sharedCount(queryFeatures.shapes, candidateFeatures.shapes);
  if (shapeHits) {
    score += Math.min(shapeHits * 10, 16);
    reasons.push(`外观匹配：${queryFeatures.shapes.filter((word) => candidateFeatures.shapes.includes(word)).join('、')}`);
  }

  const semanticHits = sharedCount(queryFeatures.signature, candidateFeatures.signature);
  if (semanticHits) score += Math.min(semanticHits * 4, 18);

  if (query.locationId && candidate.locationId && query.locationId === candidate.locationId) {
    score += 10;
    reasons.push('地点一致');
  }

  if (queryFeatures.imageFingerprint && candidateFeatures.imageFingerprint) {
    score += 8;
    reasons.push('双方都有图片，可进一步做图像相似度');
  }

  return {
    similarity: Math.min(score, 99),
    reasons: reasons.slice(0, 3),
    queryFeatures,
    candidateFeatures
  };
}

module.exports = {
  extractItemFeatures,
  scoreFeatureMatch,
  tokenize
};
