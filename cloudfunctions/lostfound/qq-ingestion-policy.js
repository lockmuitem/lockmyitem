'use strict';

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

function clean(value = '', maxLength = 300) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, maxLength);
}

function normalizeQQExtraction(raw = {}, fallbackText = '') {
  const confidence = clamp(raw.confidence ?? raw.publishConfidence ?? raw.score);
  const isLostFound = raw.isLostFound !== false && raw.relevant !== false;
  return {
    isLostFound,
    confidence,
    type: raw.type === 'lost' ? 'lost' : 'found',
    title: clean(raw.title || raw.itemName || 'QQ群失物招领', 80),
    description: clean(raw.description || fallbackText || '来自QQ群的失物招领线索', 500),
    category: clean(raw.category || '其他', 30),
    locationRaw: clean(raw.locationRaw || raw.rawLocation || '', 160),
    locationName: clean(raw.locationName || raw.normalizedLocation || raw.locationRaw || '', 80),
    occurredAtText: clean(raw.occurredAtText || raw.timeText || '', 80),
    sensitivityLevel: raw.sensitivityLevel === 'sensitive' ? 'sensitive' : 'normal',
    aiTags: Array.isArray(raw.aiTags) ? raw.aiTags.map((entry) => clean(entry, 30)).filter(Boolean).slice(0, 10) : [],
    modelReason: clean(raw.reason || raw.modelReason || '', 240)
  };
}

function routeQQExtraction(extraction = {}, thresholds = {}) {
  const high = Number(thresholds.high ?? 0.8);
  const medium = Number(thresholds.medium ?? 0.45);
  if (!extraction.isLostFound || extraction.confidence < medium) return 'ignored';
  if (extraction.confidence >= high && extraction.title && (extraction.locationName || extraction.locationRaw)) return 'published';
  return 'needs_review';
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function qqSignatureMessage(action, timestamp, payload = {}) {
  return `${Number(timestamp)}.${String(action || '')}.${stableJson(payload)}`;
}

function applyQQReviewCorrections(extraction = {}, corrections = {}) {
  const result = { ...extraction };
  if (corrections.type === 'found' || corrections.type === 'lost') result.type = corrections.type;
  const fields = {
    title: 80,
    description: 500,
    category: 30,
    locationId: 80,
    locationRaw: 160,
    occurredAtText: 80
  };
  for (const [field, limit] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(corrections, field)) result[field] = clean(corrections[field], limit);
  }
  return result;
}

function matchCampusLocation(locations = [], text = '') {
  const source = clean(text, 300).toLowerCase();
  if (!source) return null;
  const scored = [];
  for (const location of locations) {
    const terms = [location.name, ...(Array.isArray(location.aliases) ? location.aliases : [])]
      .map((value) => clean(value, 80).toLowerCase())
      .filter((value) => value.length >= 2);
    let score = 0;
    for (const term of terms) {
      if (source === term) score = Math.max(score, 1000 + term.length);
      else if (source.includes(term)) score = Math.max(score, term.length);
    }
    if (score) scored.push({ location, score });
  }
  scored.sort((left, right) => right.score - left.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].location;
}

function qqReplyDeadlineMs(sentAt, ttlMs = 5 * 60 * 1000, safetyMs = 15 * 1000) {
  const raw = String(sentAt || '').trim();
  if (!raw) return 0;
  const numeric = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const sentAtMs = Number.isFinite(numeric)
    ? (raw.length <= 10 ? numeric * 1000 : numeric)
    : Date.parse(raw);
  if (!Number.isFinite(sentAtMs)) return 0;
  return sentAtMs + Math.max(0, ttlMs - safetyMs);
}

function qqReplyMessageId(messageId, replyUntilMs, currentTimeMs = Date.now()) {
  return messageId && Number(replyUntilMs) > Number(currentTimeMs) ? String(messageId) : '';
}

module.exports = {
  applyQQReviewCorrections,
  matchCampusLocation,
  normalizeQQExtraction,
  qqReplyDeadlineMs,
  qqReplyMessageId,
  qqSignatureMessage,
  routeQQExtraction,
  stableJson
};
