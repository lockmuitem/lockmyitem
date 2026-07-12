import { categoryKeywords, locationAliases, locations } from './data.js';

const colorWords = ['黑色', '白色', '红色', '蓝色', '绿色', '黄色', '灰色', '银色', '金色', '粉色', '紫色', '透明'];
const detailWords = ['钥匙扣', '挂件', '贴纸', '姓名', '学号', 'logo', '标志', '卡套', '保护壳', '伞柄', '拉链', '刻字', '划痕'];
const shapeWords = ['折叠', '长柄', '圆形', '方形', '双肩', '手提', '帆布', '皮质'];

export function classifyByText(text = '') {
  const source = text.toLowerCase();
  const titleSource = source.split(/\s+/)[0] || source;
  let best = null;

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    const score = keywords.reduce((total, word) => {
      const keyword = word.toLowerCase();
      if (!source.includes(keyword)) return total;
      return total + (titleSource.includes(keyword) ? 3 : 1);
    }, 0);

    if (score > 0 && (!best || score > best.score)) {
      best = { category, score };
    }
  }

  if (best) return { category: best.category, tags: [best.category], confidence: 0.62 };

  return { category: '其他', tags: ['待确认'], confidence: 0 };
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function hits(source, words) {
  return words.filter((word) => source.includes(word.toLowerCase()));
}

function tokenize(text = '') {
  return unique(
    text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 2)
  );
}

export function getLocation(locationId) {
  const resolvedId = locationAliases[locationId] || locationId;
  return locations.find((location) => location.id === resolvedId) || locations[0];
}

function searchableText(item = {}) {
  const location = getLocation(item.locationId);
  return [
    item.title,
    item.description,
    item.category,
    ...(item.tags || []),
    item.visualDescription,
    item.locationDetail,
    location?.name,
    location?.area,
    location?.guide,
    location?.searchableText
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function extractFeatures(item = {}) {
  const source = searchableText(item);
  const classification = item.category ? { category: item.category, tags: item.tags || [] } : classifyByText(source);
  const colors = hits(source, colorWords);
  const details = hits(source, detailWords);
  const shapes = hits(source, shapeWords);
  const tokens = tokenize(source);
  return {
    category: classification.category,
    tags: classification.tags,
    colors,
    details,
    shapes,
    signature: unique([classification.category, ...classification.tags, ...colors, ...details, ...shapes, ...tokens])
  };
}

export function semanticSearchItems(items = [], query = '') {
  const keyword = query.trim();
  if (!keyword) return items;

  const queryText = keyword.toLowerCase();
  const isLocationQuery = locations.some((location) => (
    [location.name, location.area, location.guide, location.searchableText]
      .filter(Boolean)
      .some((entry) => String(entry).toLowerCase().includes(queryText))
  ));
  const queryFeatures = extractFeatures({ title: keyword, description: keyword });
  const queryTokens = tokenize(keyword);
  const canUseSemanticFeatures = !isLocationQuery || queryFeatures.colors.length || queryFeatures.details.length || queryFeatures.shapes.length;

  return items
    .map((item) => {
      const targetText = searchableText(item);
      const targetFeatures = extractFeatures(item);
      let score = 0;
      let directHit = false;

      if (targetText.includes(queryText)) {
        score += 48;
        directHit = true;
      }

      const tokenHits = queryTokens.filter((token) => targetText.includes(token));
      if (tokenHits.length) {
        score += Math.min(tokenHits.length * 14, 42);
        directHit = true;
      }

      if (!isLocationQuery && queryFeatures.category && queryFeatures.category !== '其他' && queryFeatures.category === targetFeatures.category) {
        score += 22;
        directHit = true;
      }

      const colorScore = Math.min(sharedCount(queryFeatures.colors, targetFeatures.colors) * 18, 28);
      const detailScore = Math.min(sharedCount(queryFeatures.details, targetFeatures.details) * 20, 32);
      const shapeScore = Math.min(sharedCount(queryFeatures.shapes, targetFeatures.shapes) * 14, 22);
      if (colorScore || detailScore || shapeScore) directHit = true;
      score += colorScore + detailScore + shapeScore;

      if (canUseSemanticFeatures) {
        score += Math.min(sharedCount(queryFeatures.signature, targetFeatures.signature) * 5, 24);
      }

      return { item, score: directHit ? score : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.item.createdAt) - new Date(a.item.createdAt))
    .map((entry) => entry.item);
}

function sharedCount(a = [], b = []) {
  const target = new Set(b);
  return a.filter((entry) => target.has(entry)).length;
}

export function scoreMatch(query = {}, candidate = {}) {
  const q = extractFeatures(query);
  const c = extractFeatures(candidate);
  const reasons = [];
  let score = 0;

  if (q.category && q.category === c.category) {
    score += 30;
    reasons.push(`同为${q.category}`);
  }

  const colorHits = sharedCount(q.colors, c.colors);
  if (colorHits) {
    score += Math.min(colorHits * 14, 24);
    reasons.push(`颜色相近：${q.colors.filter((word) => c.colors.includes(word)).join('、')}`);
  }

  const detailHits = sharedCount(q.details, c.details);
  if (detailHits) {
    score += Math.min(detailHits * 24, 30);
    reasons.push(`细节匹配：${q.details.filter((word) => c.details.includes(word)).join('、')}`);
  }

  const shapeHits = sharedCount(q.shapes, c.shapes);
  if (shapeHits) {
    score += Math.min(shapeHits * 12, 18);
    reasons.push(`外观匹配：${q.shapes.filter((word) => c.shapes.includes(word)).join('、')}`);
  }

  const semanticHits = sharedCount(q.signature, c.signature);
  if (semanticHits) score += Math.min(semanticHits * 4, 18);

  if (query.locationId && candidate.locationId && query.locationId === candidate.locationId) {
    score += 10;
    reasons.push('地点一致');
  }

  return {
    similarity: Math.min(score, 99),
    reasons: reasons.slice(0, 3)
  };
}

export function findPotentialMatches(item, items) {
  if (item.type !== 'lost') return [];
  return items
    .filter((entry) => entry.type === 'found' && entry.status === 'active')
    .map((entry) => {
      const match = scoreMatch(item, entry);
      return { ...entry, similarity: match.similarity, reasons: match.reasons };
    })
    .filter((entry) => entry.similarity >= 58)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}

export function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}
