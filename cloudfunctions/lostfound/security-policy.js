'use strict';

const CLAIM_REQUEST_STATUS = Object.freeze({
  PENDING: 'pending_review',
  APPROVED_TO_VIEW: 'approved_to_view',
  REJECTED: 'rejected',
  MODEL_VERIFIED: 'model_verified',
  COMPLETED: 'completed'
});

function canActorSeeClaimant(item = {}, actorId = '') {
  return Boolean(
    actorId
    && (item.ownerOpenid === actorId || item.claimedByOpenid === actorId)
  );
}

function reviewStatusForDecision(decision = '') {
  if (decision === 'approve') return CLAIM_REQUEST_STATUS.APPROVED_TO_VIEW;
  if (decision === 'reject') return CLAIM_REQUEST_STATUS.REJECTED;
  return '';
}

function isApprovedToViewRequest(request = {}, itemId = '', claimantOpenid = '', options = {}) {
  const approved = Boolean(
    request
    && request.status === CLAIM_REQUEST_STATUS.APPROVED_TO_VIEW
    && request.itemId === itemId
    && request.claimantOpenid === claimantOpenid
  );
  if (!approved) return false;
  const notBeforeMs = Number(options.notBeforeMs || 0);
  if (!notBeforeMs) return true;
  return Number(request.reviewedAtMs || 0) >= notBeforeMs;
}

function canViewerSeeComment(comment = {}, canSeeClaimant = false) {
  if (canSeeClaimant) return true;
  if (comment.visibility === 'claim_parties') return false;
  return !/已认领|申请认领|领取人|领取者/.test(String(comment.content || ''));
}

function evaluateFixedWindow(current = null, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const maxRequests = Math.max(1, Number(options.maxRequests || 1));
  const windowMs = Math.max(1, Number(options.windowMs || 1));
  const minIntervalMs = Math.max(0, Number(options.minIntervalMs || 0));
  const count = Number(current?.count || 0);
  const resetAt = Number(current?.resetAt || 0);
  const lastRequestAt = Number(current?.lastRequestAt || 0);

  if (!current || resetAt <= nowMs) {
    return {
      allowed: true,
      next: { count: 1, resetAt: nowMs + windowMs, lastRequestAt: nowMs }
    };
  }

  if (minIntervalMs && lastRequestAt && nowMs - lastRequestAt < minIntervalMs) {
    return {
      allowed: false,
      reason: 'cooldown',
      retryAfterSeconds: Math.max(1, Math.ceil((minIntervalMs - (nowMs - lastRequestAt)) / 1000))
    };
  }

  if (count >= maxRequests) {
    return {
      allowed: false,
      reason: 'window',
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - nowMs) / 1000))
    };
  }

  return {
    allowed: true,
    next: { count: count + 1, resetAt, lastRequestAt: nowMs }
  };
}

function shouldNotifyOwner(request = {}, nowMs = Date.now(), cooldownMs = 0) {
  const last = Number(request.ownerNotifiedAtMs || 0);
  return !last || nowMs - last >= Math.max(0, Number(cooldownMs || 0));
}

function evaluateOtpRecord(record = null, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  if (!record || record.used || !Number(record.expiresAtMs) || Number(record.expiresAtMs) < nowMs) {
    return { valid: false, reason: 'expired' };
  }
  if (Number(record.attempts || 0) >= Number(options.maxAttempts || 1)) {
    return { valid: false, reason: 'locked' };
  }
  if (!options.matches) return { valid: false, reason: 'invalid', incrementAttempts: true };
  return { valid: true, consume: true };
}

function isClaimTokenPayloadValid(payload = null, options = {}) {
  if (!payload || payload.typ !== 'claim') return false;
  if (!options.itemId || payload.itemId !== options.itemId) return false;
  if (!options.claimantOpenid || payload.sub !== options.claimantOpenid) return false;
  const expiresAt = Number(payload.exp || 0);
  return Number.isFinite(expiresAt) && expiresAt >= Number(options.nowMs || Date.now());
}

function redactProtectedImages(item = {}) {
  return {
    ...item,
    image: '',
    images: [],
    imageFileId: '',
    imageUrls: [],
    imageFileIds: [],
    thumbUrl: '',
    originalImage: '',
    originalImages: [],
    originalImageUrl: '',
    originalImageUrls: [],
    rawImage: '',
    rawImages: [],
    locationImages: [],
    claimImageLocked: true,
    claimProtected: true
  };
}

function redactInternalItemSource(item = {}) {
  const sourcePlatform = String(item.source?.platform || '').trim();
  return {
    ...item,
    source: sourcePlatform ? { platform: sourcePlatform } : undefined
  };
}

function redactInternalImageReferences(item = {}) {
  const {
    imageFileId,
    imageFileIds,
    originalImage,
    originalImages,
    originalImageUrl,
    originalImageUrls,
    rawImage,
    rawImages,
    ...publicItem
  } = item;
  void imageFileId;
  void imageFileIds;
  void originalImage;
  void originalImages;
  void originalImageUrl;
  void originalImageUrls;
  void rawImage;
  void rawImages;
  return publicItem;
}

function canCompleteActiveClaim(item = {}) {
  return item.type === 'found' && item.status === 'active';
}

module.exports = {
  CLAIM_REQUEST_STATUS,
  canActorSeeClaimant,
  canViewerSeeComment,
  evaluateOtpRecord,
  isClaimTokenPayloadValid,
  redactInternalItemSource,
  redactInternalImageReferences,
  redactProtectedImages,
  canCompleteActiveClaim,
  evaluateFixedWindow,
  isApprovedToViewRequest,
  reviewStatusForDecision,
  shouldNotifyOwner
};
