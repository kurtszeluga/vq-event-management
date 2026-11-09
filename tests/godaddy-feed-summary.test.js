import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Same constraint as godaddy-feed-layout-switcher.test.js: the embed is a
// standalone IIFE served as a static asset and touches `document` the moment it
// runs, so nothing in it can be imported. Lift the pure helpers out of the
// source and compile those instead.

const SOURCE = readFileSync(new URL('../public/godaddy-event-feed.js', import.meta.url), 'utf8');

function extractBlock(startPattern, closer) {
  const start = SOURCE.indexOf(startPattern);

  assert.notEqual(start, -1, `expected to find ${startPattern} in the embed`);

  const end = SOURCE.indexOf(closer, start);

  assert.notEqual(end, -1, `expected ${startPattern} to be closed`);

  return SOURCE.slice(start, end + closer.length);
}

const parseTemplate = new Function(`
  const SUMMARY_TEMPLATE = 'summary';
  const DEFAULTS = { template: '' };
  ${extractBlock('function parseTemplate(', '\n  }')}
  return parseTemplate;
`)();

const buildSummaryRowMarkup = new Function(`
  const SUMMARY_TEMPLATE = 'summary';
  const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  ${extractBlock('function escapeHtml(', '\n  }')}
  ${extractBlock('function escapeAttribute(', '\n  }')}
  ${extractBlock('function formatEventDate(', '\n  }')}
  ${extractBlock('function hasDateRange(', '\n  }')}
  ${extractBlock('function formatEventDateRange(', '\n  }')}
  ${extractBlock('function parseDateParts(', '\n  }')}
  ${extractBlock('function buildDateStackMarkup(', '\n  }')}
  ${extractBlock('function buildSummaryRowMarkup(', '\n  }')}
  return buildSummaryRowMarkup;
`)();

const EVENT = {
  date: '2026-11-13',
  detailUrl: 'https://events.villagequilters.com/events/abc123',
  eventType: 'Lecture',
  title: 'Protecting Precious Quilts'
};

test('only "summary" selects the summary rows', () => {
  assert.equal(parseTemplate('summary'), 'summary');
  assert.equal(parseTemplate('SUMMARY'), 'summary');
  assert.equal(parseTemplate(' summary '), 'summary');
});

test('anything else falls back to the normal per-type cards', () => {
  // A typo, or a card template name, must render the ordinary cards rather
  // than an empty list.
  ['', 'summarise', 'event', 'business', 'forsale', undefined, null].forEach((value) => {
    assert.equal(parseTemplate(value), '', `${String(value)} should not select summary`);
  });
});

test('a row carries exactly the date, the type and the title', () => {
  const markup = buildSummaryRowMarkup(EVENT);

  // The date arrives as the shared tile, so it reads as month/day/year parts.
  assert.match(markup, /vq-feed-datestack-month">NOV</);
  assert.match(markup, /vq-feed-datestack-day">13</);
  assert.match(markup, /vq-feed-datestack-year">2026</);
  assert.match(markup, /vq-feed-type">Lecture</);
  assert.match(markup, /vq-feed-summary-title">Protecting Precious Quilts</);
  // Nothing from the full card should have come along for the ride.
  assert.equal(markup.includes('vq-feed-media'), false);
  assert.equal(markup.includes('vq-feed-seat'), false);
  assert.equal(markup.includes('vq-feed-register'), false);
});

test('the date tile and type pill are the cards\' own, not a second vocabulary', () => {
  // Shared classes are the point - a reader moving from the home page to a
  // listing page should recognise both. If these are ever renamed here, the
  // summary silently loses its styling.
  const markup = buildSummaryRowMarkup(EVENT);

  assert.match(markup, /class="vq-feed-datestack"/);
  assert.match(markup, /class="vq-feed-type"/);
});

test('the row keeps the hooks the filter and the empty notice rely on', () => {
  // applyActiveView collects .vq-feed-card and filters on data-event-type; the
  // empty notice is driven off the same collection. A row that dropped either
  // would break both without touching the summary itself.
  const markup = buildSummaryRowMarkup(EVENT);

  assert.match(markup, /class="vq-feed-card"/);
  assert.match(markup, /data-event-type="Lecture"/);
  assert.match(markup, /data-template="summary"/);
});

test('the date renders as plain text, never a day early', () => {
  // The whole reason parseDateParts exists - see godaddy-feed-date-format.
  const markup = buildSummaryRowMarkup({ ...EVENT, date: '2026-01-01' });

  assert.match(markup, /vq-feed-datestack-month">JAN</);
  assert.match(markup, /vq-feed-datestack-day">1</);
});

test('a multi-day event shows its span', () => {
  // The tile carries the start, as it does on a card; the end goes beside the
  // type so the row still reads as one line.
  const markup = buildSummaryRowMarkup({
    ...EVENT,
    date: '2027-02-11',
    endDate: '2027-02-13',
    eventType: 'Retreat'
  });

  assert.match(markup, /vq-feed-datestack-day">11</);
  assert.match(markup, /vq-feed-summary-span">through 02\/13\/2027</);
});

test('an endDate equal to the start is not rendered as a span', () => {
  const markup = buildSummaryRowMarkup({ ...EVENT, endDate: '2026-11-13' });

  assert.equal(markup.includes('vq-feed-summary-span'), false);
});

test('a missing date falls back to the tile\'s TBD state', () => {
  // This is the Challenge case - a Challenge does not require a date.
  const markup = buildSummaryRowMarkup({ ...EVENT, date: '' });

  assert.match(markup, /vq-feed-datestack is-tbd/);
  assert.match(markup, /TBD</);
});

test('a row is not a link at all', () => {
  // Removed on request: readers reach an event through the site's own
  // navigation. The anchor, the chevron and the hover state went together -
  // an affordance left behind promises a click that no longer happens.
  const markup = buildSummaryRowMarkup(EVENT);

  assert.equal(markup.includes('<a '), false);
  assert.equal(markup.includes('href'), false);
  assert.equal(markup.includes('target="_blank"'), false);
  assert.equal(markup.includes('vq-feed-summary-chevron'), false);
  assert.match(markup, /<div class="vq-feed-card"/);
});

test('a detailUrl in the payload is ignored rather than rendered', () => {
  // The feed still publishes detailUrl for anything else that wants it; the
  // summary simply does not use it.
  const markup = buildSummaryRowMarkup(EVENT);

  assert.equal(markup.includes(EVENT.detailUrl), false);
});

test('a title with markup in it is escaped, not rendered', () => {
  const markup = buildSummaryRowMarkup({
    ...EVENT,
    title: '<img src=x onerror="alert(1)">'
  });

  assert.equal(markup.includes('<img'), false);
  assert.match(markup, /&lt;img/);
});

test('a hostile detail URL reaches no attribute at all', () => {
  // Previously this guarded the href. With no link, the URL is never written
  // into the markup - which is a stronger guarantee, so the test follows it.
  const markup = buildSummaryRowMarkup({
    ...EVENT,
    detailUrl: 'https://example.com/" onmouseover="alert(1)'
  });

  assert.equal(markup.includes('onmouseover'), false);
  assert.equal(markup.includes('example.com'), false);
});

test('an untitled event still renders a row', () => {
  assert.match(buildSummaryRowMarkup({ ...EVENT, title: '' }), /Listing/);
});

test('the summary view is kept out of the pill list', () => {
  // Adding it to FEED_VIEWS would make it a pill, and would also put it in the
  // default list parseViewList falls back to - so every embed without
  // data-categories would grow a sixth pill on the next deploy.
  const feedViews = extractBlock('const FEED_VIEWS = [', '];');

  assert.equal(feedViews.includes('summary'), false);
  assert.equal(feedViews.includes('allevents'), false);
});

test('the summary view asks the API for the allevents category', () => {
  const summaryView = extractBlock('const SUMMARY_VIEW = {', '\n  };');

  assert.match(summaryView, /category: 'allevents'/);
});

test('summary is not offered as a layout', () => {
  // Layouts are a pure CSS class swap with no re-render, which the switcher
  // relies on. Summary needs different markup, so a switcher button for it
  // would swap the class and leave the full cards in place.
  const layouts = extractBlock('const LAYOUTS = [', '];');

  assert.equal(layouts.includes('summary'), false);
});
