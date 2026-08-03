import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  generateRegistrationToken,
  getTimestampMillis,
  hashVerificationSecret,
  verificationSecretsMatch
} from './registration-verification.js';
import { hasAvailableSeat, isSeatHoldingRegistration } from './registration-capacity.js';

// Checked once daily by the cron entry point in api/create-registration.js -
// Vercel's Hobby plan caps cron jobs at once per day, so this window has to
// be generous enough to absorb that granularity rather than promising a
// precise "48 hours" the infrastructure cannot actually enforce.
export const WAITLIST_OFFER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function buildWaitlistOfferToken(registrationId) {
  const token = generateRegistrationToken();
  return { token, tokenHash: hashVerificationSecret(registrationId, token) };
}

export function waitlistOfferTokenMatches(registrationId, token, tokenHash) {
  return verificationSecretsMatch(tokenHash, registrationId, token);
}

// Finds the next eligible Waitlisted registration for an event, offers it
// the seat (holding it via the waitlistOffer* fields, which
// isSeatHoldingRegistration now recognizes), and emails them a claim link.
// Called both right after a cancellation frees a seat and, for offers that
// go unclaimed, by the daily cron sweep advancing to the next person.
export async function createNextWaitlistOffer(db, event) {
  const now = Date.now();

  // An unlimited-capacity event has no seat scarcity, so nothing is ever
  // freed by a cancellation and nobody can be waiting for a seat. Running the
  // rest of this would only produce a coordinator email about a seat that was
  // never contended.
  if (event.capacityUnlimited) {
    return null;
  }

  const waitlistedSnapshot = await db.collection('registrations')
    .where('eventId', '==', event.id)
    .where('status', '==', 'Waitlisted')
    .orderBy('registrationDate', 'asc')
    .get();
  const candidate = waitlistedSnapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .find((registration) => !hasActiveWaitlistOfferField(registration, now));

  if (!candidate) {
    // Only worth telling a coordinator when there WAS a waitlist and it could
    // not be drawn from - everyone on it already holds an offer, or the last
    // of them just came off it. An empty waitlist means nobody ever wanted the
    // seat, which is the ordinary case on a cancellation and not news.
    if (!waitlistedSnapshot.empty) {
      await sendWaitlistExhaustedEmail(db, event);
    }

    return null;
  }

  // Defensive re-check: time may have passed (cron path) or a concurrent
  // write may have landed since whatever just freed this seat committed.
  const allRegistrationsSnapshot = await db.collection('registrations')
    .where('eventId', '==', event.id)
    .get();
  const activeSeatCount = allRegistrationsSnapshot.docs
    .map((docSnapshot) => docSnapshot.data())
    .filter((registration) => isSeatHoldingRegistration(registration, now)).length;

  if (!hasAvailableSeat({ activeSeatCount, event })) {
    return null;
  }

  const { token, tokenHash } = buildWaitlistOfferToken(candidate.id);
  const expiresAtMillis = now + WAITLIST_OFFER_WINDOW_MS;

  await db.collection('registrations').doc(candidate.id).update({
    waitlistOfferedAt: Timestamp.fromMillis(now),
    waitlistOfferExpiresAt: Timestamp.fromMillis(expiresAtMillis),
    waitlistOfferTokenHash: tokenHash
  });

  await sendWaitlistOfferEmail(db, { event, expiresAtMillis, registration: candidate, token });

  return { expiresAtMillis, registrationId: candidate.id };
}

// Sweeps every event with an unclaimed, expired offer and advances each to
// the next person on that event's waitlist. Intended to be called once a
// day by the cron entry point.
export async function expireStaleWaitlistOffers(db) {
  const now = Date.now();
  const expiredSnapshot = await db.collection('registrations')
    .where('status', '==', 'Waitlisted')
    .where('waitlistOfferExpiresAt', '<', Timestamp.fromMillis(now))
    .get();
  const expiredByEventId = new Map();

  expiredSnapshot.docs.forEach((docSnapshot) => {
    const registration = { id: docSnapshot.id, ...docSnapshot.data() };
    const existing = expiredByEventId.get(registration.eventId) || [];
    existing.push(registration);
    expiredByEventId.set(registration.eventId, existing);
  });

  for (const [eventId, expiredRegistrations] of expiredByEventId) {
    await Promise.all(expiredRegistrations.map((registration) =>
      db.collection('registrations').doc(registration.id).update({
        waitlistOfferedAt: FieldValue.delete(),
        waitlistOfferExpiresAt: FieldValue.delete(),
        waitlistOfferTokenHash: FieldValue.delete()
      })));

    const eventSnap = await db.collection('events').doc(eventId).get();

    if (eventSnap.exists) {
      await createNextWaitlistOffer(db, { id: eventSnap.id, ...eventSnap.data() });
    }
  }

  return { eventsProcessed: expiredByEventId.size };
}

function hasActiveWaitlistOfferField(registration, now) {
  const expiresAt = getTimestampMillis(registration.waitlistOfferExpiresAt);
  return Boolean(expiresAt) && expiresAt > now;
}

async function sendWaitlistOfferEmail(db, { event, expiresAtMillis, registration, token }) {
  const emailSettingsSnap = await db.collection('appSettings').doc('emailInstructions').get();
  const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};

  if (emailSettings.sendRegistrationConfirmations !== true) {
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY is not configured. Skipping waitlist offer email.');
    return;
  }

  const eventTitle = event.title || event.eventType || 'Event';
  const claimUrl = `${getAppOrigin()}/waitlist-claim?registrationId=${encodeURIComponent(registration.id)}&token=${encodeURIComponent(token)}`;
  const deadlineText = formatDeadline(expiresAtMillis);

  await sendResendEmail({
    html: buildWaitlistOfferHtml({ claimUrl, deadlineText, eventTitle, registration }),
    subject: `A Seat Opened Up: ${eventTitle}`,
    text: buildWaitlistOfferText({ claimUrl, deadlineText, eventTitle, registration }),
    to: registration.email
  });
}

async function sendWaitlistExhaustedEmail(db, event) {
  const emailSettingsSnap = await db.collection('appSettings').doc('emailInstructions').get();
  const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};

  if (emailSettings.sendCoordinatorRegistrationNotifications !== true) {
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY is not configured. Skipping waitlist-exhausted coordinator email.');
    return;
  }

  const area = getEmailInstructionArea(event.eventType);
  const coordinatorContact = await getCoordinatorContact(db, area.areaId);

  if (!coordinatorContact.email) {
    return;
  }

  const eventTitle = event.title || event.eventType || 'Event';
  const printUrl = `${getAppOrigin()}/admin/events/${event.id}/registrations/print`;

  await sendResendEmail({
    html: `<!doctype html>
<html>
  <body style="margin:0;background:#f3eee8;color:#1d2927;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#f3eee8;padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" style="width:100%;max-width:680px;border-collapse:collapse;background:#fffdfa;border:1px solid #ded5ca;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:#225c56;color:#fffaf5;">
                <h1 style="margin:0;color:#fffaf5;font-size:24px;line-height:1.25;">Waitlist Seat Open</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">A seat opened up for <strong>${escapeHtml(eventTitle)}</strong>, but the waitlist is empty - there is no one left to offer it to automatically.</p>
                <p style="margin:0;">
                  <a href="${escapeHtml(printUrl)}" style="display:inline-block;background:#225c56;color:#fffaf5;text-decoration:none;font-weight:700;padding:10px 14px;border-radius:6px;">View Registrations</a>
                </p>
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
</html>`,
    subject: `Waitlist Empty, Seat Open: ${eventTitle}`,
    text: `A seat opened up for ${eventTitle}, but the waitlist is empty - there is no one left to offer it to automatically.\n\nView Registrations: ${printUrl}`,
    to: coordinatorContact.email
  });
}

function buildWaitlistOfferHtml({ claimUrl, deadlineText, eventTitle, registration }) {
  const logoUrl = `${getAppOrigin()}/assets/village-quilters-logo.png`;

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
                      <h1 style="margin:0;color:#fffaf5;font-size:24px;line-height:1.25;">A Seat Opened Up</h1>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">Hello ${escapeHtml(registration.name)},</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">A seat just opened up for <strong>${escapeHtml(eventTitle)}</strong>, and you're next on the waitlist. Click below to claim it.</p>
                <p style="margin:0 0 18px;">
                  <a href="${escapeHtml(claimUrl)}" style="display:inline-block;background:#225c56;color:#fffaf5;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px;font-size:16px;">Claim My Spot</a>
                </p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.55;">This offer expires <strong>${escapeHtml(deadlineText)}</strong>. If you don't claim it by then, the seat will be offered to the next person on the waitlist.</p>
                ${registration.eventPaymentRequired ? `<p style="margin:0;font-size:15px;line-height:1.55;">This event has a cost of ${escapeHtml(formatCurrency(registration.amountDue))}; you'll be asked to pay when you claim your spot.</p>` : ''}
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

function buildWaitlistOfferText({ claimUrl, deadlineText, eventTitle, registration }) {
  return [
    `The Village Quilters, Inc. A Seat Opened Up`,
    '',
    `Hello ${registration.name},`,
    '',
    `A seat just opened up for ${eventTitle}, and you're next on the waitlist.`,
    '',
    `Claim your spot: ${claimUrl}`,
    '',
    `This offer expires ${deadlineText}. If you don't claim it by then, the seat will be offered to the next person on the waitlist.`,
    registration.eventPaymentRequired ? `This event has a cost of ${formatCurrency(registration.amountDue)}; you'll be asked to pay when you claim your spot.` : ''
  ].filter(Boolean).join('\n');
}

function formatDeadline(millis) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(millis));
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

function getEmailInstructionArea(eventType) {
  if (['Class (Half Day)', 'Class (Full Day)', 'Class (Half-Day)', 'Class (Full-Day)', 'Lecture', 'Retreat', 'Other'].includes(eventType)) {
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
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });

  if (!resendResponse.ok) {
    const errorBody = await resendResponse.text();
    console.error('Waitlist email failed', errorBody);
  }
}

function getAppOrigin() {
  return process.env.APP_ORIGIN
    || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`
    || 'https://vq-event-management.vercel.app';
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
