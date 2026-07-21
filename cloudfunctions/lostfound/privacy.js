const SENSITIVE_CATEGORIES = ['证件', '钥匙', '校园卡'];
const IMPORTANT_CATEGORIES = ['电子产品'];

const SENSITIVE_WORDS = [
  '钱包',
  '工卡',
  '工作证',
  '身份证',
  '学生证',
  '校园卡',
  '一卡通',
  '饭卡',
  '护照',
  '银行卡',
  '信用卡',
  '借记卡',
  '医保卡',
  '社保卡',
  '驾驶证',
  '证件',
  '门禁卡',
  '卡包'
];

const IMPORTANT_WORDS = ['手机', '电脑', '笔记本', '平板', '耳机', '相机', '手表', '电子产品'];

function unique(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function sourceText(item = {}) {
  return [
    item.title,
    item.description,
    item.visualDescription,
    item.category,
    ...(item.tags || []),
    ...(item.aiTags || []),
    ...(item.semanticTags || []),
    ...(item.yoloObjects || [])
  ].filter(Boolean).join(' ');
}

function isFoundItem(item = {}) {
  return (item.type || item.itemType) === 'found';
}

function replaceSensitivePattern(text, pattern, replacement, reason, reasons) {
  let changed = false;
  const nextText = String(text || '').replace(pattern, (...args) => {
    changed = true;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (changed) reasons.push(reason);
  return nextText;
}

function maskSensitiveText(value = '') {
  const reasons = [];
  let text = String(value || '');

  text = replaceSensitivePattern(
    text,
    /\b\d{6}(?:18|19|20)?\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    '[身份证号已隐藏]',
    '身份证号已隐藏',
    reasons
  );
  text = replaceSensitivePattern(
    text,
    /(^|[^\d])1[3-9]\d{9}(?=$|[^\d])/g,
    (match, prefix) => `${prefix}[手机号已隐藏]`,
    '手机号已隐藏',
    reasons
  );
  text = replaceSensitivePattern(
    text,
    /((?:身份证|学生证|工作证|工卡|校园卡|一卡通|饭卡|银行卡|信用卡|借记卡|护照|证件|卡)(?:号|号码|编号)?|工号|学号|证号)\s*[:：#]?\s*[A-Za-z0-9-]{6,24}/g,
    (match, label) => `${label} [编号已隐藏]`,
    '编号已隐藏',
    reasons
  );
  text = replaceSensitivePattern(
    text,
    /(?:\d[\s-]?){12,19}/g,
    '[卡号已隐藏]',
    '卡号已隐藏',
    reasons
  );

  return {
    text,
    changed: text !== String(value || ''),
    reasons: unique(reasons)
  };
}

function hasSensitiveWord(text = '') {
  if (SENSITIVE_WORDS.some((word) => text.includes(word))) return true;
  return /钥匙(?!扣)/.test(text);
}

function sensitivityForItem(item = {}, maskReasons = []) {
  const text = sourceText(item);
  const reasons = [];
  const category = String(item.category || '').trim();

  if (SENSITIVE_CATEGORIES.includes(category)) reasons.push(category);
  if (hasSensitiveWord(text)) reasons.push('重要证件或门禁物品');
  reasons.push(...maskReasons);
  if (reasons.length) {
    return { level: 'sensitive', reasons: unique(reasons) };
  }

  if (IMPORTANT_CATEGORIES.includes(category) || IMPORTANT_WORDS.some((word) => text.includes(word))) {
    return { level: 'important', reasons: ['贵重物品'] };
  }

  return { level: 'normal', reasons: [] };
}

function sanitizeFoundItemPrivacy(item = {}) {
  if (!isFoundItem(item)) return item;

  const title = maskSensitiveText(item.title);
  const description = maskSensitiveText(item.description);
  const visualDescription = maskSensitiveText(item.visualDescription);
  const maskReasons = unique([...title.reasons, ...description.reasons, ...visualDescription.reasons]);
  const sensitivity = sensitivityForItem(item, maskReasons);

  return {
    ...item,
    title: title.text,
    description: description.text,
    visualDescription: visualDescription.text,
    sensitivityLevel: item.sensitivityLevel === 'sensitive' ? 'sensitive' : sensitivity.level,
    sensitivityReasons: unique([...(item.sensitivityReasons || []), ...sensitivity.reasons])
  };
}

function isProtectedFoundItem(item = {}) {
  if (!isFoundItem(item)) return false;
  const level = sanitizeFoundItemPrivacy(item).sensitivityLevel;
  return level === 'important' || level === 'sensitive';
}

function privacyPromptLines(itemType = '') {
  if (itemType !== 'found') return [];
  return [
    '这是招领帖，请保护失主隐私。',
    '不要输出完整卡号、身份证号、手机号、工号、学号、护照号或其他证件唯一编号。',
    '如果图片或用户描述中出现这些编号，只写“编号已隐藏”或描述为证件/卡片类别。',
    '不要抄录二维码、条码、证件上的完整姓名或唯一识别信息。'
  ];
}

module.exports = {
  isProtectedFoundItem,
  maskSensitiveText,
  sanitizeFoundItemPrivacy,
  privacyPromptLines
};
