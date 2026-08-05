import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REGISTRANT_NAME_STATUSES,
  buildRegistrantNames,
  isVisibleRegistrant
} from '../shared/eventRegistrantNames.js';

// The member-visible "who else is coming" list. This projection is the whole
// privacy boundary: the registration documents behind it carry email, phone,
// amounts paid and Square transaction ids, and Firestore rules cannot project
// fields - which is why the derived collection exists rather than the
// registrations being made readable.

function registration(overrides = {}) {
  return {
    amountPaid: 42,
    email: 'ada@example.com',
    eventId: 'event-a',
    name: 'Ada Lovelace',
    phone: '(865) 555-1234',
    registrantFirstName: 'Ada',
    registrantLastName: 'Lovelace',
    squareTransactionId: 'sq-1',
    status: 'Registered',
    ...overrides
  };
}

test('Registered and Pending Payment are one undifferentiated list', () => {
  // Whether someone has settled up is financial information, and other members
  // have no business seeing it - so the two must not be distinguishable here.
  assert.deepEqual(REGISTRANT_NAME_STATUSES, ['Registered', 'Pending Payment']);
  assert.equal(isVisibleRegistrant(registration({ status: 'Registered' })), true);
  assert.equal(isVisibleRegistrant(registration({ status: 'Pending Payment' })), true);
});

test('a cancelled registration disappears', () => {
  assert.equal(isVisibleRegistrant(registration({ status: 'Cancelled' })), false);
  assert.deepEqual(
    buildRegistrantNames([registration({ status: 'Cancelled' })]),
    []
  );
});

test('a waitlisted member is not listed', () => {
  // A waitlist place is not attendance, and publishing it tells everyone who
  // missed out.
  assert.equal(isVisibleRegistrant(registration({ status: 'Waitlisted' })), false);
});

test('the list carries names and nothing else', () => {
  const names = buildRegistrantNames([registration()]);

  assert.deepEqual(names, ['Ada Lovelace']);
  // Belt and braces: the output is a flat string list, so there is no shape in
  // which an email or an amount could ride along.
  names.forEach((name) => assert.equal(typeof name, 'string'));
  assert.equal(JSON.stringify(names).includes('@'), false);
  assert.equal(JSON.stringify(names).includes('sq-1'), false);
});

test('names are sorted so the stored document does not churn', () => {
  const names = buildRegistrantNames([
    registration({ registrantFirstName: 'Zoe', registrantLastName: 'Zhang' }),
    registration({ registrantFirstName: 'Ada', registrantLastName: 'Lovelace' }),
    registration({ registrantFirstName: 'Mary', registrantLastName: 'Quilter' })
  ]);

  assert.deepEqual(names, ['Ada Lovelace', 'Mary Quilter', 'Zoe Zhang']);
});

test('the same person registered twice appears once', () => {
  assert.deepEqual(
    buildRegistrantNames([registration(), registration({ name: 'ada lovelace' })]),
    ['Ada Lovelace']
  );
});

test('a registration with no name is dropped rather than shown blank', () => {
  assert.deepEqual(
    buildRegistrantNames([
      registration({ name: '', registrantFirstName: '', registrantLastName: '' })
    ]),
    []
  );
});

test('an email is never used as a fallback name', () => {
  // The name chain deliberately stops before the email address.
  const names = buildRegistrantNames([
    registration({ name: '', registrantFirstName: '', registrantLastName: '' })
  ]);

  assert.deepEqual(names, []);
});

test('the full name field is used when first and last are missing', () => {
  assert.deepEqual(
    buildRegistrantNames([
      registration({ registrantFirstName: '', registrantLastName: '' })
    ]),
    ['Ada Lovelace']
  );
});

test('an empty registration list is an empty name list', () => {
  assert.deepEqual(buildRegistrantNames([]), []);
  assert.deepEqual(buildRegistrantNames(), []);
});
