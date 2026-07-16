import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initializeAdminApp } from './_lib/public-event-feed.js';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const app = initializeAdminApp();
    const db = getFirestore();

    if (request.body?.action === 'sendMembershipConfirmation') {
      await handleMembershipConfirmationRequest(request, response, db, app.options.projectId);
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

    const result = await createRegistration(db, payload);
    const confirmationContext = result.confirmationContext;

    delete result.confirmationContext;

    if (confirmationContext) {
      await sendRegistrationConfirmationEmail(db, confirmationContext).catch((emailError) => {
        console.error('Registration confirmation email failed', emailError);
      });

      if (confirmationContext.profileReactivated) {
        await sendMembershipConfirmationEmail(db, {
          kind: 'reactivation',
          profile: confirmationContext.profile
        }).catch((emailError) => {
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

async function createRegistration(db, payload) {
  const eventRef = db.collection('events').doc(payload.eventId);
  const registrationRef = db.collection('registrations').doc();
  const auditRef = db.collection('auditLogs').doc();

  return db.runTransaction(async (transaction) => {
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

    validateRegistrationEligibility(event, {
      membershipStatus,
      phone: payload.phone,
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
      ['Registered', 'Waitlisted'].includes(registration.status)
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
    const hasCapacity = Boolean(event.capacityUnlimited) || registeredCount < Number(event.capacity || 0);
    const status = hasCapacity ? 'Registered' : 'Waitlisted';
    const isPaidEvent = Boolean(event.isPaid) && Number(event.cost || 0) > 0;
    const eventCost = Number(event.cost || 0);
    const eventServiceFee = Number(event.serviceFee || 0);
    const amountDue = isPaidEvent ? eventCost + eventServiceFee : 0;
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
      name: payload.name,
      membershipStatusAtRegistration: membershipStatus,
      paymentMethod: 'None',
      paymentNote: '',
      paymentStatus: isPaidEvent ? 'Pending' : 'Paid',
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
  { membershipStatus, phone, profile, profileStatus, reactivateProfile }
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

  if (!doesPhoneMatchProfile(profile, phone)) {
    throw httpError(403, 'The phone number does not match the membership record for this email address.');
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
    name: normalizeName(payload.name || ''),
    phone: String(payload.phone || '').trim(),
    profileUserId: String(payload.profileUserId || '').trim(),
    profileUpdates: sanitizeProfileUpdates(payload.profileUpdates || {}),
    reactivateProfile: Boolean(payload.reactivateProfile),
    reactivationTermsAccepted: Boolean(payload.reactivationTermsAccepted),
    termsVersion: String(payload.termsVersion || '').trim()
  };
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function doesPhoneMatchProfile(profile, phone) {
  const memberPhone = normalizePhone(profile?.phone || '');
  const submittedPhone = normalizePhone(phone);

  if (!memberPhone) {
    return true;
  }

  return Boolean(submittedPhone) && memberPhone === submittedPhone;
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
  const replyTo = await getCoordinatorReplyTo(db, area.areaId);
  const subjectStatus = registration.status === 'Waitlisted' ? 'Waitlist Confirmation' : 'Registration Confirmation';

  await sendResendEmail({
    html: buildRegistrationConfirmationHtml({
      area,
      event,
      instructionText,
      registration
    }),
    replyTo,
    subject: `Village Quilters ${subjectStatus}: ${event.title || event.eventType || 'Event'}`,
    text: buildRegistrationConfirmationText({
      area,
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
  const replyTo = await getCoordinatorReplyTo(db, area.areaId);
  const isReactivation = kind === 'reactivation';

  await sendResendEmail({
    html: buildMembershipConfirmationHtml({
      area,
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

function buildRegistrationConfirmationHtml({ area, event, instructionText, registration }) {
  const logoUrl = `${getAppOrigin()}/assets/village-quilters-logo.png`;
  const eventTitle = event.title || event.eventType || 'Event';
  const supplyListUrl = event.supplyListUrl || '';
  const instructions = instructionText || 'No additional instructions have been provided for this area.';

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
                      <h1 style="margin:0;color:#fffaf5;font-size:24px;line-height:1.25;">${escapeHtml(registration.status)} Confirmation</h1>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">Hello ${escapeHtml(registration.name)},</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">Your ${escapeHtml(area.areaLabel.toLowerCase())} ${registration.status === 'Waitlisted' ? 'waitlist request' : 'registration'} has been received.</p>
                <section style="margin:0 0 18px;padding:16px;border:1px solid #e3d9ce;background:#fbf8f3;">
                  <h2 style="margin:0 0 12px;color:#225c56;font-size:19px;line-height:1.3;">${escapeHtml(eventTitle)}</h2>
                  ${buildDetailRowHtml('Status', registration.status)}
                  ${buildDetailRowHtml('Event Type', event.eventType || 'Event')}
                  ${buildDetailRowHtml('Date', formatEventDate(event.date))}
                  ${buildDetailRowHtml('Time', formatTimeRange(event.startTime, event.endTime))}
                  ${buildDetailRowHtml('Location', event.location || 'To be announced')}
                  ${buildDetailRowHtml('Presenter', event.presenter || 'To be announced')}
                  ${buildDetailRowHtml('Payment Status', registration.paymentStatus || 'Pending')}
                  ${registration.eventPaymentRequired ? buildDetailRowHtml('Amount Due', formatCurrency(registration.amountDue)) : ''}
                </section>
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

function buildRegistrationConfirmationText({ area, event, instructionText, registration }) {
  return [
    `The Village Quilters, Inc. ${registration.status} Confirmation`,
    '',
    `Hello ${registration.name},`,
    '',
    `Your ${area.areaLabel.toLowerCase()} ${registration.status === 'Waitlisted' ? 'waitlist request' : 'registration'} has been received.`,
    '',
    `Event: ${event.title || event.eventType || 'Event'}`,
    `Status: ${registration.status}`,
    `Event Type: ${event.eventType || 'Event'}`,
    `Date: ${formatEventDate(event.date)}`,
    `Time: ${formatTimeRange(event.startTime, event.endTime)}`,
    `Location: ${event.location || 'To be announced'}`,
    `Presenter: ${event.presenter || 'To be announced'}`,
    `Payment Status: ${registration.paymentStatus || 'Pending'}`,
    registration.eventPaymentRequired ? `Amount Due: ${formatCurrency(registration.amountDue)}` : '',
    event.supplyListUrl ? `Supply List: ${event.supplyListUrl}` : '',
    '',
    `${area.areaLabel} Instructions:`,
    instructionText || 'No additional instructions have been provided for this area.'
  ].filter((line) => line !== '').join('\n');
}

function buildMembershipConfirmationHtml({ area, instructionText, isReactivation, profile }) {
  const logoUrl = `${getAppOrigin()}/assets/village-quilters-logo.png`;
  const instructions = instructionText || 'No additional membership instructions have been provided.';
  const headline = isReactivation ? 'Membership Reactivated' : 'Membership Request Received';
  const intro = isReactivation
    ? 'Your membership profile has been reactivated.'
    : 'Your online membership request has been received and is pending review.';

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

function buildMembershipConfirmationText({ area, instructionText, isReactivation, profile }) {
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
    '',
    `${area.areaLabel} Instructions:`,
    instructionText || 'No additional membership instructions have been provided.'
  ].join('\n');
}

async function getCoordinatorReplyTo(db, areaId) {
  const snapshot = await db.collection('coordinatorAssignments').doc(areaId).get();

  if (!snapshot.exists) {
    return '';
  }

  const assignment = snapshot.data();

  if (assignment.isActive === false) {
    return '';
  }

  return cleanText(assignment.contactEmailOverride || assignment.assignedUserEmail);
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
