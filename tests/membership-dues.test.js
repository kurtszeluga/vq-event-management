import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MEMBERSHIP_FEE_SCHEDULE,
  formatMonthDay,
  getDayBefore,
  getEventCostOn,
  getMembershipFeeOn,
  getMembershipRateName,
  isMembershipEvent,
  normalizeMembershipFeeSchedule,
  readMembershipFeeSchedule,
  toMembershipDuesSettings
} from '../shared/membershipDues.js';
import {
  getMembershipAnswerErrors,
  sanitizeMembershipAnswers
} from '../shared/membershipQuestions.js';

const SCHEDULE = DEFAULT_MEMBERSHIP_FEE_SCHEDULE;

// Noon Eastern, so the guild's day and UTC's day agree and the test is about
// the boundary rule rather than about the timezone. The timezone gets its own
// test below.
function guildNoon(month, day, year = 2026) {
  return Date.UTC(year, month - 1, day, 17, 0, 0);
}

const MEMBERSHIP_EVENT = {
  cost: 50,
  eventType: 'Membership',
  isPaid: true,
  membershipFeeSchedule: SCHEDULE,
  serviceFee: 1
};

test('the two rates tile the whole year with no gap and no overlap', () => {
  // Every day of a leap year gets exactly one rate - the property that makes
  // "two starts" the right shape for this rule rather than two ranges.
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= 31; day += 1) {
      const now = Date.UTC(2024, month - 1, day, 17, 0, 0);

      if (new Date(now).getUTCMonth() + 1 !== month) {
        continue;
      }

      const rate = getMembershipRateName(SCHEDULE, { now });

      assert.ok(['early', 'regular'].includes(rate), `${month}-${day} priced as ${rate}`);
    }
  }
});

test('each rate starts on its own start date and runs to the day before the other', () => {
  const cases = [
    [6, 30, 50, 'the day before the early window opens is still the regular rate'],
    [7, 1, 25, 'the early window opens on its start date, not the day after'],
    [8, 15, 25, 'mid-window'],
    [9, 30, 25, 'the last early day is the day before the regular window opens'],
    [10, 1, 50, 'the regular window opens on its start date'],
    [12, 31, 50, 'the regular window carries across New Year'],
    [1, 1, 50, 'and is still running on the other side of it']
  ];

  for (const [month, day, expected, reason] of cases) {
    assert.equal(
      getMembershipFeeOn(SCHEDULE, { now: guildNoon(month, day) }),
      expected,
      `${month}/${day}: ${reason}`
    );
  }
});

test('the date is read in the guild timezone, not the server timezone', () => {
  // 02:00 UTC on Jul 1 is 22:00 Eastern on Jun 30. Vercel runs in UTC, so
  // without pinning the zone this instant prices as the early rate while the
  // member's own calendar still says June - a 25 dollar charge on a 50 dollar
  // day, four hours early, once a year.
  const lateEveningJune30 = Date.UTC(2026, 6, 1, 2, 0, 0);

  assert.equal(getMembershipFeeOn(SCHEDULE, { now: lateEveningJune30 }), 50);

  // And the mirror: 22:00 Eastern on Sep 30 is Oct 1 in UTC.
  const lateEveningSeptember30 = Date.UTC(2026, 9, 1, 2, 0, 0);

  assert.equal(getMembershipFeeOn(SCHEDULE, { now: lateEveningSeptember30 }), 25);
});

test('a wrapped early window works the same way round', () => {
  // The guild could put the cheaper window across New Year instead. Nothing in
  // the rule prefers one direction, so this is the same two comparisons with
  // the starts swapped.
  const wrapped = {
    earlyFee: 10,
    earlyStart: '11-01',
    regularFee: 20,
    regularStart: '03-01'
  };

  assert.equal(getMembershipFeeOn(wrapped, { now: guildNoon(11, 1) }), 10);
  assert.equal(getMembershipFeeOn(wrapped, { now: guildNoon(1, 15) }), 10);
  assert.equal(getMembershipFeeOn(wrapped, { now: guildNoon(2, 28) }), 10);
  assert.equal(getMembershipFeeOn(wrapped, { now: guildNoon(3, 1) }), 20);
  assert.equal(getMembershipFeeOn(wrapped, { now: guildNoon(10, 31) }), 20);
});

test('a malformed or missing schedule prices at the defaults, never at zero', () => {
  // The failure that matters: a membership event whose schedule did not save
  // properly must not become free. isPaidEvent is `cost > 0`, so a zero here
  // would publish a signup that charges nothing and takes no payment.
  for (const broken of [undefined, null, {}, { earlyStart: '7/1' }, { earlyFee: 'free' }]) {
    assert.equal(getMembershipFeeOn(broken, { now: guildNoon(8, 1) }), 25);
    assert.equal(getMembershipFeeOn(broken, { now: guildNoon(1, 1) }), 50);
  }

  assert.deepEqual(normalizeMembershipFeeSchedule({ earlyFee: -5 }), SCHEDULE);
});

test('two rates starting on the same day charge the regular rate rather than guess', () => {
  const ambiguous = { earlyFee: 25, earlyStart: '07-01', regularFee: 50, regularStart: '07-01' };

  assert.equal(getMembershipFeeOn(ambiguous, { now: guildNoon(7, 1) }), 50);
  assert.equal(getMembershipFeeOn(ambiguous, { now: guildNoon(12, 25) }), 50);
});

test('getEventCostOn leaves every other event type exactly as it was', () => {
  const classEvent = { cost: 35, eventType: 'Class (Half Day)', isPaid: true };

  assert.equal(getEventCostOn(classEvent, { now: guildNoon(7, 15) }), 35);
  assert.equal(getEventCostOn(classEvent, { now: guildNoon(1, 15) }), 35);
  // Including one carrying a stray schedule, which a type switch leaves behind
  // as null but an older record might carry as an object.
  assert.equal(
    getEventCostOn({ ...classEvent, membershipFeeSchedule: SCHEDULE }, { now: guildNoon(7, 15) }),
    35
  );
  assert.equal(getEventCostOn({ eventType: 'Other' }), 0);
  assert.equal(getEventCostOn(null), 0);
});

test('a membership event is priced by the day, including its service fee', () => {
  assert.ok(isMembershipEvent(MEMBERSHIP_EVENT));
  assert.equal(getEventCostOn(MEMBERSHIP_EVENT, { now: guildNoon(8, 1) }), 25);
  assert.equal(getEventCostOn(MEMBERSHIP_EVENT, { now: guildNoon(11, 1) }), 50);
});

test('the stored cost is the higher rate, so a reader that misses the helper overquotes', () => {
  // buildEventPayload stores regularFee in `cost`. The point of choosing the
  // higher of the two is that the wrong answer is visible and complained
  // about, rather than quietly undercharging.
  assert.equal(MEMBERSHIP_EVENT.cost, SCHEDULE.regularFee);
  assert.ok(MEMBERSHIP_EVENT.cost >= SCHEDULE.earlyFee);
});

test('the flat settings shape and the nested schedule shape round-trip', () => {
  const settings = {
    membershipEarlyFee: 30,
    membershipEarlyStart: '06-01',
    membershipRegularFee: 60,
    membershipRegularStart: '09-01'
  };

  assert.deepEqual(readMembershipFeeSchedule(settings), {
    earlyFee: 30,
    earlyStart: '06-01',
    regularFee: 60,
    regularStart: '09-01'
  });
  assert.deepEqual(toMembershipDuesSettings(settings), settings);
});

test('month-day values render for an admin and step back a day correctly', () => {
  assert.equal(formatMonthDay('07-01'), 'Jul 1');
  assert.equal(formatMonthDay('10-01'), 'Oct 1');
  assert.equal(formatMonthDay('nonsense'), '');
  assert.equal(getDayBefore('10-01'), '09-30');
  assert.equal(getDayBefore('07-01'), '06-30');
  assert.equal(getDayBefore('01-01'), '12-31');
  // A leap year is used for the arithmetic so Mar 1 steps back to Feb 29
  // rather than skipping it.
  assert.equal(getDayBefore('03-01'), '02-29');
});

test('the membership answers accept only the offered choices', () => {
  assert.deepEqual(
    sanitizeMembershipAnswers({
      phoneType: 'cell',
      renewalType: 'renewing',
      skills: '  Longarm quilting  ',
      veteran: 'yes'
    }),
    {
      membershipPhoneType: 'cell',
      membershipRenewalType: 'renewing',
      membershipSkills: 'Longarm quilting',
      membershipVeteran: 'yes'
    }
  );

  // Anything off the list becomes '', not the value as typed - these are
  // dropdown answers, so a value outside the list can only be a tampered
  // request.
  const tampered = sanitizeMembershipAnswers({
    phoneType: 'satellite',
    renewalType: 'lifetime',
    veteran: 'maybe'
  });

  assert.equal(tampered.membershipPhoneType, '');
  assert.equal(tampered.membershipRenewalType, '');
  assert.equal(tampered.membershipVeteran, '');
});

test('the skills answer is optional and length-capped; the other three are required', () => {
  const complete = { phoneType: 'home', renewalType: 'new', veteran: 'no' };

  assert.deepEqual(getMembershipAnswerErrors(complete), {});

  const missing = getMembershipAnswerErrors({});

  assert.deepEqual(Object.keys(missing).sort(), [
    'membershipPhoneType',
    'membershipRenewalType',
    'membershipVeteran'
  ]);

  const long = sanitizeMembershipAnswers({ skills: 'q'.repeat(5000) });

  assert.equal(long.membershipSkills.length, 1500);
});
