import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { currentUser: null };

vi.mock('../../src/lib/firebase.js', () => ({ auth: authState, db: {} }));

const { createAdminRegistration, releaseReservation } = await import('../../src/services/registrationService.js');

function mockFetchOnce(body, { ok = true } = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    headers: { get: () => 'application/json' },
    ok,
    text: async () => JSON.stringify(body)
  });
}

beforeEach(() => {
  authState.currentUser = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAdminRegistration', () => {
  it('always sends the signed-in admin\'s own token, regardless of the target member\'s email', async () => {
    const getIdToken = vi.fn().mockResolvedValue('admin-own-token');
    authState.currentUser = { email: 'coordinator@example.com', getIdToken };
    mockFetchOnce({ registrationId: 'reg-1' });

    await createAdminRegistration({ email: 'someone-else@example.com', eventId: 'event-1' });

    expect(getIdToken).toHaveBeenCalledTimes(1);
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer admin-own-token');
  });

  it('sends action: adminRegister alongside the registration data', async () => {
    authState.currentUser = { email: 'coordinator@example.com', getIdToken: vi.fn().mockResolvedValue('t') };
    mockFetchOnce({ registrationId: 'reg-1' });

    await createAdminRegistration({ email: 'member@example.com', eventId: 'event-1', profileUserId: 'user-1' });

    const [, options] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      action: 'adminRegister',
      email: 'member@example.com',
      eventId: 'event-1',
      profileUserId: 'user-1'
    });
  });

  it('refuses to call the server at all when no admin is signed in', async () => {
    authState.currentUser = null;
    globalThis.fetch = vi.fn();

    await expect(createAdminRegistration({ email: 'member@example.com' })).rejects.toThrow(
      /signed in/
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('surfaces the server error message on failure', async () => {
    authState.currentUser = { email: 'coordinator@example.com', getIdToken: vi.fn().mockResolvedValue('t') };
    mockFetchOnce({ error: 'This account cannot register members on their behalf.' }, { ok: false });

    await expect(createAdminRegistration({ email: 'member@example.com' })).rejects.toThrow(
      'This account cannot register members on their behalf.'
    );
  });
});

describe('releaseReservation', () => {
  it('sends action: releaseReservation with the reservation id and token', async () => {
    mockFetchOnce({ ok: true });

    await releaseReservation('reservation-1', 'token-1');

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('/api/create-registration');
    expect(options.keepalive).toBe(true);
    expect(JSON.parse(options.body)).toMatchObject({
      action: 'releaseReservation',
      reservationId: 'reservation-1',
      reservationToken: 'token-1'
    });
  });

  it('never calls the server without both a reservation id and token', async () => {
    globalThis.fetch = vi.fn();

    await releaseReservation('', 'token-1');
    await releaseReservation('reservation-1', '');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('swallows a failed release instead of throwing - a registrant backing out must never see this fail', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(releaseReservation('reservation-1', 'token-1')).resolves.toBeUndefined();
  });
});
