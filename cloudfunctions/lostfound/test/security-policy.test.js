'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLAIM_REQUEST_STATUS,
  canActorSeeClaimant,
  canViewerSeeComment,
  canCompleteActiveClaim,
  evaluateFixedWindow,
  evaluateOtpRecord,
  isClaimTokenPayloadValid,
  isApprovedToViewRequest,
  redactInternalImageReferences,
  redactInternalItemSource,
  reviewStatusForDecision,
  redactProtectedImages,
  shouldNotifyOwner
} = require('../security-policy');

test('claimant information is visible only to owner and actual claimant', () => {
  const item = { ownerOpenid: 'owner', claimedByOpenid: 'claimant' };
  assert.equal(canActorSeeClaimant(item, 'owner'), true);
  assert.equal(canActorSeeClaimant(item, 'claimant'), true);
  assert.equal(canActorSeeClaimant(item, 'other-login'), false);
  assert.equal(canActorSeeClaimant(item, ''), false);
});

test('owner approval grants view permission without completing return', () => {
  assert.equal(reviewStatusForDecision('approve'), CLAIM_REQUEST_STATUS.APPROVED_TO_VIEW);
  assert.equal(reviewStatusForDecision('reject'), CLAIM_REQUEST_STATUS.REJECTED);
  assert.equal(isApprovedToViewRequest({ status: 'approved_to_view', itemId: 'i1', claimantOpenid: 'c1' }, 'i1', 'c1'), true);
  assert.equal(isApprovedToViewRequest({ status: 'completed', itemId: 'i1', claimantOpenid: 'c1' }, 'i1', 'c1'), false);
  assert.equal(isApprovedToViewRequest({ status: 'approved_to_view', itemId: 'i1', claimantOpenid: 'c1', reviewedAtMs: 900 }, 'i1', 'c1', { notBeforeMs: 1000 }), false);
  assert.equal(isApprovedToViewRequest({ status: 'approved_to_view', itemId: 'i1', claimantOpenid: 'c1', reviewedAtMs: 1000 }, 'i1', 'c1', { notBeforeMs: 1000 }), true);
});

test('claim contact comments are visible only to claim parties', () => {
  const privateComment = { visibility: 'claim_parties', content: 'Alice completed pickup: alice@example.com' };
  assert.equal(canViewerSeeComment(privateComment, false), false);
  assert.equal(canViewerSeeComment(privateComment, true), true);
  assert.equal(canViewerSeeComment({ content: '普通评论' }, false), true);
  assert.equal(canViewerSeeComment({ content: '张三已认领：foo@example.com' }, false), false);
});

test('persistent fixed-window limiter enforces cooldown and maximum', () => {
  const first = evaluateFixedWindow(null, { nowMs: 1000, maxRequests: 2, windowMs: 10000, minIntervalMs: 500 });
  assert.equal(first.allowed, true);
  assert.equal(evaluateFixedWindow(first.next, { nowMs: 1200, maxRequests: 2, windowMs: 10000, minIntervalMs: 500 }).reason, 'cooldown');
  const second = evaluateFixedWindow(first.next, { nowMs: 1600, maxRequests: 2, windowMs: 10000, minIntervalMs: 500 });
  assert.equal(second.allowed, true);
  assert.equal(evaluateFixedWindow(second.next, { nowMs: 2200, maxRequests: 2, windowMs: 10000, minIntervalMs: 500 }).reason, 'window');
});

test('owner notification is aggregated by cooldown', () => {
  assert.equal(shouldNotifyOwner({}, 10000, 5000), true);
  assert.equal(shouldNotifyOwner({ ownerNotifiedAtMs: 9000 }, 10000, 5000), false);
  assert.equal(shouldNotifyOwner({ ownerNotifiedAtMs: 4000 }, 10000, 5000), true);
});

test('OTP policy handles success, replay, expiration and attempt lock', () => {
  const active = { expiresAtMs: 2000, attempts: 0, used: false };
  assert.deepEqual(evaluateOtpRecord(active, { nowMs: 1000, maxAttempts: 5, matches: true }), { valid: true, consume: true });
  assert.equal(evaluateOtpRecord({ ...active, used: true }, { nowMs: 1000, maxAttempts: 5, matches: true }).reason, 'expired');
  assert.equal(evaluateOtpRecord(active, { nowMs: 3000, maxAttempts: 5, matches: true }).reason, 'expired');
  assert.equal(evaluateOtpRecord({ ...active, attempts: 5 }, { nowMs: 1000, maxAttempts: 5, matches: true }).reason, 'locked');
  assert.equal(evaluateOtpRecord(active, { nowMs: 1000, maxAttempts: 5, matches: false }).incrementAttempts, true);
});

test('claim token is bound to claimant, item and expiry', () => {
  const payload = { typ: 'claim', itemId: 'item-1', sub: 'claimant-1', exp: 2000 };
  assert.equal(isClaimTokenPayloadValid(payload, { itemId: 'item-1', claimantOpenid: 'claimant-1', nowMs: 1000 }), true);
  assert.equal(isClaimTokenPayloadValid(payload, { itemId: 'item-2', claimantOpenid: 'claimant-1', nowMs: 1000 }), false);
  assert.equal(isClaimTokenPayloadValid(payload, { itemId: 'item-1', claimantOpenid: 'other', nowMs: 1000 }), false);
  assert.equal(isClaimTokenPayloadValid(payload, { itemId: 'item-1', claimantOpenid: 'claimant-1', nowMs: 3000 }), false);
});

test('locked image response removes every raw image field', () => {
  const redacted = redactProtectedImages({
    image: 'temporary-url',
    images: ['legacy-url'],
    imageFileId: 'cloud://private/single.jpg',
    imageUrls: ['temporary-url'],
    imageFileIds: ['cloud://private/raw.jpg'],
    thumbUrl: 'thumb',
    originalImage: 'original',
    originalImages: ['original'],
    rawImage: 'raw',
    rawImages: ['raw'],
    locationImages: ['location-photo']
  });
  assert.equal(redacted.image, '');
  assert.deepEqual(redacted.images, []);
  assert.equal(redacted.imageFileId, '');
  assert.deepEqual(redacted.imageUrls, []);
  assert.deepEqual(redacted.imageFileIds, []);
  assert.equal(redacted.thumbUrl, '');
  assert.equal(redacted.originalImage, '');
  assert.deepEqual(redacted.originalImages, []);
  assert.equal(redacted.rawImage, '');
  assert.deepEqual(redacted.rawImages, []);
  assert.deepEqual(redacted.locationImages, []);
  assert.equal(redacted.claimImageLocked, true);
});

test('public item source keeps platform but removes QQ identifiers', () => {
  const redacted = redactInternalItemSource({
    title: '耳机',
    source: { platform: 'qq', groupId: 'group-secret', messageIds: ['m1'], senderHash: 'hash' }
  });
  assert.deepEqual(redacted.source, { platform: 'qq' });
  assert.equal(redacted.title, '耳机');
});

test('authorized image responses still remove persistent CloudBase file references', () => {
  const redacted = redactInternalImageReferences({
    imageFileId: 'cloud://private/single.jpg',
    imageFileIds: ['cloud://private/raw.jpg'],
    imageUrls: ['https://temporary.example/raw.jpg'],
    thumbUrl: 'https://temporary.example/raw.jpg',
    originalImageUrl: 'cloud://private/original.jpg',
    rawImages: ['cloud://private/raw-legacy.jpg']
  });
  assert.equal('imageFileId' in redacted, false);
  assert.equal('imageFileIds' in redacted, false);
  assert.equal('originalImageUrl' in redacted, false);
  assert.equal('rawImages' in redacted, false);
  assert.deepEqual(redacted.imageUrls, ['https://temporary.example/raw.jpg']);
  assert.equal(redacted.thumbUrl, 'https://temporary.example/raw.jpg');
});

test('only an active found item can enter final claim transition', () => {
  assert.equal(canCompleteActiveClaim({ type: 'found', status: 'active' }), true);
  assert.equal(canCompleteActiveClaim({ type: 'found', status: 'returned' }), false);
  assert.equal(canCompleteActiveClaim({ type: 'lost', status: 'active' }), false);
});
