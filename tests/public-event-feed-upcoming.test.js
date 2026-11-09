import assert from 'node:assert/strict';
import test from 'node:test';
import { getFeedCategory, getGuildToday, isUpcomingEvent } from '../api/_lib/public-event-feed.js';

// The `upcoming` feed category backs the home page summary embed. It differs
// from every other category in two ways worth pinning: it spans Challenges as
// well as the dated event types, and it is the only one that filters on the
// event date at all.

test('upcoming is a real category rather than falling back to events', () => {
  assert.equal(getFeedCategory('upcoming'), 'upcoming');
  // The fallback is still intact for anything unrecognised.
  assert.equal(getFeedCategory('nonsense'), 'events');
  assert.equal(getFeedCategory(''), 'events');
});

test('a past event is dropped', () => {
  assert.equal(isUpcomingEvent({ date: '2026-11-08' }, '2026-11-09'), false);
});

test("today's event is kept", () => {
  // An event happening this evening must not disappear from the home page
  // during the day it runs.
  assert.equal(isUpcomingEvent({ date: '2026-11-09' }, '2026-11-09'), true);
});

test('a future event is kept', () => {
  assert.equal(isUpcomingEvent({ date: '2027-05-13' }, '2026-11-09'), true);
});

test('a multi-day event is kept until its end date passes', () => {
  // A retreat must not vanish on its second morning.
  const retreat = { date: '2026-11-06', endDate: '2026-11-12' };

  assert.equal(isUpcomingEvent(retreat, '2026-11-09'), true, 'mid-retreat');
  assert.equal(isUpcomingEvent(retreat, '2026-11-12'), true, 'final day');
  assert.equal(isUpcomingEvent(retreat, '2026-11-13'), false, 'the day after');
});

test('a date carrying a time still compares on the date alone', () => {
  assert.equal(isUpcomingEvent({ date: '2026-11-09T19:00' }, '2026-11-09'), true);
  assert.equal(isUpcomingEvent({ date: '2026-11-08T19:00' }, '2026-11-09'), false);
});

test('an event with no usable date is kept rather than hidden', () => {
  // The dateless types are excluded by category, so a dated type with an empty
  // or malformed date is a data problem - it should stay visible to whoever
  // can fix it rather than silently disappear from the home page.
  assert.equal(isUpcomingEvent({}, '2026-11-09'), true);
  assert.equal(isUpcomingEvent({ date: '' }, '2026-11-09'), true);
  assert.equal(isUpcomingEvent({ date: 'next spring' }, '2026-11-09'), true);
});

test('the comparison is plain text, so it cannot drift a day like Date would', () => {
  // The bug this avoids: new Date('2026-11-09') is UTC midnight, which reads as
  // Nov 8 anywhere behind UTC. A string compare has no timezone at all.
  assert.equal(isUpcomingEvent({ date: '2026-11-09' }, '2026-11-09'), true);
  assert.equal(
    new Date('2026-11-09').getTime() < new Date('2026-11-09T00:00').getTime(),
    true,
    'if this ever stops being true, Date no longer reads a bare ISO date as UTC'
  );
});

test('today is read in guild time, not the server UTC clock', () => {
  // A Vercel function runs in UTC. At 8pm Eastern on Nov 9 it is already Nov 10
  // in UTC, so a UTC "today" would drop that evening's event while members are
  // still at it.
  const eveningInEastern = new Date('2026-11-10T01:00:00Z');

  assert.equal(getGuildToday(eveningInEastern), '2026-11-09');
  assert.equal(eveningInEastern.toISOString().slice(0, 10), '2026-11-10');
});

test('guild today is zero-padded ISO regardless of locale ordering', () => {
  // Built from parts rather than a format string precisely so no locale can
  // reorder it into something a string compare would mis-sort.
  assert.match(getGuildToday(new Date('2026-01-05T17:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(getGuildToday(new Date('2026-01-05T17:00:00Z')), '2026-01-05');
});
