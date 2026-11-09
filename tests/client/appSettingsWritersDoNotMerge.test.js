import { beforeEach, describe, expect, it, vi } from 'vitest';

// Guards the writers, where tests/rules/app-settings-membership.test.js guards
// the rules. Every appSettings document is pinned by keys().hasOnly(...) in
// firestore.rules, and under set(..., { merge: true }) request.resource.data is
// the MERGED document - so a field dropped from a payload stays on the stored
// copy and fails that check on every later save, as PERMISSION_DENIED with no
// way to clear it from the app. That is what broke the Membership Check card
// (allowAdminSkipMembershipCheck, dropped in 89aba62). A rules test cannot
// catch someone putting { merge: true } back, so this asserts the call shape
// directly.
//
// The second assertion in each case is the opposite trap: the key set is
// pinned here so that adding a field to a payload fails loudly until the
// matching valid*Settings() list in firestore.rules is updated AND DEPLOYED.
// If one of these lists needs changing, change the rules in the same commit.

const h = vi.hoisted(() => ({ batch: null }));

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (...args) => ({ __collection: args }),
  deleteField: () => '__deleteField',
  doc: (...args) => ({ __doc: args }),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: () => '__serverTimestamp',
  writeBatch: () => h.batch
}));

const {
  saveDirectorySettings,
  saveEmailInstructions,
  saveMembershipSettings,
  savePaymentSettings
} = await import('../../src/services/configurationService.js');

const ACTOR = { email: 'owner@example.com', name: 'Guild Owner', role: 'Super User', userId: 'u1' };

beforeEach(() => {
  h.batch = { commit: vi.fn(async () => {}), set: vi.fn() };
});

// The settings document is always the batch's first set; the audit log is the
// second.
function settingsWrite() {
  return h.batch.set.mock.calls[0];
}

const CASES = [
  {
    // validMembershipSettings()
    keys: ['matchByEmail', 'matchByPhone', 'requireMembershipCheck', 'termsText', 'termsVersion', 'updatedDate'],
    name: 'membership',
    save: () => saveMembershipSettings({ requireMembershipCheck: true }, ACTOR)
  },
  {
    // validPaymentSettings()
    keys: ['allowAppInitiatedRefunds', 'defaultServiceFee', 'enableApplePay', 'enableCardPayments', 'enableGooglePay', 'updatedDate'],
    name: 'paymentSettings',
    save: () => savePaymentSettings({ enableCardPayments: true }, ACTOR)
  },
  {
    // validDirectorySettings()
    keys: ['directoryNote', 'enableMemberDirectory', 'showCityState', 'showEmail', 'showEventRegistrantNames', 'showFullAddress', 'showPhone', 'updatedDate'],
    name: 'directorySettings',
    save: () => saveDirectorySettings({ enableMemberDirectory: true }, ACTOR)
  },
  {
    // validEmailInstructions()
    keys: ['challenges', 'membership', 'programs', 'sendCoordinatorRegistrationNotifications', 'sendRegistrationConfirmations', 'updatedDate', 'workshops'],
    name: 'emailInstructions',
    save: () => saveEmailInstructions({ sendRegistrationConfirmations: true }, ACTOR)
  }
];

describe('the appSettings writers', () => {
  CASES.forEach(({ keys, name, save }) => {
    describe(name, () => {
      it('writes a full set, with no merge option', async () => {
        await save();
        const [, payload, options] = settingsWrite();

        expect(payload).toBeTruthy();
        expect(options).toBeUndefined();
        expect(settingsWrite()).toHaveLength(2);
      });

      it('writes exactly the fields the rules allow', async () => {
        await save();

        expect(Object.keys(settingsWrite()[1]).sort()).toEqual([...keys].sort());
      });
    });
  });

  it('still records an audit log entry alongside each save', async () => {
    // A full set must not have cost the audit trail - the second write.
    await saveMembershipSettings({ requireMembershipCheck: false }, ACTOR);

    expect(h.batch.set).toHaveBeenCalledTimes(2);
    expect(h.batch.set.mock.calls[1][1]).toMatchObject({
      action: 'Update',
      actorUserId: 'u1',
      entityId: 'membership',
      entityType: 'Configuration'
    });
    expect(h.batch.commit).toHaveBeenCalledTimes(1);
  });
});
