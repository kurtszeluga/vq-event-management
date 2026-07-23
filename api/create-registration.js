import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initializeAdminApp } from './_lib/public-event-feed.js';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';
import {
  getTimestampMillis,
  generateRegistrationToken,
  hashVerificationSecret,
  normalizeEmail,
  verificationSecretsMatch
} from './_lib/registration-verification.js';

const PAYMENT_RESERVATION_EXPIRATION_MS = 5 * 60 * 1000;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const app = initializeAdminApp();
    const db = getFirestore();

    if (request.body?.action === 'squareConfig') {
      response.status(200).json(await getSquarePaymentConfig(db));
      return;
    }

    if (request.body?.action === 'sendMembershipConfirmation') {
      await handleMembershipConfirmationRequest(request, response, db, app.options.projectId);
      return;
    }

    if (request.body?.action === 'beginSquareReservation') {
      const payload = sanitizeRegistrationPayload(request.body || {});
      const authorization = await authorizeRegistrationRequest(
        request,
        payload,
        app.options.projectId
      );
      const reservation = await beginSquarePaymentReservation(db, payload, authorization);

      response.status(200).json(reservation);
      return;
    }

    const payload = sanitizeRegistrationPayload(request.body || {});

    if (!payload.eventId) {
      response.status(400).json({ error: 'Select an event before registering.' });
      return;
    }

    if (!payload.name || !payload.email || !payload.phone) {
      response.status(400).json({ error: 'Name, email, and phone are required.' });
      return;
    }

    const authorization = await authorizeRegistrationRequest(
      request,
      payload,
      app.options.projectId
    );
    const result = await createRegistration(db, payload, authorization);
    const confirmationContext = result.confirmationContext;

    delete result.confirmationContext;

    if (confirmationContext) {
      await withTimeout(
        sendRegistrationConfirmationEmail(db, confirmationContext),
        4000,
        'Registration confirmation email timed out'
      ).catch((emailError) => {
        console.error('Registration confirmation email failed', emailError);
      });

      if (confirmationContext.profileReactivated) {
        await withTimeout(
          sendMembershipConfirmationEmail(db, {
            kind: 'reactivation',
            profile: confirmationContext.profile
          }),
          4000,
          'Membership reactivation confirmation email timed out'
        ).catch((emailError) => {
          console.error('Membership reactivation confirmation email failed', emailError);
        });
      }
    }

    response.status(200).json(result);
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Registration could not be completed.'
    });
  }
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    })
  ]);
}

async function getSquarePaymentConfig(db) {
  const applicationId = process.env.SQUARE_APPLICATION_ID || '';
  const locationId = process.env.SQUARE_LOCATION_ID || '';
  const environment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const expectedApplicationPrefix = environment === 'production'
    ? 'sq0idp-'
    : 'sandbox-sq0idb-';
  const configured = applicationId.startsWith(expectedApplicationPrefix)
    && locationId.length > 0
    && !locationId.includes('Square Developer Dashboard');
  const settings = await getPaymentSettings(db);
  const enableCardPayments = settings.enableCardPayments !== false;
  const enableApplePay = Boolean(settings.enableApplePay);
  const enableGooglePay = Boolean(settings.enableGooglePay);

  return {
    applicationId,
    enabled: configured && (enableCardPayments || enableApplePay || enableGooglePay),
    enableApplePay,
    enableCardPayments,
    enableGooglePay,
    environment,
    locationId,
    scriptUrl: environment === 'production'
      ? 'https://web.squarecdn.com/v1/square.js'
      : 'https://sandbox.web.squarecdn.com/v1/square.js'
  };
}

async function getPaymentSettings(db) {
  const snapshot = await db.collection('appSettings').doc('paymentSettings').get();

  if (!snapshot.exists) {
    return {
      enableApplePay: false,
      enableCardPayments: true,
      enableGooglePay: false
    };
  }

  return {
    enableApplePay: Boolean(snapshot.data().enableApplePay),
    enableCardPayments: snapshot.data().enableCardPayments !== false,
    enableGooglePay: Boolean(snapshot.data().enableGooglePay)
  };
}

async function createRegistration(db, payload, authorization) {
  const eventRef = db.collection('events').doc(payload.eventId);
  const registrationRef = db.collection('registrations').doc();
  const paymentRef = db.collection('payments').doc();
  const auditRef = db.collection('auditLogs').doc();
  const attemptRef = payload.idempotencyKey
    ? db.collection('registrationAttempts').doc(payload.idempotencyKey)
    : null;

  const result = await db.runTransaction(async (transaction) => {
    const existingAttempt = attemptRef
      ? await getExistingRegistrationAttempt(transaction, db, attemptRef, payload)
      : null;

    if (existingAttempt) {
      return existingAttempt;
    }

    const verificationChallenge = authorization.kind === 'email-code'
      ? await getVerificationChallenge(transaction, db, payload, authorization)
      : null;
    const eventSnap = await transaction.get(eventRef);

    if (!eventSnap.exists) {
      throw httpError(404, 'This event is no longer available.');
    }

    const event = { id: eventSnap.id, ...eventSnap.data() };
    const profile = payload.profileUserId
      ? await getProfileById(transaction, db, payload.profileUserId, payload.email)
      : await findUserProfileByEmail(db, payload.email);
    const membershipStatus = getMembershipStatus(profile);
    const profileStatus = getProfileStatus(profile);

    if (authorization.kind === 'firebase' && profile) {
      const profileUserId = profile.userId || profile.id;

      if (profileUserId !== authorization.userId) {
        throw httpError(403, 'The signed-in account is not linked to this member profile.');
      }
    }

    validateRegistrationEligibility(event, {
      membershipStatus,
      profile,
      profileStatus,
      reactivateProfile: payload.reactivateProfile
    });

    if (profile && payload.reactivateProfile && profileStatus !== 'Active') {
      validateReactivationTerms(payload);
    }

    const existingSnapshot = await transaction.get(
      db.collection('registrations').where('eventId', '==', payload.eventId)
    );
    const existingRegistrations = existingSnapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));
    const alreadyRegistered = existingRegistrations.some((registration) =>
      ['Pending Payment', 'Registered', 'Waitlisted'].includes(registration.status)
        && (
          normalizeEmail(registration.email) === payload.email
          || (profile?.id && registration.userId === (profile.userId || profile.id))
        )
    );

    if (alreadyRegistered) {
      throw httpError(409, 'An active registration already exists for this email and event.');
    }

    const isPaidEvent = Boolean(event.isPaid) && Number(event.cost || 0) > 0;
    const payLaterByCashCheck =
      isPaidEvent
      && Boolean(event.allowCashCheckPayment)
      && payload.paymentPreference === 'cash-check-later';
    const eventCost = Number(event.cost || 0);
    const eventServiceFee = Number(event.serviceFee || 0);
    const amountDue = isPaidEvent ? eventCost + eventServiceFee : 0;
    const possiblePaymentReservation = isPaidEvent && !payLaterByCashCheck && payload.paymentReservationId
      ? await validatePaymentReservation(transaction, db, payload, {
        amountDue,
        email: payload.email,
        eventId: payload.eventId
      })
      : null;
    const registeredCount = existingRegistrations.filter(
      (registration) => registration.status === 'Registered'
    ).length;
    const activeReservationCount = await getActiveReservationCount(
      transaction,
      db,
      payload.eventId,
      Date.now(),
      possiblePaymentReservation?.id || payload.paymentReservationId
    );
    const hasCapacity = Boolean(event.capacityUnlimited)
      || registeredCount + activeReservationCount < Number(event.capacity || 0);
    const status = getInitialRegistrationStatus({ hasCapacity, isPaidEvent, payLaterByCashCheck });
    const paymentStatus = getInitialPaymentStatus({ isPaidEvent, status });
    const requiresSquarePayment = isPaidEvent && status === 'Pending Payment' && !payLaterByCashCheck;
    const paymentReservation = requiresSquarePayment ? possiblePaymentReservation : null;

    if (requiresSquarePayment && !payload.squarePaymentToken) {
      throw httpError(400, 'Enter card payment details before submitting registration.');
    }

    const userId = profile?.userId || profile?.id || '';
    const profileUpdates = payload.profileUpdates || {};
    const registrantFirstName = profileUpdates.firstName || profile?.firstName || getFirstName(payload.name);
    const registrantLastName = profileUpdates.lastName || profile?.lastName || getLastName(payload.name);
    const registration = {
      email: payload.email,
      eventId: payload.eventId,
      amountDue,
      amountPaid: isPaidEvent ? 0 : amountDue,
      eventCost,
      eventDate: event.date || '',
      eventPaymentRequired: isPaidEvent,
      eventServiceFee,
      eventTitle: event.title || '',
      eventType: event.eventType || '',
      paymentPreference: payLaterByCashCheck ? 'cash-check-later' : '',
      name: payload.name,
      membershipStatusAtRegistration: membershipStatus,
      paymentMethod: '',
      paymentNote: payLaterByCashCheck ? 'Registrant chose to pay later by cash/check.' : '',
      paymentStatus,
      paymentUpdatedDate: FieldValue.serverTimestamp(),
      phone: payload.phone,
      profileMatchedAtRegistration: Boolean(profile),
      profileStatusAtRegistration: profileStatus || '',
      registrationDate: FieldValue.serverTimestamp(),
      registrationId: registrationRef.id,
      registrantFirstName,
      registrantLastName,
      status,
      userId
    };

    if (verificationChallenge) {
      transaction.update(verificationChallenge.ref, {
        consumedAt: FieldValue.serverTimestamp(),
        consumedRegistrationId: registrationRef.id,
        registrationTokenHash: ''
      });
    }

    if (paymentReservation) {
      transaction.update(paymentReservation.ref, {
        consumedAt: FieldValue.serverTimestamp(),
        registrationId: registrationRef.id,
        status: 'Consumed',
        tokenHash: ''
      });
    }

    if (attemptRef) {
      transaction.set(attemptRef, {
        amountDue,
        createdAt: FieldValue.serverTimestamp(),
        email: payload.email,
        eventId: payload.eventId,
        paymentId: paymentRef.id,
        registrationId: registrationRef.id,
        status: requiresSquarePayment ? 'Payment Pending' : 'Completed',
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    if (profile && payload.reactivateProfile && profileStatus !== 'Active') {
      transaction.update(db.collection('users').doc(profile.id), {
        archivedBy: FieldValue.delete(),
        archivedDate: FieldValue.delete(),
        status: 'Active',
        termsAccepted: true,
        termsAcceptedDate: FieldValue.serverTimestamp(),
        termsVersion: payload.termsVersion || 'Reactivation Agreement',
        updatedDate: FieldValue.serverTimestamp()
      });
    }

    if (profile && payload.profileUpdates) {
      const profileUpdatePayload = {
        firstName: payload.profileUpdates.firstName,
        lastName: payload.profileUpdates.lastName,
        name: buildDisplayName(payload.profileUpdates.firstName, payload.profileUpdates.lastName),
        phone: payload.profileUpdates.phone,
        updatedDate: FieldValue.serverTimestamp()
      };

      if ('billingAddress' in payload.profileUpdates) {
        profileUpdatePayload.billingAddress = sanitizeBillingAddress(payload.profileUpdates.billingAddress);
      }

      transaction.update(db.collection('users').doc(profile.id), profileUpdatePayload);
    }

    transaction.set(registrationRef, registration);
    transaction.set(paymentRef, {
      amount: registration.amountPaid,
      amountDue,
      createdBy: userId,
      createdByEmail: payload.email,
      createdByName: payload.name,
      createdDate: FieldValue.serverTimestamp(),
      entityId: registrationRef.id,
      entityType: 'Registration',
      eventId: payload.eventId,
      method: registration.paymentMethod,
      note: registration.paymentNote,
      paymentId: paymentRef.id,
      processor: 'Manual',
      registrationId: registrationRef.id,
      registrationStatus: status,
      squareTransactionId: '',
      status: registration.paymentStatus,
      userId,
      updatedRegistrationSnapshot: {
      amountPaid: registration.amountPaid,
      paymentMethod: registration.paymentMethod,
      paymentStatus: registration.paymentStatus,
      paymentPreference: registration.paymentPreference,
      status
      }
    });
    transaction.set(auditRef, {
      action: 'Register',
      actorEmail: payload.email,
      actorName: payload.name,
      actorRole: profile?.role || 'Guest',
      actorUserId: userId,
      after: {
        ...registration,
        registrationDate: null
      },
      before: {},
      createdDate: FieldValue.serverTimestamp(),
      entityId: registrationRef.id,
      entityType: 'Registration',
      summary: `${payload.name} registered for "${event.title || event.eventType || payload.eventId}"`
    });

    return {
      eventTitle: event.title || '',
      membershipStatus,
      paymentRequired: isPaidEvent,
      paymentStatus: registration.paymentStatus,
      paymentPreference: registration.paymentPreference,
      squarePayment: requiresSquarePayment ? {
        amountDue,
        email: payload.email,
        eventTitle: event.title || event.eventType || payload.eventId,
        name: payload.name,
        idempotencyKey: payload.idempotencyKey || registrationRef.id,
        paymentId: paymentRef.id,
        registrationId: registrationRef.id,
        sourceId: payload.squarePaymentToken
      } : null,
      profileReactivated: Boolean(profile && payload.reactivateProfile && profileStatus !== 'Active'),
      registrationId: registrationRef.id,
      registeredCount: registeredCount + (status === 'Registered' ? 1 : 0),
      waitlistedCount: existingRegistrations.filter(
        (registrationRecord) => registrationRecord.status === 'Waitlisted'
      ).length + (status === 'Waitlisted' ? 1 : 0),
      status,
      confirmationContext: {
        event,
        profile: profile ? {
          email: profile.email || registration.email,
          membershipStatus: profile.membershipStatus || membershipStatus,
          name: profile.name || registration.name,
          phone: profile.phone || registration.phone
        } : null,
        profileReactivated: Boolean(profile && payload.reactivateProfile && profileStatus !== 'Active'),
        registration: {
          ...registration,
          registrationDate: new Date().toISOString()
        }
      }
    };
  });

  if (!result.squarePayment) {
    return result;
  }

  try {
    const squarePayment = await createSquarePayment(result.squarePayment);
    await finalizeSquareRegistrationPayment(db, result, squarePayment);

    result.status = 'Registered';
    result.paymentStatus = 'Paid';
    result.paymentPreference = 'online';
    result.registeredCount += 1;
    result.confirmationContext.registration.status = 'Registered';
    result.confirmationContext.registration.paymentStatus = 'Paid';
    result.confirmationContext.registration.paymentMethod = 'Online';
    result.confirmationContext.registration.paymentPreference = 'online';
    result.confirmationContext.registration.amountPaid = result.squarePayment.amountDue;
    delete result.squarePayment;

    return result;
  } catch (paymentError) {
    await markSquareRegistrationPaymentFailed(db, result, paymentError).catch((updateError) => {
      console.error('Failed to mark Square payment failure', updateError);
    });
    throw paymentError;
  }
}

async function beginSquarePaymentReservation(db, payload, authorization) {
  if (!payload.eventId) {
    throw httpError(400, 'Select an event before starting payment.');
  }

  if (!payload.email) {
    throw httpError(400, 'Enter an email address before starting payment.');
  }

  const eventRef = db.collection('events').doc(payload.eventId);
  const reservationRef = payload.idempotencyKey
    ? db.collection('registrationReservations').doc(payload.idempotencyKey)
    : db.collection('registrationReservations').doc();
  const now = Date.now();
  const expiresAtMillis = now + PAYMENT_RESERVATION_EXPIRATION_MS;

  return db.runTransaction(async (transaction) => {
    if (authorization.kind === 'email-code') {
      await getVerificationChallenge(transaction, db, payload, authorization);
    }

    const eventSnap = await transaction.get(eventRef);

    if (!eventSnap.exists) {
      throw httpError(404, 'This event is no longer available.');
    }

    const event = { id: eventSnap.id, ...eventSnap.data() };
    const profile = payload.profileUserId
      ? await getProfileById(transaction, db, payload.profileUserId, payload.email)
      : await findUserProfileByEmail(db, payload.email);
    const membershipStatus = getMembershipStatus(profile);
    const profileStatus = getProfileStatus(profile);

    if (authorization.kind === 'firebase' && profile) {
      const profileUserId = profile.userId || profile.id;

      if (profileUserId !== authorization.userId) {
        throw httpError(403, 'The signed-in account is not linked to this member profile.');
      }
    }

    validateRegistrationEligibility(event, {
      membershipStatus,
      profile,
      profileStatus,
      reactivateProfile: payload.reactivateProfile
    });

    const isPaidEvent = Boolean(event.isPaid) && Number(event.cost || 0) > 0;
    const payLaterByCashCheck =
      isPaidEvent
      && Boolean(event.allowCashCheckPayment)
      && payload.paymentPreference === 'cash-check-later';

    if (!isPaidEvent || payLaterByCashCheck) {
      return {
        amountDue: 0,
        paymentRequired: false,
        reservationId: '',
        reservationToken: '',
        status: 'No Reservation Needed'
      };
    }

    const existingSnapshot = await transaction.get(
      db.collection('registrations').where('eventId', '==', payload.eventId)
    );
    const existingRegistrations = existingSnapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));
    const alreadyRegistered = existingRegistrations.some((registration) =>
      ['Pending Payment', 'Registered', 'Waitlisted'].includes(registration.status)
        && (
          normalizeEmail(registration.email) === payload.email
          || (profile?.id && registration.userId === (profile.userId || profile.id))
        )
    );

    if (alreadyRegistered) {
      throw httpError(409, 'An active registration already exists for this email and event.');
    }

    const registeredCount = existingRegistrations.filter(
      (registration) => registration.status === 'Registered'
    ).length;
    const activeReservationCount = await getActiveReservationCount(
      transaction,
      db,
      payload.eventId,
      now,
      reservationRef.id
    );
    const seatsAvailable = Boolean(event.capacityUnlimited)
      || registeredCount + activeReservationCount < Number(event.capacity || 0);

    if (!seatsAvailable) {
      return {
        amountDue: 0,
        paymentRequired: false,
        reservationId: '',
        reservationToken: '',
        status: 'Waitlisted'
      };
    }

    const amountDue = Number(event.cost || 0) + Number(event.serviceFee || 0);
    const existingReservationSnap = payload.idempotencyKey
      ? await transaction.get(reservationRef)
      : null;

    if (existingReservationSnap?.exists) {
      const existingReservation = existingReservationSnap.data();
      const existingExpiresAtMillis = getTimestampMillis(existingReservation.expiresAt)
        || getTimestampMillis(existingReservation.createdAt) + PAYMENT_RESERVATION_EXPIRATION_MS;

      if (
        existingReservation.status === 'Active'
        && existingReservation.eventId === payload.eventId
        && existingReservation.email === payload.email
        && existingExpiresAtMillis > now
      ) {
        return {
          amountDue: Number(existingReservation.amountDue || amountDue),
          expiresAt: new Date(existingExpiresAtMillis).toISOString(),
          paymentRequired: true,
          reservationId: reservationRef.id,
          reservationToken: payload.idempotencyKey,
          status: 'Reserved'
        };
      }
    }

    const reservationToken = payload.idempotencyKey || generateRegistrationToken();

    transaction.set(reservationRef, {
      amountDue,
      createdAt: FieldValue.serverTimestamp(),
      email: payload.email,
      eventId: payload.eventId,
      expiresAt: new Date(expiresAtMillis),
      registrationId: '',
      status: 'Active',
      tokenHash: hashVerificationSecret(reservationRef.id, reservationToken),
      userId: profile?.userId || profile?.id || ''
    });

    return {
      amountDue,
      expiresAt: new Date(expiresAtMillis).toISOString(),
      paymentRequired: true,
      reservationId: reservationRef.id,
      reservationToken,
      status: 'Reserved'
    };
  });
}

async function getExistingRegistrationAttempt(transaction, db, attemptRef, payload) {
  const attemptSnap = await transaction.get(attemptRef);

  if (!attemptSnap.exists) {
    return null;
  }

  const attempt = attemptSnap.data();

  if (attempt.eventId !== payload.eventId || attempt.email !== payload.email) {
    throw httpError(409, 'This registration attempt is already being used. Refresh and start registration again.');
  }

  if (!attempt.registrationId) {
    throw httpError(409, 'This registration is already being processed. Please wait a moment before trying again.');
  }

  const registrationRef = db.collection('registrations').doc(attempt.registrationId);
  const registrationSnap = await transaction.get(registrationRef);

  if (!registrationSnap.exists) {
    throw httpError(409, 'This registration is already being processed. Please wait a moment before trying again.');
  }

  const registration = { id: registrationSnap.id, ...registrationSnap.data() };

  if (registration.status === 'Cancelled' && registration.paymentStatus === 'Failed') {
    throw httpError(409, 'The previous payment attempt failed. Refresh and start registration again.');
  }

  const eventSnap = await transaction.get(db.collection('events').doc(payload.eventId));
  const event = eventSnap.exists ? { id: eventSnap.id, ...eventSnap.data() } : {};
  const existingSnapshot = await transaction.get(
    db.collection('registrations').where('eventId', '==', payload.eventId)
  );
  const existingRegistrations = existingSnapshot.docs.map((docSnapshot) => docSnapshot.data());

  return {
    eventTitle: registration.eventTitle || event.title || '',
    idempotentReplay: true,
    membershipStatus: registration.membershipStatusAtRegistration || 'Unknown',
    paymentPreference: registration.paymentPreference || '',
    paymentRequired: Boolean(registration.eventPaymentRequired),
    paymentStatus: registration.paymentStatus || 'Pending',
    profileReactivated: false,
    registrationId: registration.registrationId || registration.id,
    registeredCount: existingRegistrations.filter(
      (registrationRecord) => registrationRecord.status === 'Registered'
    ).length,
    status: registration.status || 'Registered',
    waitlistedCount: existingRegistrations.filter(
      (registrationRecord) => registrationRecord.status === 'Waitlisted'
    ).length
  };
}

async function getProfileById(transaction, db, profileUserId, email) {
  const profileRef = db.collection('users').doc(profileUserId);
  const profileSnap = await transaction.get(profileRef);

  if (!profileSnap.exists) {
    throw httpError(404, 'The matched profile could not be found.');
  }

  const profile = { id: profileSnap.id, ...profileSnap.data() };

  if (normalizeEmail(profile.email) !== email) {
    throw httpError(400, 'The matched profile does not match this email.');
  }

  return profile;
}

async function findUserProfileByEmail(db, email) {
  const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();

  if (snapshot.empty) {
    return null;
  }

  const docSnapshot = snapshot.docs[0];
  return { id: docSnapshot.id, ...docSnapshot.data() };
}

function validateRegistrationEligibility(
  event,
  { membershipStatus, profile, profileStatus, reactivateProfile }
) {
  if (!isEventVisible(event)) {
    throw httpError(404, 'This event is not currently available.');
  }

  if (!event.registrationOpen) {
    throw httpError(400, 'Registration is not currently open for this event.');
  }

  if (['Business Listing', 'For Sale'].includes(event.eventType)) {
    throw httpError(400, 'This listing does not accept registrations.');
  }

  if (profile && profileStatus !== 'Active' && !reactivateProfile) {
    throw httpError(400, 'Please confirm whether you want to reactivate the matched profile.');
  }

  if (event.allowNonMemberRegistration && !profile) {
    return;
  }

  if (!profile) {
    throw httpError(403, 'We could not find a Guild membership record for this email address. Guild membership is required to register. Please contact an administrator for assistance.');
  }

  if (!event.allowNonMemberRegistration && membershipStatus !== 'Active') {
    throw httpError(403, 'Your membership status is not currently active. Please contact an administrator for assistance.');
  }
}

function getMembershipStatus(profile) {
  return profile?.membershipStatus || 'Unknown';
}

function getProfileStatus(profile) {
  if (!profile) {
    return '';
  }

  if (profile.archivedBy || profile.archivedDate || profile.status === 'Archived') {
    return 'Archived';
  }

  return profile.status || 'Unknown';
}

function isEventVisible(event) {
  if (event.status !== 'Published') {
    return false;
  }

  const now = Date.now();
  const visibleFrom = event.visibleFrom ? Date.parse(event.visibleFrom) : null;
  const visibleUntil = event.visibleUntil ? Date.parse(event.visibleUntil) : null;

  if (visibleFrom && visibleFrom > now) {
    return false;
  }

  if (visibleUntil && visibleUntil < now) {
    return false;
  }

  return true;
}

function sanitizeRegistrationPayload(payload) {
  return {
    email: normalizeEmail(payload.email),
    eventId: String(payload.eventId || '').trim(),
    idempotencyKey: sanitizeIdempotencyKey(payload.idempotencyKey),
    name: normalizeName(payload.name || ''),
    paymentPreference: payload.paymentPreference === 'cash-check-later' ? 'cash-check-later' : '',
    paymentReservationId: cleanText(payload.paymentReservationId),
    paymentReservationToken: cleanText(payload.paymentReservationToken),
    phone: String(payload.phone || '').trim(),
    profileUserId: String(payload.profileUserId || '').trim(),
    profileUpdates: sanitizeProfileUpdates(payload.profileUpdates || {}),
    reactivateProfile: Boolean(payload.reactivateProfile),
    reactivationTermsAccepted: Boolean(payload.reactivationTermsAccepted),
    squarePaymentToken: String(payload.squarePaymentToken || '').trim(),
    termsVersion: String(payload.termsVersion || '').trim(),
    verificationChallengeId: cleanText(payload.verificationChallengeId),
    verificationToken: cleanText(payload.verificationToken)
  };
}

function sanitizeIdempotencyKey(value) {
  const key = String(value || '').trim();

  return /^[A-Za-z0-9_-]{16,80}$/.test(key) ? key : '';
}

async function authorizeRegistrationRequest(request, payload, projectId) {
  const authHeader = request.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : '';

  if (idToken) {
    let decodedToken;

    try {
      decodedToken = await verifyFirebaseIdToken(idToken, projectId);
    } catch {
      throw httpError(401, 'Your sign-in has expired. Please sign in again or verify your email address.');
    }
    const tokenEmail = normalizeEmail(decodedToken.email);
    const userId = decodedToken.user_id || decodedToken.sub || decodedToken.uid || '';

    if (!tokenEmail || tokenEmail !== payload.email || !userId) {
      throw httpError(403, 'The signed-in account does not match this registration email.');
    }

    return { kind: 'firebase', userId };
  }

  if (!payload.verificationChallengeId || !payload.verificationToken) {
    throw httpError(401, 'Verify your email address before submitting this registration.');
  }

  return {
    challengeId: payload.verificationChallengeId,
    kind: 'email-code'
  };
}

async function getVerificationChallenge(transaction, db, payload, authorization) {
  const challengeRef = db
    .collection('registrationVerifications')
    .doc(authorization.challengeId);
  const challengeSnap = await transaction.get(challengeRef);

  if (!challengeSnap.exists) {
    throw httpError(401, 'Your email verification has expired. Request a new code.');
  }

  const challenge = challengeSnap.data();
  const validToken = verificationSecretsMatch(
    challenge.registrationTokenHash,
    authorization.challengeId,
    payload.verificationToken
  );

  if (
    challenge.email !== payload.email
    || challenge.eventId !== payload.eventId
    || challenge.consumedAt
    || getTimestampMillis(challenge.registrationTokenExpiresAt) <= Date.now()
    || !validToken
  ) {
    throw httpError(401, 'Your email verification has expired. Request a new code.');
  }

  return { ref: challengeRef };
}

async function validatePaymentReservation(transaction, db, payload, expected) {
  if (!payload.paymentReservationId) {
    throw httpError(400, 'Your payment seat hold has expired. Start payment again.');
  }

  const reservationRef = db
    .collection('registrationReservations')
    .doc(payload.paymentReservationId);
  const reservationSnap = await transaction.get(reservationRef);

  if (!reservationSnap.exists) {
    throw httpError(400, 'Your payment seat hold has expired. Start payment again.');
  }

  const reservation = reservationSnap.data();
  const expiresAtMillis = getTimestampMillis(reservation.expiresAt)
    || getTimestampMillis(reservation.createdAt) + PAYMENT_RESERVATION_EXPIRATION_MS;
  const reservationAmountCents = Math.round(Number(reservation.amountDue || 0) * 100);
  const expectedAmountCents = Math.round(Number(expected.amountDue || 0) * 100);

  if (
    reservation.status !== 'Active'
    || reservation.eventId !== expected.eventId
    || reservation.email !== expected.email
    || reservationAmountCents !== expectedAmountCents
    || expiresAtMillis <= Date.now()
  ) {
    throw httpError(400, 'Your payment seat hold has expired. Start payment again.');
  }

  return { id: payload.paymentReservationId, ref: reservationRef };
}

async function getActiveReservationCount(transaction, db, eventId, now, excludedReservationId = '') {
  const snapshot = await transaction.get(
    db.collection('registrationReservations').where('eventId', '==', eventId)
  );

  return snapshot.docs.filter((docSnapshot) => {
    const reservation = docSnapshot.data();

    return docSnapshot.id !== excludedReservationId
      && reservation.status === 'Active'
      && getTimestampMillis(reservation.expiresAt) > now;
  }).length;
}

async function createSquarePayment(paymentRequest) {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN || '';
  const locationId = process.env.SQUARE_LOCATION_ID || '';
  const environment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

  if (!accessToken || !locationId) {
    throw httpError(500, 'Online card payment is not configured yet.');
  }

  const endpoint = environment === 'production'
    ? 'https://connect.squareup.com/v2/payments'
    : 'https://connect.squareupsandbox.com/v2/payments';
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      amount_money: {
        amount: Math.round(Number(paymentRequest.amountDue || 0) * 100),
        currency: 'USD'
      },
      idempotency_key: paymentRequest.idempotencyKey || paymentRequest.registrationId,
      location_id: locationId,
      note: `Village Quilters registration: ${paymentRequest.eventTitle}`,
      source_id: paymentRequest.sourceId
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2026-05-20'
    },
    method: 'POST'
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw httpError(response.status, getSquarePaymentError(result));
  }

  return result.payment || {};
}

async function finalizeSquareRegistrationPayment(db, result, squarePayment) {
  const payment = result.squarePayment;
  const registrationRef = db.collection('registrations').doc(payment.registrationId);
  const paymentRef = db.collection('payments').doc(payment.paymentId);
  const auditRef = db.collection('auditLogs').doc();
  const squareTransactionId = squarePayment.id || '';

  const updatePayload = {
    amountPaid: payment.amountDue,
    paymentMethod: 'Online',
    paymentNote: 'Paid online through Square.',
    paymentPreference: 'online',
    paymentStatus: 'Paid',
    paymentUpdatedDate: FieldValue.serverTimestamp(),
    status: 'Registered'
  };

  await db.runTransaction(async (transaction) => {
    const registrationSnap = await transaction.get(registrationRef);
    const before = registrationSnap.exists ? registrationSnap.data() : {};

    transaction.update(registrationRef, updatePayload);
    transaction.update(paymentRef, {
      amount: payment.amountDue,
      method: 'Online',
      note: 'Paid online through Square.',
      processor: 'Square',
      registrationStatus: 'Registered',
      squareTransactionId,
      status: 'Paid',
      updatedRegistrationSnapshot: {
        amountPaid: payment.amountDue,
        paymentMethod: 'Online',
        paymentPreference: 'online',
        paymentStatus: 'Paid',
        status: 'Registered'
      }
    });
    if (payment.idempotencyKey) {
      transaction.update(db.collection('registrationAttempts').doc(payment.idempotencyKey), {
        squareTransactionId,
        status: 'Completed',
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    transaction.set(auditRef, {
      action: 'Pay',
      actorEmail: payment.email,
      actorName: payment.name,
      actorRole: 'Registrant',
      actorUserId: '',
      after: {
        ...updatePayload,
        paymentUpdatedDate: null,
        squareTransactionId
      },
      before,
      createdDate: FieldValue.serverTimestamp(),
      entityId: payment.registrationId,
      entityType: 'Registration',
      summary: `${payment.name} paid online for "${payment.eventTitle}"`
    });
  });
}

async function markSquareRegistrationPaymentFailed(db, result, paymentError) {
  const payment = result.squarePayment;

  if (!payment?.registrationId || !payment?.paymentId) {
    return;
  }

  await db.runTransaction(async (transaction) => {
    transaction.update(db.collection('registrations').doc(payment.registrationId), {
      paymentMethod: 'Online',
      paymentNote: paymentError.message || 'Square payment failed.',
      paymentStatus: 'Failed',
      paymentUpdatedDate: FieldValue.serverTimestamp(),
      status: 'Cancelled'
    });
    transaction.update(db.collection('payments').doc(payment.paymentId), {
      method: 'Online',
      note: paymentError.message || 'Square payment failed.',
      processor: 'Square',
      registrationStatus: 'Cancelled',
      status: 'Failed',
      updatedRegistrationSnapshot: {
        amountPaid: 0,
        paymentMethod: 'Online',
        paymentPreference: 'online',
        paymentStatus: 'Failed',
        status: 'Cancelled'
      }
    });
    if (payment.idempotencyKey) {
      transaction.update(db.collection('registrationAttempts').doc(payment.idempotencyKey), {
        failureMessage: paymentError.message || 'Square payment failed.',
        status: 'Failed',
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });
}

function getSquarePaymentError(result) {
  const errors = result?.errors || [];
  const message = errors
    .map((error) => error.detail || error.message)
    .filter(Boolean)
    .join(' ');

  return message || 'Square card payment could not be completed.';
}

function getInitialRegistrationStatus({ hasCapacity, isPaidEvent, payLaterByCashCheck }) {
  if (!hasCapacity) {
    return 'Waitlisted';
  }

  if (isPaidEvent && !payLaterByCashCheck) {
    return 'Pending Payment';
  }

  return 'Registered';
}

function getInitialPaymentStatus({ isPaidEvent, status }) {
  if (!isPaidEvent) {
    return 'No Charge';
  }

  return status === 'Waitlisted' ? 'Pending' : 'Pending';
}

function validateReactivationTerms(payload) {
  if (!payload.reactivationTermsAccepted) {
    throw httpError(400, 'You must read and agree to the terms and conditions before reactivating your profile.');
  }

  if (!payload.termsVersion) {
    throw httpError(400, 'Terms version is required before reactivating your profile.');
  }
}

function sanitizeProfileUpdates(profileUpdates) {
  const firstName = normalizeName(profileUpdates.firstName || '');
  const lastName = normalizeName(profileUpdates.lastName || '');
  const hasBillingAddress = Object.prototype.hasOwnProperty.call(profileUpdates, 'billingAddress');

  if (!firstName && !lastName && !profileUpdates.phone && !hasBillingAddress) {
    return null;
  }

  const sanitized = {
    firstName,
    lastName,
    phone: String(profileUpdates.phone || '').trim()
  };

  if (hasBillingAddress) {
    sanitized.billingAddress = profileUpdates.billingAddress || {};
  }

  return sanitized;
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function buildDisplayName(firstName = '', lastName = '') {
  return [firstName, lastName].filter(Boolean).join(' ');
}

function getFirstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function getLastName(name) {
  const nameParts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
}

function sanitizeBillingAddress(billingAddress = {}) {
  return {
    city: normalizeName(billingAddress.city || ''),
    country: normalizeName(billingAddress.country || '') || 'United States',
    postalCode: String(billingAddress.postalCode || '').trim(),
    state: String(billingAddress.state || '').trim().toUpperCase(),
    street: normalizeName(billingAddress.street || '')
  };
}

async function sendRegistrationConfirmationEmail(db, { event, registration }) {
  const emailSettingsSnap = await db.collection('appSettings').doc('emailInstructions').get();
  const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};

  if (emailSettings.sendRegistrationConfirmations !== true) {
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY is not configured. Skipping registration confirmation email.');
    return;
  }

  const area = getEmailInstructionArea(event.eventType);
  const instructionText = cleanText(emailSettings[area.areaId]);
  const coordinatorContact = await getCoordinatorContact(db, area.areaId);
  const replyTo = coordinatorContact.email;
  const subjectStatus = getRegistrationEmailSubjectStatus(registration.status);

  await sendResendEmail({
    html: buildRegistrationConfirmationHtml({
      area,
      coordinatorContact,
      event,
      instructionText,
      registration
    }),
    replyTo,
    subject: `Village Quilters ${subjectStatus}: ${event.title || event.eventType || 'Event'}`,
    text: buildRegistrationConfirmationText({
      area,
      coordinatorContact,
      event,
      instructionText,
      registration
    }),
    to: registration.email
  });
}

async function handleMembershipConfirmationRequest(request, response, db, projectId) {
  const authHeader = request.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : '';

  if (!idToken) {
    response.status(401).json({ error: 'Missing authorization token.' });
    return;
  }

  const decodedToken = await verifyFirebaseIdToken(idToken, projectId);
  const userId = decodedToken.user_id || decodedToken.sub || decodedToken.uid;

  if (!userId) {
    response.status(401).json({ error: 'Invalid authorization token.' });
    return;
  }

  const profileSnap = await db.collection('users').doc(userId).get();

  if (!profileSnap.exists) {
    response.status(404).json({ error: 'Membership profile was not found.' });
    return;
  }

  const profile = { id: profileSnap.id, ...profileSnap.data() };

  await sendMembershipConfirmationEmail(db, {
    kind: request.body?.kind === 'reactivation' ? 'reactivation' : 'signup',
    profile
  });

  response.status(200).json({ ok: true });
}

async function sendMembershipConfirmationEmail(db, { kind = 'signup', profile }) {
  const emailSettingsSnap = await db.collection('appSettings').doc('emailInstructions').get();
  const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};

  if (emailSettings.sendRegistrationConfirmations !== true) {
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY is not configured. Skipping membership confirmation email.');
    return;
  }

  const area = { areaId: 'membership', areaLabel: 'Membership' };
  const instructionText = cleanText(emailSettings.membership);
  const coordinatorContact = await getCoordinatorContact(db, area.areaId);
  const replyTo = coordinatorContact.email;
  const isReactivation = kind === 'reactivation';

  await sendResendEmail({
    html: buildMembershipConfirmationHtml({
      area,
      coordinatorContact,
      instructionText,
      isReactivation,
      profile
    }),
    replyTo,
    subject: isReactivation
      ? 'Village Quilters Membership Reactivation Confirmation'
      : 'Village Quilters Membership Request Confirmation',
    text: buildMembershipConfirmationText({
      area,
      coordinatorContact,
      instructionText,
      isReactivation,
      profile
    }),
    to: profile.email
  });
}

async function sendResendEmail({ html, replyTo, subject, text, to }) {
  const from = process.env.RESEND_FROM_EMAIL || 'The Village Quilters <no-reply@villagequilters.com>';
  const payload = {
    from,
    html,
    subject,
    text,
    to: [to]
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const textResponse = await resendResponse.text();
  const result = textResponse ? safeJsonParse(textResponse) : {};

  if (!resendResponse.ok) {
    const message = result.message || result.error || 'Resend could not send the registration confirmation email.';
    const error = new Error(message);
    error.statusCode = resendResponse.status;
    throw error;
  }

  return result;
}

function buildRegistrationConfirmationHtml({ area, coordinatorContact, event, instructionText, registration }) {
  const logoUrl = `${getAppOrigin()}/assets/village-quilters-logo.png`;
  const eventTitle = event.title || event.eventType || 'Event';
  const supplyListUrl = event.supplyListUrl || '';
  const instructions = instructionText || 'No additional instructions have been provided for this area.';
  const contactHtml = buildCoordinatorContactHtml(coordinatorContact);
  const confirmationIntro = getRegistrationEmailIntro(area, registration);

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f3eee8;color:#1d2927;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#f3eee8;padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" style="width:100%;max-width:680px;border-collapse:collapse;background:#fffdfa;border:1px solid #ded5ca;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:#225c56;color:#fffaf5;">
                <table role="presentation" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="width:58px;vertical-align:middle;">
                      <img alt="Village Quilters" src="${escapeHtml(logoUrl)}" width="48" height="48" style="display:block;border-radius:10px;" />
                    </td>
                    <td style="vertical-align:middle;">
                      <p style="margin:0 0 5px;color:#f3c6a8;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">The Village Quilters, Inc.</p>
                      <h1 style="margin:0;color:#fffaf5;font-size:24px;line-height:1.25;">${escapeHtml(getRegistrationEmailHeading(registration.status))}</h1>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">Hello ${escapeHtml(registration.name)},</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">${escapeHtml(confirmationIntro)}</p>
                <section style="margin:0 0 18px;padding:16px;border:1px solid #e3d9ce;background:#fbf8f3;">
                  <h2 style="margin:0 0 12px;color:#225c56;font-size:19px;line-height:1.3;">${escapeHtml(eventTitle)}</h2>
                  ${buildDetailRowHtml('Status', registration.status)}
                  ${buildDetailRowHtml('Event Type', event.eventType || 'Event')}
                  ${buildDetailRowHtml('Date', formatEventDate(event.date))}
                  ${event.eventType === 'Challenges' ? '' : buildDetailRowHtml('Time', formatTimeRange(event.startTime, event.endTime))}
                  ${buildDetailRowHtml('Location', event.location || 'To be announced')}
                  ${buildDetailRowHtml('Presenter', event.presenter || 'To be announced')}
                  ${buildDetailRowHtml('Payment Status', registration.paymentStatus || 'Pending')}
                  ${registration.eventPaymentRequired ? buildDetailRowHtml('Amount Due', formatCurrency(registration.amountDue)) : ''}
                </section>
                ${contactHtml}
                ${supplyListUrl ? `
                  <p style="margin:0 0 18px;">
                    <a href="${escapeHtml(supplyListUrl)}" style="display:inline-block;background:#225c56;color:#fffaf5;text-decoration:none;font-weight:700;padding:10px 14px;border-radius:6px;">View Supply List</a>
                  </p>
                ` : ''}
                <section style="margin:0 0 18px;padding:16px;border:1px solid #e3d9ce;background:#ffffff;">
                  <h2 style="margin:0 0 8px;color:#225c56;font-size:17px;line-height:1.3;">${escapeHtml(area.areaLabel)} Instructions</h2>
                  <p style="margin:0;white-space:pre-wrap;font-size:15px;line-height:1.55;">${escapeHtml(instructions)}</p>
                </section>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#225c56;color:#fffaf5;">
                <p style="margin:0;color:#fffaf5;font-size:13px;line-height:1.5;">The Village Quilters, Inc.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildDetailRowHtml(label, value) {
  return `<p style="margin:0 0 8px;font-size:15px;line-height:1.45;"><strong style="color:#1d2927;">${escapeHtml(label)}:</strong> ${escapeHtml(value || '')}</p>`;
}

function buildRegistrationConfirmationText({ area, coordinatorContact, event, instructionText, registration }) {
  const coordinatorLines = buildCoordinatorContactText(coordinatorContact);

  return [
    `The Village Quilters, Inc. ${getRegistrationEmailHeading(registration.status)}`,
    '',
    `Hello ${registration.name},`,
    '',
    getRegistrationEmailIntro(area, registration),
    '',
    `Event: ${event.title || event.eventType || 'Event'}`,
    `Status: ${registration.status}`,
    `Event Type: ${event.eventType || 'Event'}`,
    `Date: ${formatEventDate(event.date)}`,
    event.eventType === 'Challenges' ? '' : `Time: ${formatTimeRange(event.startTime, event.endTime)}`,
    `Location: ${event.location || 'To be announced'}`,
    `Presenter: ${event.presenter || 'To be announced'}`,
    `Payment Status: ${registration.paymentStatus || 'Pending'}`,
    registration.eventPaymentRequired ? `Amount Due: ${formatCurrency(registration.amountDue)}` : '',
    ...coordinatorLines,
    event.supplyListUrl ? `Supply List: ${event.supplyListUrl}` : '',
    '',
    `${area.areaLabel} Instructions:`,
    instructionText || 'No additional instructions have been provided for this area.'
  ].filter((line) => line !== '').join('\n');
}

function getRegistrationEmailSubjectStatus(status) {
  if (status === 'Waitlisted') {
    return 'Waitlist Confirmation';
  }

  if (status === 'Pending Payment') {
    return 'Payment Pending';
  }

  return 'Registration Confirmation';
}

function getRegistrationEmailHeading(status) {
  if (status === 'Pending Payment') {
    return 'Registration Pending Payment';
  }

  if (status === 'Registered') {
    return 'Registration Confirmation';
  }

  return `${status} Confirmation`;
}

function getRegistrationEmailIntro(area, registration) {
  if (registration.status === 'Waitlisted') {
    return `Your ${area.areaLabel.toLowerCase()} waitlist request has been received.`;
  }

  if (registration.status === 'Pending Payment') {
    return `Your ${area.areaLabel.toLowerCase()} registration has been received and is pending payment.`;
  }

  if (registration.paymentPreference === 'cash-check-later') {
    return `Your ${area.areaLabel.toLowerCase()} registration has been received. Payment is pending until cash or check is received.`;
  }

  return `Your ${area.areaLabel.toLowerCase()} registration has been received.`;
}

function buildMembershipConfirmationHtml({ area, coordinatorContact, instructionText, isReactivation, profile }) {
  const logoUrl = `${getAppOrigin()}/assets/village-quilters-logo.png`;
  const instructions = instructionText || 'No additional membership instructions have been provided.';
  const headline = isReactivation ? 'Membership Reactivated' : 'Membership Request Received';
  const intro = isReactivation
    ? 'Your membership profile has been reactivated.'
    : 'Your online membership request has been received and is pending review.';
  const contactHtml = buildCoordinatorContactHtml(coordinatorContact);

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f3eee8;color:#1d2927;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#f3eee8;padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" style="width:100%;max-width:680px;border-collapse:collapse;background:#fffdfa;border:1px solid #ded5ca;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:#225c56;color:#fffaf5;">
                <table role="presentation" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="width:58px;vertical-align:middle;">
                      <img alt="Village Quilters" src="${escapeHtml(logoUrl)}" width="48" height="48" style="display:block;border-radius:10px;" />
                    </td>
                    <td style="vertical-align:middle;">
                      <p style="margin:0 0 5px;color:#f3c6a8;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">The Village Quilters, Inc.</p>
                      <h1 style="margin:0;color:#fffaf5;font-size:24px;line-height:1.25;">${escapeHtml(headline)}</h1>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">Hello ${escapeHtml(profile.name || profile.email)},</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">${escapeHtml(intro)}</p>
                <section style="margin:0 0 18px;padding:16px;border:1px solid #e3d9ce;background:#fbf8f3;">
                  <h2 style="margin:0 0 12px;color:#225c56;font-size:19px;line-height:1.3;">Membership Summary</h2>
                  ${buildDetailRowHtml('Name', profile.name || '')}
                  ${buildDetailRowHtml('Email', profile.email || '')}
                  ${buildDetailRowHtml('Phone', profile.phone || '')}
                  ${buildDetailRowHtml('Membership Status', profile.membershipStatus || 'Pending')}
                </section>
                ${contactHtml}
                <section style="margin:0 0 18px;padding:16px;border:1px solid #e3d9ce;background:#ffffff;">
                  <h2 style="margin:0 0 8px;color:#225c56;font-size:17px;line-height:1.3;">${escapeHtml(area.areaLabel)} Instructions</h2>
                  <p style="margin:0;white-space:pre-wrap;font-size:15px;line-height:1.55;">${escapeHtml(instructions)}</p>
                </section>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#225c56;color:#fffaf5;">
                <p style="margin:0;color:#fffaf5;font-size:13px;line-height:1.5;">The Village Quilters, Inc.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildMembershipConfirmationText({ area, coordinatorContact, instructionText, isReactivation, profile }) {
  const coordinatorLines = buildCoordinatorContactText(coordinatorContact);

  return [
    isReactivation
      ? 'The Village Quilters, Inc. Membership Reactivated'
      : 'The Village Quilters, Inc. Membership Request Received',
    '',
    `Hello ${profile.name || profile.email},`,
    '',
    isReactivation
      ? 'Your membership profile has been reactivated.'
      : 'Your online membership request has been received and is pending review.',
    '',
    `Name: ${profile.name || ''}`,
    `Email: ${profile.email || ''}`,
    `Phone: ${profile.phone || ''}`,
    `Membership Status: ${profile.membershipStatus || 'Pending'}`,
    ...coordinatorLines,
    '',
    `${area.areaLabel} Instructions:`,
    instructionText || 'No additional membership instructions have been provided.'
  ].join('\n');
}

async function getCoordinatorContact(db, areaId) {
  const snapshot = await db.collection('coordinatorAssignments').doc(areaId).get();

  if (!snapshot.exists) {
    return { email: '', name: '' };
  }

  const assignment = snapshot.data();

  if (assignment.isActive === false) {
    return { email: '', name: '' };
  }

  return {
    email: cleanText(assignment.contactEmailOverride || assignment.assignedUserEmail),
    name: cleanText(assignment.assignedUserName)
  };
}

function buildCoordinatorContactHtml(contact = {}) {
  const name = cleanText(contact.name);
  const email = cleanText(contact.email);

  if (!name && !email) {
    return '';
  }

  return `
                <section style="margin:0 0 18px;padding:16px;border:1px solid #d6e3df;background:#f2f8f6;">
                  <h2 style="margin:0 0 8px;color:#225c56;font-size:17px;line-height:1.3;">For questions contact:</h2>
                  ${name ? `<p style="margin:0 0 6px;font-size:15px;line-height:1.45;"><strong style="color:#1d2927;">Name:</strong> ${escapeHtml(name)}</p>` : ''}
                  ${email ? `<p style="margin:0;font-size:15px;line-height:1.45;"><strong style="color:#1d2927;">Email:</strong> <a href="mailto:${escapeHtml(email)}" style="color:#225c56;font-weight:700;">${escapeHtml(email)}</a></p>` : ''}
                </section>`;
}

function buildCoordinatorContactText(contact = {}) {
  const name = cleanText(contact.name);
  const email = cleanText(contact.email);

  if (!name && !email) {
    return [];
  }

  return [
    '',
    'For questions contact:',
    name ? `Name: ${name}` : '',
    email ? `Email: ${email}` : ''
  ].filter(Boolean);
}

function getEmailInstructionArea(eventType) {
  if (['Class (Half Day)', 'Class (Full Day)', 'Class (Half-Day)', 'Class (Full-Day)', 'Lecture', 'Retreat'].includes(eventType)) {
    return { areaId: 'programs', areaLabel: 'Programs' };
  }

  if (eventType === 'Workshop') {
    return { areaId: 'workshops', areaLabel: 'Workshops' };
  }

  if (eventType === 'Challenges') {
    return { areaId: 'challenges', areaLabel: 'Challenges' };
  }

  return { areaId: 'programs', areaLabel: 'Programs' };
}

function getAppOrigin() {
  return process.env.APP_ORIGIN
    || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`
    || 'https://vq-event-management.vercel.app';
}

function formatEventDate(value) {
  if (!value) {
    return 'Date TBD';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${month}/${day}/${year}`;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    }).format(parsed);
}

function formatTimeRange(startTime, endTime) {
  if (!startTime || !endTime) {
    return 'Time TBD';
  }

  return `${formatClockTime(startTime)} - ${formatClockTime(endTime)}`;
}

function formatClockTime(value) {
  const [hourText, minute = '00'] = String(value || '').split(':');
  const hour = Number(hourText || 0);
  const suffix = hour >= 12 ? 'p.m.' : 'a.m.';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency'
  }).format(Number(value || 0));
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
