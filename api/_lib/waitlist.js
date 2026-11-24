import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  generateRegistrationToken,
  getTimestampMillis,
  hashVerificationSecret,
  verificationSecretsMatch
} from './registration-verification.js';
import { hasAvailableSeat, isSeatHoldingRegistration } from './registration-capacity.js';
import { isWaitlistEnabled } from '../../shared/registrationWindow.js';

// One day, on request, down from three.
//
// The earlier three-day figure was chosen to stay clear of the once-daily
// cron, on the reasoning that a shorter window "could expire before the cron
// gets a chance to check it". That does not actually happen:
// expireStaleWaitlistOffers queries waitlistOfferExpiresAt < now, which
// catches an expired offer however long ago it expired, and the seat itself
// is released the instant the offer lapses, because isSeatHoldingRegistration
// only counts an offer with expiresAt in the future. Nothing is ever stranded
// waiting for the sweep; the sweep only decides how soon the NEXT person is
// told.
//
// Which is what makes a shorter window strictly better for turnover: the
// worst case per unclaimed offer is this window plus up to a day of sweep
// lag, so it drops from about four days to about two. The cost is human
// rather than mechanical - a member who checks email every few days now
// stands to lose a seat they wanted, which is the tradeoff that was accepted
// when this was set.
export const WAITLIST_OFFER_WINDOW_MS = 24 * 60 * 60 * 1000;

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
export async function createNextWaitlistOffer(db, event, {
  allowUnlimitedCapacity = false,
  // Registrations this pass must not pick, however early they joined. The
  // sweep below passes the offers it has just expired: their offer fields are
  // deleted a moment earlier, so without this they are the earliest candidate
  // with no active offer and the "advance to the next person" the sweep
  // exists for handed the same seat straight back to the person who had just
  // let it go.
  excludeRegistrationIds = [],
  notifyWhenExhausted = true
} = {}) {
  const now = Date.now();

  // A waitlist switched off makes no offers, even against people already
  // queued on it. An event can be switched off after a queue has formed, and
  // offering a seat from a waitlist the admin has closed would be the app
  // acting on a rule that has been withdrawn. Those registrations keep their
  // Waitlisted status rather than being cancelled: it is the admin's call what
  // happens to people who were already waiting, not this function's.
  if (!isWaitlistEnabled(event)) {
    return null;
  }

  // An unlimited-capacity event has no seat scarcity, so nothing is ever
  // freed by a cancellation and nobody can be waiting for a seat. Running the
  // rest of this would only produce a coordinator email about a seat that was
  // never contended.
  //
  // The one caller that passes allowUnlimitedCapacity is the capacity-increase
  // hook, where an event being SWITCHED to unlimited is exactly the case this
  // guard was never about: people really are waiting, and every one of them
  // can now be seated.
  if (event.capacityUnlimited && !allowUnlimitedCapacity) {
    return null;
  }

  const waitlistedSnapshot = await db.collection('registrations')
    .where('eventId', '==', event.id)
    .where('status', '==', 'Waitlisted')
    .orderBy('registrationDate', 'asc')
    .get();
  const excluded = new Set(excludeRegistrationIds);
  const candidate = waitlistedSnapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .find((registration) =>
      !excluded.has(registration.id) && !hasActiveWaitlistOfferField(registration, now));

  if (!candidate) {
    // Only worth telling a coordinator when there WAS a waitlist and it could
    // not be drawn from - everyone on it already holds an offer, or the last
    // of them just came off it. An empty waitlist means nobody ever wanted the
    // seat, which is the ordinary case on a cancellation and not news.
    if (!waitlistedSnapshot.empty && notifyWhenExhausted) {
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
  // Sent per offer rather than once per seat-freeing event, because its whole
  // purpose is naming the one person to chase - a coordinator who knows a seat
  // opened but not who got it cannot do anything with that. On a capacity
  // increase that means one email per seat added, which is the information
  // they asked for rather than noise.
  await sendWaitlistOfferCoordinatorEmail(db, {
    event,
    expiresAtMillis,
    registration: candidate
  });

  return { expiresAtMillis, registrationId: candidate.id };
}

// A cancellation frees exactly one seat, so createNextWaitlistOffer makes
// exactly one offer. Raising an event's capacity from 12 to 15 frees three,
// and switching it to unlimited frees as many as there are people waiting -
// so this keeps offering until the seats or the waitlist run out.
//
// The loop terminates on its own and does not need to count seats. Each offer
// it makes writes waitlistOfferExpiresAt onto that registration, which
// isSeatHoldingRegistration counts as occupying a seat, so the availability
// re-check inside createNextWaitlistOffer sees one fewer seat on every pass;
// and the candidate search skips anyone already holding an offer, so nobody
// is offered the same seat twice. The cap below is a guard against malformed
// data, not part of the logic.
//
// notifyWhenExhausted is off throughout: that coordinator email means "a seat
// opened and nobody could be given it", which is news after a cancellation.
// Here it would fire on the last pass of every single capacity increase, which
// is the ordinary ending rather than something to act on.
export const MAX_WAITLIST_OFFERS_PER_EVENT_SAVE = 25;

export async function offerFreedSeatsToWaitlist(db, event) {
  let offersMade = 0;

  while (offersMade < MAX_WAITLIST_OFFERS_PER_EVENT_SAVE) {
    const offer = await createNextWaitlistOffer(db, event, {
      allowUnlimitedCapacity: true,
      notifyWhenExhausted: false
    });

    if (!offer) {
      break;
    }

    offersMade += 1;
  }

  return { offersMade };
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
      // The people whose offers this pass just cleared are not candidates for
      // the seat they have already turned down by silence. Without the
      // exclusion the query above returns them first - oldest signup, no
      // active offer any more - and the sweep re-offers the same seat to the
      // same person every day instead of moving down the queue.
      //
      // They stay Waitlisted and keep their place, so a seat freed later by a
      // cancellation can still reach them; it is only this seat, on this
      // pass, that moves on. If nobody else is waiting, no offer is made and
      // the coordinator is emailed - the seat is genuinely free by then and
      // shows as available on the listing, so anyone can simply register.
      await createNextWaitlistOffer(db, { id: eventSnap.id, ...eventSnap.data() }, {
        excludeRegistrationIds: expiredRegistrations.map((registration) => registration.id)
      });
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

// The member has been emailed a claim link, but a link only works if it is
// read. Telling the coordinator who was offered the seat, and when the offer
// lapses, lets them pick up the phone - which for a guild whose members do
// not all live in their inbox is the difference between a seat being claimed
// and a seat going stale for a day.
//
// Shares the sendCoordinatorRegistrationNotifications opt-in with the
// ordinary signup notification: a guild that does not want a coordinator
// inbox tracking registrations does not want this either.
async function sendWaitlistOfferCoordinatorEmail(db, { event, expiresAtMillis, registration }) {
  const emailSettingsSnap = await db.collection('appSettings').doc('emailInstructions').get();
  const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};

  if (emailSettings.sendCoordinatorRegistrationNotifications !== true) {
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY is not configured. Skipping waitlist offer coordinator email.');
    return;
  }

  const area = getEmailInstructionArea(event.eventType);
  const coordinatorContact = await getCoordinatorContact(db, area.areaId);

  if (!coordinatorContact.email) {
    return;
  }

  const eventTitle = event.title || event.eventType || 'Event';
  const deadlineText = formatDeadline(expiresAtMillis);
  const memberName = cleanText(registration.name) || 'A member';
  const memberEmail = cleanText(registration.email);
  const memberPhone = cleanText(registration.phone);
  const printUrl = `${getAppOrigin()}/admin/events/${event.id}/registrations/print`;
  const contactLine = [memberEmail, memberPhone].filter(Boolean).join(' &middot; ');
  const contactText = [memberEmail, memberPhone].filter(Boolean).join(' / ');

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
                <h1 style="margin:0;color:#fffaf5;font-size:24px;line-height:1.25;">Waitlist Seat Offered</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">A seat opened up for <strong>${escapeHtml(eventTitle)}</strong> and has been offered to <strong>${escapeHtml(memberName)}</strong>, who was next on the waitlist.</p>
                ${contactLine ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.55;">${escapeHtml(memberName)}: ${escapeHtml(contactLine)}</p>` : ''}
                <p style="margin:0 0 18px;font-size:15px;line-height:1.55;">They have been emailed a link to claim it, and the offer expires <strong>${escapeHtml(deadlineText)}</strong>. If you would like to be sure they see it in time, it is worth contacting them to ask them to check their email. If they do not claim it, the seat is offered to the next person automatically.</p>
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
    subject: `Waitlist Seat Offered: ${eventTitle}`,
    text: `A seat opened up for ${eventTitle} and has been offered to ${memberName}, who was next on the waitlist.\n\n${contactText ? `${memberName}: ${contactText}\n\n` : ''}They have been emailed a link to claim it, and the offer expires ${deadlineText}. If you would like to be sure they see it in time, it is worth contacting them to ask them to check their email. If they do not claim it, the seat is offered to the next person automatically.\n\nView Registrations: ${printUrl}`,
    to: coordinatorContact.email
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
