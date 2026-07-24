import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceRateLimit, getClientRateLimitKey } from '../api/_lib/rate-limit.js';

test('client rate limit key uses forwarded address before socket fallback', () => {
  assert.equal(getClientRateLimitKey({
    headers: {
      'x-forwarded-for': '203.0.113.10, 198.51.100.4',
      'x-real-ip': '198.51.100.10'
    },
    socket: { remoteAddress: '127.0.0.1' }
  }), '203.0.113.10');

  assert.equal(getClientRateLimitKey({
    headers: {},
    socket: { remoteAddress: '127.0.0.1' }
  }), '127.0.0.1');
});

test('enforceRateLimit blocks requests after the configured window limit', async () => {
  const db = createMemoryDb();
  const request = {
    headers: { 'x-forwarded-for': '203.0.113.20' },
    socket: {}
  };

  await enforceRateLimit(db, {
    keyParts: ['member@example.com', 'event-a'],
    limit: 2,
    request,
    scope: 'test-registration-submit',
    windowMs: 60 * 1000
  });
  await enforceRateLimit(db, {
    keyParts: ['member@example.com', 'event-a'],
    limit: 2,
    request,
    scope: 'test-registration-submit',
    windowMs: 60 * 1000
  });

  await assert.rejects(
    () => enforceRateLimit(db, {
      keyParts: ['member@example.com', 'event-a'],
      limit: 2,
      request,
      scope: 'test-registration-submit',
      windowMs: 60 * 1000
    }),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.ok(error.retryAfterSeconds > 0);
      return true;
    }
  );
});

function createMemoryDb() {
  const store = new Map();

  return {
    collection(collectionName) {
      return {
        doc(documentId) {
          return { collectionName, documentId };
        }
      };
    },
    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          const key = `${ref.collectionName}/${ref.documentId}`;
          const data = store.get(key);

          return {
            data: () => data,
            exists: Boolean(data)
          };
        },
        set(ref, value, options = {}) {
          const key = `${ref.collectionName}/${ref.documentId}`;
          const current = options.merge ? store.get(key) || {} : {};

          store.set(key, { ...current, ...value });
        }
      };

      return callback(transaction);
    }
  };
}
