import assert from 'node:assert/strict';
import test from 'node:test';
import { sendRefundCoordinatorEmail } from '../api/admin-update-registration-payment.js';

// Asked for on 2026-11-21: "when a refund is issued the admin should get a
// notification." Until now the refund email went to the MEMBER only - the
// coordinator appeared in it as the reply-to address and as a contact block,
// so the person running an area could be told about every arrival and never
// hear about a departure.

const ACTOR = { email: 'super@villagequilters.com', name: 'Kurt Szeluga', role: 'Super User' };
const REGISTRATION = {
  amountPaid: 45,
  email: 'member@example.com',
  eventDate: '2026-12-11',
  eventId: 'event-1',
  eventTitle: 'December Workshop',
  eventType: 'Workshop',
  name: 'Ada Lovelace',
  paymentStatus: 'Refunded',
  squareRefundId: 'refund-abc',
  status: 'Cancelled'
};

function fakeDb({ assignment, settings }) {
  return {
    collection(name) {
      return {
        doc(id) {
          return {
            get() {
              if (name === 'appSettings' && id === 'emailInstructions') {
                return Promise.resolve({ data: () => settings, exists: Boolean(settings) });
              }

              if (name === 'coordinatorAssignments') {
                const match = assignment && assignment.areaId === id ? assignment : null;

                return Promise.resolve({ data: () => match, exists: Boolean(match) });
              }

              return Promise.resolve({ data: () => null, exists: false });
            }
          };
        }
      };
    }
  };
}

function withStubbedSend(run) {
  const sent = [];
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;

  globalThis.fetch = (url, options) => {
    sent.push({ body: JSON.parse(options.body), url });

    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}')
    });
  };
  process.env.RESEND_API_KEY = 'test-key';

  return run(sent).finally(() => {
    globalThis.fetch = originalFetch;

    if (originalKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalKey;
    }
  });
}

const WORKSHOPS_COORDINATOR = {
  areaId: 'workshops',
  assignedUserEmail: 'workshops@villagequilters.com',
  assignedUserName: 'Workshop Coordinator',
  isActive: true
};

test('a refund reaches the coordinator for that area', async () => {
  await withStubbedSend(async (sent) => {
    await sendRefundCoordinatorEmail(
      fakeDb({
        assignment: WORKSHOPS_COORDINATOR,
        settings: { sendCoordinatorRefundNotifications: true }
      }),
      { actorProfile: ACTOR, registration: REGISTRATION, squareRefund: { status: 'COMPLETED' } }
    );

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.to, ['workshops@villagequilters.com']);
    assert.match(sent[0].body.subject, /^Refund Issued: December Workshop$/);
    // The member, so a coordinator can answer the person whose registration
    // this was rather than the admin who recorded it.
    assert.equal(sent[0].body.reply_to, 'member@example.com');
    assert.match(sent[0].body.text, /Ada Lovelace/);
    assert.match(sent[0].body.text, /refund-abc/);
    assert.match(sent[0].body.text, /Kurt Szeluga/);
  });
});

test('a cancellation with no refund says so rather than claiming one', async () => {
  await withStubbedSend(async (sent) => {
    await sendRefundCoordinatorEmail(
      fakeDb({
        assignment: WORKSHOPS_COORDINATOR,
        settings: { sendCoordinatorRefundNotifications: true }
      }),
      {
        actorProfile: ACTOR,
        registration: { ...REGISTRATION, paymentStatus: 'No Charge', squareRefundId: '' },
        squareRefund: null
      }
    );

    assert.match(sent[0].body.subject, /^Registration Cancelled: /);
    assert.match(sent[0].body.text, /No payment was charged/);
  });
});

test('the switch is its own, not the new-registration one', async () => {
  await withStubbedSend(async (sent) => {
    await sendRefundCoordinatorEmail(
      fakeDb({
        assignment: WORKSHOPS_COORDINATOR,
        // Arrival email on, refund email off. A guild that wants one does not
        // necessarily want the other.
        settings: {
          sendCoordinatorRegistrationNotifications: true,
          sendRegistrationConfirmations: true
        }
      }),
      { actorProfile: ACTOR, registration: REGISTRATION, squareRefund: null }
    );

    assert.equal(sent.length, 0);
  });
});

test('no assigned coordinator sends nothing, and does not fail', async () => {
  await withStubbedSend(async (sent) => {
    await sendRefundCoordinatorEmail(
      fakeDb({ assignment: null, settings: { sendCoordinatorRefundNotifications: true } }),
      { actorProfile: ACTOR, registration: REGISTRATION, squareRefund: null }
    );

    assert.equal(sent.length, 0);
  });
});

test('an inactive assignment is not a recipient', async () => {
  await withStubbedSend(async (sent) => {
    await sendRefundCoordinatorEmail(
      fakeDb({
        assignment: { ...WORKSHOPS_COORDINATOR, isActive: false },
        settings: { sendCoordinatorRefundNotifications: true }
      }),
      { actorProfile: ACTOR, registration: REGISTRATION, squareRefund: null }
    );

    assert.equal(sent.length, 0);
  });
});

test('the override address wins, since that is what it is for', async () => {
  await withStubbedSend(async (sent) => {
    await sendRefundCoordinatorEmail(
      fakeDb({
        assignment: { ...WORKSHOPS_COORDINATOR, contactEmailOverride: 'refunds@villagequilters.com' },
        settings: { sendCoordinatorRefundNotifications: true }
      }),
      { actorProfile: ACTOR, registration: REGISTRATION, squareRefund: null }
    );

    assert.deepEqual(sent[0].body.to, ['refunds@villagequilters.com']);
  });
});

test('a programs refund goes to the Programs coordinator', async () => {
  await withStubbedSend(async (sent) => {
    await sendRefundCoordinatorEmail(
      fakeDb({
        assignment: {
          areaId: 'programs',
          assignedUserEmail: 'programs@villagequilters.com',
          assignedUserName: 'Programs Coordinator',
          isActive: true
        },
        settings: { sendCoordinatorRefundNotifications: true }
      }),
      {
        actorProfile: ACTOR,
        registration: { ...REGISTRATION, eventType: 'Class (Full Day)' },
        squareRefund: null
      }
    );

    assert.deepEqual(sent[0].body.to, ['programs@villagequilters.com']);
  });
});
