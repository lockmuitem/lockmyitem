'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyQQReviewCorrections,
  matchCampusLocation,
  normalizeQQExtraction,
  qqReplyDeadlineMs,
  qqReplyMessageId,
  qqSignatureMessage,
  routeQQExtraction,
  stableJson
} = require('../qq-ingestion-policy');

test('QQ extraction routes high confidence with location to publish', () => {
  const value = normalizeQQExtraction({ isLostFound: true, confidence: 0.92, title: '白色耳机', locationName: '教学中心', category: '电子产品' });
  assert.equal(routeQQExtraction(value), 'published');
});

test('QQ extraction sends uncertain or location-less items to review', () => {
  assert.equal(routeQQExtraction(normalizeQQExtraction({ confidence: 0.6, title: '手机', locationName: '图书馆' })), 'needs_review');
  assert.equal(routeQQExtraction(normalizeQQExtraction({ confidence: 0.95, title: '手机' })), 'needs_review');
});

test('QQ extraction ignores irrelevant low-confidence chatter', () => {
  assert.equal(routeQQExtraction(normalizeQQExtraction({ isLostFound: false, confidence: 0.99 })), 'ignored');
  assert.equal(routeQQExtraction(normalizeQQExtraction({ confidence: 0.2 })), 'ignored');
});

test('stable JSON signing order is deterministic', () => {
  assert.equal(stableJson({ b: 2, a: { d: 4, c: 3 } }), stableJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test('QQ signature input binds the action and canonical payload', () => {
  const payload = { text: '拾到耳机', groupId: 'group-1', messageIds: ['m1', 'm2'] };
  assert.equal(
    qqSignatureMessage('ingestQQBatch', 1784685600000, payload),
    '1784685600000.ingestQQBatch.{"groupId":"group-1","messageIds":["m1","m2"],"text":"拾到耳机"}'
  );
  assert.notEqual(
    qqSignatureMessage('ingestQQBatch', 1784685600000, payload),
    qqSignatureMessage('pullQQOutbox', 1784685600000, payload)
  );
});

test('QQ raw location resolves to one canonical campus location', () => {
  const locations = [
    { _id: 'teaching', name: '教学中心', aliases: ['教学楼', '教室'] },
    { _id: 'library', name: '图书馆', aliases: ['主图', '阅览室'] }
  ];
  assert.equal(matchCampusLocation(locations, '在教学中心一楼服务台')._id, 'teaching');
  assert.equal(matchCampusLocation(locations, '主图二楼')._id, 'library');
  assert.equal(matchCampusLocation(locations, '校内某处'), null);
});

test('ambiguous generic location alias is not auto-normalized', () => {
  const locations = [
    { _id: 'dining-1', name: '一号食堂', aliases: ['食堂'] },
    { _id: 'dining-2', name: '二号食堂', aliases: ['食堂'] }
  ];
  assert.equal(matchCampusLocation(locations, '食堂门口'), null);
});

test('QQ replies only reference the original message inside the passive-reply window', () => {
  const sentAt = '2026-07-22T10:00:00+08:00';
  const deadline = qqReplyDeadlineMs(sentAt);
  assert.equal(deadline, Date.parse(sentAt) + 4 * 60 * 1000 + 45 * 1000);
  assert.equal(qqReplyMessageId('message-1', deadline, deadline - 1), 'message-1');
  assert.equal(qqReplyMessageId('message-1', deadline, deadline), '');
  assert.equal(qqReplyDeadlineMs('not-a-time'), 0);
});

test('QQ review corrections only update approved fields and preserve sensitivity', () => {
  const original = {
    title: '物品',
    description: '原描述',
    category: '电子产品',
    sensitivityLevel: 'normal',
    senderHash: 'must-not-change'
  };
  const corrected = applyQQReviewCorrections(original, {
    title: '白色耳机',
    locationId: 'teaching-center',
    sensitivityLevel: 'sensitive',
    senderHash: 'attacker-value'
  });
  assert.equal(corrected.title, '白色耳机');
  assert.equal(corrected.locationId, 'teaching-center');
  assert.equal(corrected.sensitivityLevel, 'normal');
  assert.equal(corrected.senderHash, 'must-not-change');
});

test('QQ extraction preserves model important level', () => {
  const value = normalizeQQExtraction({ title: '白色耳机', sensitivityLevel: 'important' });
  assert.equal(value.sensitivityLevel, 'important');
});
