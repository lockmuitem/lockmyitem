const { CATEGORY_KEYWORDS } = require('./constants');

function classifyByText(text = '') {
  const source = text.toLowerCase();
  const categories = Object.keys(CATEGORY_KEYWORDS);
  for (let i = 0; i < categories.length; i += 1) {
    const category = categories[i];
    if (CATEGORY_KEYWORDS[category].some((word) => source.includes(word.toLowerCase()))) {
      return {
        category,
        aiTags: [category],
        confidence: 0.62
      };
    }
  }
  return {
    category: '其他',
    aiTags: ['待确认'],
    confidence: 0
  };
}

module.exports = {
  classifyByText
};
