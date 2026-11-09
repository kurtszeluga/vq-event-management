import assert from 'node:assert/strict';
import test from 'node:test';
import { getFeedCategory, orderSummaryEvents } from '../api/_lib/public-event-feed.js';

// The `allevents` feed category backs the home page summary embed. It differs
// from every other category in two ways worth pinning: it spans Challenges as
// well as the other event types, and it moves Challenges to the end.
//
// It applies no date filter, by instruction. The summary lists what is
// published; an event leaves it by being archived, which drops it from the
// status filter the query already applies.

const CHALLENGE = { eventType: 'Challenges', title: 'Create A Christmas Stocking' };
const LECTURE = { date: '2026-11-13', eventType: 'Lecture', title: 'Protecting Precious Quilts' };
const WORKSHOP = { date: '2026-11-19', eventType: 'Workshop', title: 'Free Motion Quilting' };

test('allevents is a real category rather than falling back to events', () => {
  assert.equal(getFeedCategory('allevents'), 'allevents');
  assert.equal(getFeedCategory('nonsense'), 'events');
  assert.equal(getFeedCategory(''), 'events');
});

test('an undated Challenge is moved to the end rather than leading the list', () => {
  // The bug this guards: a Challenge does not require a date (requiresDate in
  // EventForm.jsx is requiresSchedule && !isChallenge), and Firestore sorts an
  // empty date before every real one - so left alone the undated Challenges
  // lead the home page as "Date TBD" above the next actual event.
  const ordered = orderSummaryEvents([CHALLENGE, LECTURE, WORKSHOP], { challengesLast: true });

  assert.deepEqual(ordered.map((event) => event.eventType), ['Lecture', 'Workshop', 'Challenges']);
});

test('a dated Challenge goes to the end too', () => {
  // "Challenges at the end" is the instruction, not "undated ones at the end".
  const dated = { ...CHALLENGE, date: '2026-11-01' };
  const ordered = orderSummaryEvents([dated, LECTURE], { challengesLast: true });

  assert.deepEqual(ordered.map((event) => event.eventType), ['Lecture', 'Challenges']);
});

test('everything else keeps the order it arrived in', () => {
  // The query already sorts by date ascending, so the reorder must be stable -
  // it may only move Challenges, never resequence the rest.
  const ordered = orderSummaryEvents([LECTURE, WORKSHOP, CHALLENGE], { challengesLast: true });

  assert.deepEqual(
    ordered.map((event) => event.title),
    ['Protecting Precious Quilts', 'Free Motion Quilting', 'Create A Christmas Stocking']
  );
});

test('several Challenges keep their relative order at the end', () => {
  const first = { ...CHALLENGE, title: 'Great American Birthday Bash' };
  const second = { ...CHALLENGE, title: 'Create A Christmas Stocking' };
  const ordered = orderSummaryEvents([first, LECTURE, second], { challengesLast: true });

  assert.deepEqual(
    ordered.map((event) => event.title),
    ['Protecting Precious Quilts', 'Great American Birthday Bash', 'Create A Christmas Stocking']
  );
});

test('a list of only Challenges still renders in order', () => {
  const first = { ...CHALLENGE, title: 'One' };
  const second = { ...CHALLENGE, title: 'Two' };

  assert.deepEqual(
    orderSummaryEvents([first, second], { challengesLast: true }).map((event) => event.title),
    ['One', 'Two']
  );
});

test('a list with no Challenges is untouched', () => {
  const ordered = orderSummaryEvents([LECTURE, WORKSHOP], { challengesLast: true });

  assert.deepEqual(ordered.map((event) => event.title), [LECTURE.title, WORKSHOP.title]);
});

test('every other category is left exactly as the query ordered it', () => {
  // challengesLast is opt-in, so the per-type pages cannot be resequenced by
  // this. The Challenges page itself lists Challenges and must not move them.
  const events = [CHALLENGE, LECTURE, WORKSHOP];

  assert.deepEqual(orderSummaryEvents(events, {}), events);
  assert.deepEqual(orderSummaryEvents(events), events);
  assert.deepEqual(orderSummaryEvents(events, { challengesLast: false }), events);
});

test('an empty feed is handled without special-casing', () => {
  assert.deepEqual(orderSummaryEvents([], { challengesLast: true }), []);
});

test('a past event is kept, because only archiving removes one', () => {
  // No date cutoff by instruction - this pins that decision so a future change
  // has to be deliberate rather than incidental.
  const past = { date: '2020-01-01', eventType: 'Lecture', title: 'Long Ago' };
  const ordered = orderSummaryEvents([past, LECTURE], { challengesLast: true });

  assert.equal(ordered.length, 2);
  assert.equal(ordered[0].title, 'Long Ago');
});
