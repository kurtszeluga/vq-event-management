import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeEvent } from '../api/_lib/public-event-feed.js';

const BASE_EVENT = {
  capacity: 20,
  capacityUnlimited: false,
  date: '2026-08-01',
  eventType: 'Workshop',
  registrationMode: 'none',
  status: 'Published',
  title: 'Test Workshop'
};

test('the GoDaddy feed exposes the full image set and a count alongside the legacy single imageUrl', () => {
  const feedEvent = serializeEvent(
    { ...BASE_EVENT, imageUrls: ['a.jpg', '', 'b.jpg', 'c.jpg'] },
    'https://example.com'
  );

  assert.equal(feedEvent.imageUrl, 'a.jpg');
  assert.deepEqual(feedEvent.imageUrls, ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.equal(feedEvent.imageCount, 3);
});

test('an event with no images reports an empty array and a zero count', () => {
  const feedEvent = serializeEvent({ ...BASE_EVENT }, 'https://example.com');

  assert.equal(feedEvent.imageUrl, '');
  assert.deepEqual(feedEvent.imageUrls, []);
  assert.equal(feedEvent.imageCount, 0);
});
