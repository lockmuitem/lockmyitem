'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isProtectedFoundItem, sanitizeFoundItemPrivacy } = require('../privacy');

for (const sample of [
  { category: '校园卡', title: '蓝色校园卡' },
  { category: '证件', title: '身份证' },
  { category: '其他', title: '上海银行卡' }
]) {
  test(`found card or document is image-protected: ${sample.title}`, () => {
    const item = sanitizeFoundItemPrivacy({ ...sample, type: 'found' });
    assert.equal(item.sensitivityLevel, 'sensitive');
    assert.equal(isProtectedFoundItem(item), true);
  });
}

for (const sample of [
  { category: '电子产品', title: '白色 AirPods' },
  { category: '电子产品', title: '手机' },
  { category: '电子产品', title: '黑色无线鼠标' },
  { category: '电子产品', title: '无线耳机盒' },
  { category: '钥匙', title: '宿舍钥匙' },
  { category: '其他', title: '黑色钱包' },
  { category: '电子产品', title: '旧重要耳机', sensitivityLevel: 'important', sensitivityReasons: ['贵重物品'] }
]) {
  test(`important valuables are image-protected: ${sample.title}`, () => {
    const item = sanitizeFoundItemPrivacy({ ...sample, type: 'found' });
    assert.equal(item.sensitivityLevel, 'important');
    assert.equal(isProtectedFoundItem(item), true);
  });
}

test('lost posts are not image-protected', () => {
  assert.equal(isProtectedFoundItem({ type: 'lost', category: '电子产品', title: '手机' }), false);
});

test('explicit sensitive classification is preserved', () => {
  const elevated = sanitizeFoundItemPrivacy({ type: 'found', title: '物品', sensitivityLevel: 'sensitive' });
  assert.equal(elevated.sensitivityLevel, 'sensitive');
  const matched = sanitizeFoundItemPrivacy({ type: 'found', title: '银行卡', sensitivityLevel: 'normal' });
  assert.equal(matched.sensitivityLevel, 'sensitive');
});
