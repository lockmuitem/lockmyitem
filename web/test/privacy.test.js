import test from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedFoundItem, sanitizeFoundItemPrivacy, sensitivityBadgeText } from '../src/privacy.js';

test('web privacy policy protects only cards and identity documents', () => {
  for (const title of ['校园卡', '上海银行卡', '身份证']) {
    const item = sanitizeFoundItemPrivacy({ type: 'found', category: '其他', title });
    assert.equal(isProtectedFoundItem(item), true, title);
  }
});

test('web policy protects important valuables', () => {
  for (const sample of [
    { title: '钱包', category: '其他' },
    { title: 'AirPods', category: '电子产品' },
    { title: '手机', category: '电子产品' },
    { title: '宿舍钥匙', category: '钥匙' },
    { title: '黑色无线鼠标', category: '电子产品' },
    { title: '无线耳机盒', category: '电子产品' }
  ]) {
    const item = sanitizeFoundItemPrivacy({ type: 'found', ...sample, sensitivityLevel: 'important' });
    assert.equal(item.sensitivityLevel, 'important', sample.title);
    assert.equal(isProtectedFoundItem(item), true, sample.title);
    assert.equal(sensitivityBadgeText(item), '重要物品', sample.title);
  }
});

test('web policy keeps explicit sensitive classification', () => {
  const item = sanitizeFoundItemPrivacy({ type: 'found', title: '未命名物品', sensitivityLevel: 'sensitive' });
  assert.equal(item.sensitivityLevel, 'sensitive');
  assert.equal(isProtectedFoundItem(item), true);
});
