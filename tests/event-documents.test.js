import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventDocument, listEventDocuments } from '../shared/eventDocuments.js';
import { serializeEvent } from '../api/_lib/public-event-feed.js';

const CHALLENGE = {
  id: 'c1',
  eventType: 'Challenges',
  title: 'Four Patch Reimagined',
  documentUrl: 'https://files.example.org/flyer.pdf',
  documentTitle: 'Challenge Flyer',
  documentFileName: 'four-patch-flyer.pdf',
  supplyListUrl: 'https://files.example.org/supplies.pdf',
  supplyListTitle: 'What To Bring',
  supplyListFileName: 'supplies.pdf'
};

test('a challenge carrying both PDFs lists both, supply list first', () => {
  const documents = listEventDocuments(CHALLENGE);

  assert.deepEqual(documents.map((d) => d.kind), ['supply-list', 'challenge-pdf']);
  assert.deepEqual(documents.map((d) => d.title), ['What To Bring', 'Challenge Flyer']);
});

test('an event with only a supply list lists only that one', () => {
  const documents = listEventDocuments({ ...CHALLENGE, documentUrl: '', documentTitle: '' });

  assert.equal(documents.length, 1);
  assert.equal(documents[0].kind, 'supply-list');
});

test('an event with no PDFs lists none', () => {
  assert.deepEqual(listEventDocuments({ id: 'x', eventType: 'Workshop' }), []);
});

test('an untitled document falls back rather than rendering a blank link', () => {
  const document = getEventDocument(
    { documentUrl: 'https://files.example.org/f.pdf' },
    'challenge-pdf'
  );

  assert.equal(document.title, 'Challenge PDF');
  assert.equal(document.fileName, 'Challenge PDF.pdf');
});

test('the feed serializes both documents with distinct viewer routes', () => {
  const feedEvent = serializeEvent({ ...CHALLENGE }, 'https://example.com');
  const byKind = Object.fromEntries(feedEvent.documents.map((d) => [d.kind, d]));

  assert.equal(byKind['supply-list'].viewerUrl, 'https://example.com/events/c1/supply-list');
  assert.equal(byKind['challenge-pdf'].viewerUrl, 'https://example.com/events/c1/challenge-pdf');
  assert.match(byKind['challenge-pdf'].downloadUrl, /disposition=attachment/);
});

// The supplyList* fields predate `documents` and older embeds still read them.
test('the existing supplyList fields keep working alongside documents', () => {
  const feedEvent = serializeEvent({ ...CHALLENGE }, 'https://example.com');

  assert.equal(feedEvent.supplyListViewerUrl, 'https://example.com/events/c1/supply-list');
  assert.equal(feedEvent.supplyListTitle, 'What To Bring');
});
