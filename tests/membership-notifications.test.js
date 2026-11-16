import assert from 'node:assert/strict';
import test from 'node:test';
import { getEmailInstructionArea } from '../api/create-registration.js';
import {
  getEmailInstructionArea as getPaymentEmailArea,
  hasEventDate
} from '../api/admin-update-registration-payment.js';

test('a membership signup routes to the Membership coordinator, not Programs', () => {
  // Both areas were configured before the event type existed, and the
  // coordinator one already named 'Membership' in coveredTypes. Falling
  // through to Programs left both of them unreachable: the guild could fill in
  // a Membership instruction box and assign a Membership coordinator, and
  // neither would ever be used.
  assert.deepEqual(getEmailInstructionArea('Membership'), {
    areaId: 'membership',
    areaLabel: 'Membership'
  });
  assert.deepEqual(getPaymentEmailArea('Membership'), {
    areaId: 'membership',
    areaLabel: 'Membership'
  });
});

test('every other type keeps the area it already had', () => {
  const unchanged = {
    'Class (Half Day)': 'programs',
    'Class (Full Day)': 'programs',
    Lecture: 'programs',
    Retreat: 'programs',
    Workshop: 'workshops',
    Challenges: 'challenges',
    Other: 'programs'
  };

  for (const [eventType, areaId] of Object.entries(unchanged)) {
    assert.equal(getEmailInstructionArea(eventType).areaId, areaId, eventType);
    assert.equal(getPaymentEmailArea(eventType).areaId, areaId, eventType);
  }
});

test('a payment email prints no event date for a membership registration', () => {
  // Otherwise the receipt says "Event Date: Date TBD" for a signup that never
  // had one, which reads as missing information rather than a type that has
  // no date to give.
  assert.equal(hasEventDate({ eventType: 'Membership' }), false);
  assert.equal(hasEventDate({ eventType: 'Challenges' }), false);
  assert.equal(hasEventDate({ eventType: 'Workshop' }), true);
  assert.equal(hasEventDate({ eventType: 'Class (Half Day)' }), true);
});
