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

test('the feed publishes an absolute default placeholder image for a type that has one', () => {
  const feedEvent = serializeEvent({ ...BASE_EVENT }, 'https://example.com');

  assert.equal(feedEvent.placeholderImageUrl, 'https://example.com/assets/event-placeholders/workshop.svg');
});

test('the placeholder URL is absolute even when the origin has a trailing slash', () => {
  const feedEvent = serializeEvent({ ...BASE_EVENT }, 'https://example.com/');

  assert.equal(feedEvent.placeholderImageUrl, 'https://example.com/assets/event-placeholders/workshop.svg');
});

test('a business listing takes the placeholder for its business type', () => {
  const longarmEvent = serializeEvent(
    { ...BASE_EVENT, eventType: 'Business Listing', businessType: 'longarm-quilters' },
    'https://example.com'
  );

  assert.equal(
    longarmEvent.placeholderImageUrl,
    'https://example.com/assets/event-placeholders/business-longarm-quilters.svg'
  );
});

test('a business listing with no type, or a type configured beyond the built-ins, falls back to the generic block', () => {
  const untypedEvent = serializeEvent({ ...BASE_EVENT, eventType: 'Business Listing' }, 'https://example.com');
  const customTypeEvent = serializeEvent(
    { ...BASE_EVENT, eventType: 'Business Listing', businessType: 'added-in-configuration' },
    'https://example.com'
  );

  assert.equal(
    untypedEvent.placeholderImageUrl,
    'https://example.com/assets/event-placeholders/business-listing.svg'
  );
  assert.equal(
    customTypeEvent.placeholderImageUrl,
    'https://example.com/assets/event-placeholders/business-listing.svg'
  );
});

// A for-sale item is nearly always photographed, and a decorative stand-in
// would misrepresent what is actually being sold.
test('For Sale still has no default placeholder image', () => {
  const forSaleEvent = serializeEvent({ ...BASE_EVENT, eventType: 'For Sale' }, 'https://example.com');

  assert.equal(forSaleEvent.placeholderImageUrl, '');
});

test('cashCheckOnly passes through the feed so the GoDaddy widget can suppress online payment messaging', () => {
  const cashCheckOnlyEvent = serializeEvent(
    { ...BASE_EVENT, cashCheckOnly: true, cost: 25, isPaid: true },
    'https://example.com'
  );
  const onlineEvent = serializeEvent(
    { ...BASE_EVENT, cashCheckOnly: false, cost: 25, isPaid: true },
    'https://example.com'
  );

  assert.equal(cashCheckOnlyEvent.cashCheckOnly, true);
  assert.equal(onlineEvent.cashCheckOnly, false);
});
