'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');

const AUTH_SECRET = 'endpoint-test-secret-with-at-least-32-characters';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function matches(document, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    const actual = document[key];
    if (expected instanceof RegExp) return expected.test(String(actual || ''));
    return actual === expected;
  });
}

class FakeDocument {
  constructor(database, collectionName, id) {
    this.database = database;
    this.collectionName = collectionName;
    this.id = id;
  }

  async get() {
    const value = this.database.data[this.collectionName]?.[this.id];
    if (!value) {
      const error = new Error('DOCUMENT_NOT_EXIST');
      error.code = 'DOCUMENT_NOT_EXIST';
      throw error;
    }
    return { data: clone(value) };
  }

  async set({ data }) {
    this.database.ensureCollection(this.collectionName);
    this.database.data[this.collectionName][this.id] = clone(data);
    return { id: this.id };
  }

  async update({ data }) {
    this.database.ensureCollection(this.collectionName);
    const current = this.database.data[this.collectionName][this.id] || {};
    const next = { ...current };
    for (const [key, value] of Object.entries(data || {})) {
      next[key] = value && value.__increment
        ? Number(current[key] || 0) + value.value
        : clone(value);
    }
    this.database.data[this.collectionName][this.id] = next;
    return { updated: 1 };
  }
}

class FakeQuery {
  constructor(database, collectionName, query = {}) {
    this.database = database;
    this.collectionName = collectionName;
    this.query = query;
    this.offset = 0;
    this.maximum = Infinity;
    this.sortField = '';
    this.sortDirection = 'asc';
  }

  where(query) {
    return new FakeQuery(this.database, this.collectionName, query);
  }

  orderBy(field, direction) {
    this.sortField = field;
    this.sortDirection = direction;
    return this;
  }

  skip(value) {
    this.offset = Number(value || 0);
    return this;
  }

  limit(value) {
    this.maximum = Number(value || 0);
    return this;
  }

  async get() {
    this.database.ensureCollection(this.collectionName);
    let values = Object.entries(this.database.data[this.collectionName])
      .map(([id, value]) => ({ _id: id, ...clone(value) }))
      .filter((value) => matches(value, this.query));
    if (this.sortField) {
      const multiplier = this.sortDirection === 'desc' ? -1 : 1;
      values.sort((left, right) => {
        const a = left[this.sortField];
        const b = right[this.sortField];
        return a === b ? 0 : (a > b ? 1 : -1) * multiplier;
      });
    }
    values = values.slice(this.offset, this.offset + this.maximum);
    return { data: values };
  }
}

class FakeCollection extends FakeQuery {
  doc(id) {
    return new FakeDocument(this.database, this.collectionName, String(id));
  }

  async add({ data }) {
    this.database.ensureCollection(this.collectionName);
    const id = `${this.collectionName}-${++this.database.sequence}`;
    this.database.data[this.collectionName][id] = clone(data);
    return { _id: id };
  }
}

class FakeDatabase {
  constructor(seed = {}) {
    this.data = clone(seed);
    this.sequence = 0;
    this.command = {
      inc: (value) => ({ __increment: true, value: Number(value) })
    };
  }

  ensureCollection(name) {
    if (!this.data[name]) this.data[name] = {};
  }

  collection(name) {
    this.ensureCollection(name);
    return new FakeCollection(this, name);
  }

  async createCollection(name) {
    this.ensureCollection(name);
    const error = new Error('DATABASE_COLLECTION_ALREADY_EXISTS');
    error.code = 'DATABASE_COLLECTION_ALREADY_EXISTS';
    throw error;
  }

  async runTransaction(callback) {
    return callback({ collection: (name) => this.collection(name) });
  }

  serverDate() {
    return new Date();
  }

  RegExp({ regexp, options }) {
    return new RegExp(regexp, options);
  }
}

function authToken(subject) {
  const body = Buffer.from(JSON.stringify({ sub: subject, exp: Date.now() + 60_000 }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(body, 'utf8').digest('base64url');
  return `${body}.${signature}`;
}

function loadHandler(database) {
  const fakeCloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => database,
    getWXContext: () => ({}),
    getTempFileURL: async ({ fileList }) => ({
      fileList: fileList.map((fileID) => ({ fileID, tempFileURL: `https://temporary.example/${encodeURIComponent(fileID)}` }))
    }),
    uploadFile: async () => ({ fileID: 'cloud://test/uploaded.jpg' }),
    deleteFile: async () => ({})
  };
  const originalLoad = Module._load;
  const indexPath = require.resolve('../index');
  delete require.cache[indexPath];
  process.env.AUTH_TOKEN_SECRET = AUTH_SECRET;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') return fakeCloud;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../index').main;
  } finally {
    Module._load = originalLoad;
  }
}

test('handler enforces image redaction, claimant privacy, and two-stage claim completion', async () => {
  const database = new FakeDatabase({
    items: {
      protected: {
        _id: 'protected',
        type: 'found',
        status: 'active',
        category: '校园卡',
        title: '蓝色校园卡',
        ownerOpenid: 'owner',
        imageFileIds: ['cloud://private/card.jpg'],
        source: { platform: 'qq', groupId: 'private-group', messageIds: ['m1'], senderHash: 'private-hash' }
      }
    },
    claim_requests: {
      request1: {
        _id: 'request1',
        itemId: 'protected',
        ownerOpenid: 'owner',
        claimantOpenid: 'claimant',
        claimantName: '申领者',
        claimantContact: 'claimant@example.edu.cn',
        description: '白色卡套',
        status: 'pending_review',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    },
    comments: {},
    users: {
      ownerUser: { _id: 'ownerUser', actorId: 'owner', nickName: '发布者' },
      claimantUser: { _id: 'claimantUser', actorId: 'claimant', nickName: '申领者' }
    },
    notifications: {}
  });
  const handler = loadHandler(database);

  const outsiderDetail = await handler({
    action: 'getItemDetail',
    itemId: 'protected',
    authToken: authToken('outsider')
  });
  assert.equal(outsiderDetail.ok, true);
  assert.deepEqual(outsiderDetail.data.item.imageUrls, []);
  assert.equal('imageFileIds' in outsiderDetail.data.item, false);
  assert.equal(outsiderDetail.data.item.claimantName, '');
  assert.deepEqual(outsiderDetail.data.item.source, { platform: 'qq' });

  const review = await handler({
    action: 'reviewClaimRequest',
    requestId: 'request1',
    decision: 'approve',
    authToken: authToken('owner')
  });
  assert.equal(review.ok, true);
  assert.equal(review.data.request.status, 'approved_to_view');
  assert.equal(database.data.items.protected.status, 'active');

  const status = await handler({
    action: 'getClaimRequestStatus',
    requestId: 'request1',
    itemId: 'protected',
    authToken: authToken('claimant')
  });
  assert.equal(status.ok, true);
  assert.equal(status.data.status, 'verified');
  assert.ok(status.data.claimToken);

  const approvedDetail = await handler({
    action: 'getItemDetail',
    itemId: 'protected',
    authToken: authToken('claimant'),
    claimToken: status.data.claimToken
  });
  assert.equal(approvedDetail.ok, true);
  assert.equal(approvedDetail.data.item.claimImageLocked, false);
  assert.equal(approvedDetail.data.item.imageUrls.length, 1);
  assert.equal('imageFileIds' in approvedDetail.data.item, false);
  assert.deepEqual(approvedDetail.data.item.source, { platform: 'qq' });

  const completed = await handler({
    action: 'claimItem',
    itemId: 'protected',
    requestId: 'request1',
    claimToken: status.data.claimToken,
    claimantName: '申领者',
    authToken: authToken('claimant')
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.data.item.status, 'returned');
  assert.equal(completed.data.item.imageUrls.length, 1);
  assert.equal('imageFileIds' in completed.data.item, false);
  assert.deepEqual(completed.data.item.source, { platform: 'qq' });
  assert.equal(database.data.items.protected.status, 'returned');
  assert.equal(database.data.claim_requests.request1.status, 'completed');

  const postClaimOutsider = await handler({
    action: 'getItemDetail',
    itemId: 'protected',
    authToken: authToken('outsider')
  });
  assert.equal(postClaimOutsider.data.item.claimantName, '');
  assert.equal(postClaimOutsider.data.item.claimantContact, '');
  assert.deepEqual(postClaimOutsider.data.item.imageUrls, []);
});
