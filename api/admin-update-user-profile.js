import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getGoogleAccessToken } from './_lib/google-access-token.js';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';
import { applyMemberDirectorySync } from './_lib/member-directory-profile.js';
import { lookupAuthAccounts } from './_lib/auth-account.js';
import { enforceRateLimit } from './_lib/rate-limit.js';

let firebaseProjectId = '';

function initializeAdminApp() {
  const existingApp = getApps()[0];

  if (existingApp) {
    firebaseProjectId = existingApp.options.projectId || firebaseProjectId;
    return existingApp;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  const serviceAccount = parseServiceAccountJson(serviceAccountJson);
  firebaseProjectId = serviceAccount.project_id;

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: firebaseProjectId
  });
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    initializeAdminApp();

    const authHeader = request.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : '';

    if (!idToken) {
      response.status(401).json({ error: 'Missing authorization token.' });
      return;
    }

    const db = getFirestore();
    const decodedToken = await verifyFirebaseIdToken(idToken, firebaseProjectId);
    const actorUid = decodedToken.user_id || decodedToken.sub || decodedToken.uid;

    if (!actorUid) {
      response.status(401).json({ error: 'Invalid authorization token.' });
      return;
    }

    const actorSnap = await db.collection('users').doc(actorUid).get();
    const actorProfile = actorSnap.exists ? actorSnap.data() : {};

    await enforceRateLimit(db, {
      keyParts: [actorUid, request.body?.action || 'update'],
      limit: 60,
      message: 'Too many admin profile update requests. Please wait and try again later.',
      request,
      scope: 'admin-update-user-profile',
      windowMs: 10 * 60 * 1000
    });

    if (request.body?.action === 'sendEmailInstructionsTest') {
      await handleSendEmailInstructionsTest(request, response, actorProfile);
      return;
    }

    if (request.body?.action === 'setPassword') {
      await handleSetPassword(request, response, db, actorUid, actorProfile);
      return;
    }

    if (request.body?.action === 'authStatus') {
      await handleAuthStatus(request, response, actorProfile);
      return;
    }

    if (!canUpdateUsers(actorProfile)) {
      response.status(403).json({ error: 'This account cannot update user profiles.' });
      return;
    }

    const targetProfileId = cleanText(request.body?.profileId || request.body?.userId);

    if (!targetProfileId) {
      response.status(400).json({ error: 'User profile ID is required.' });
      return;
    }

    const userRef = db.collection('users').doc(targetProfileId);
    const targetSnap = await userRef.get();

    if (!targetSnap.exists) {
      response.status(404).json({ error: 'User profile was not found.' });
      return;
    }

    const before = targetSnap.data();

    if (!canUpdateTarget(actorProfile, before)) {
      response.status(403).json({ error: 'Admins can only update General User profiles.' });
      return;
    }

    const payload = sanitizePayload(request.body || {}, actorProfile, before, targetProfileId);
    const membershipPayment = sanitizeMembershipPayment(request.body?.membershipPayment);

    if (
      membershipPayment?.status === 'Paid'
      && ['Pending', 'Unknown', 'Inactive'].includes(payload.membershipStatus)
    ) {
      payload.membershipStatus = 'Active';
    }

    if (!payload.firstName || !payload.lastName || !payload.email) {
      response.status(400).json({ error: 'First name, last name, and email are required.' });
      return;
    }

    const now = FieldValue.serverTimestamp();
    const membershipReviewChanged =
      payload.membershipStatus !== (before.membershipStatus || 'Unknown')
      || payload.membershipReviewNote !== (before.membershipReviewNote || '');
    const reviewerName = actorProfile.name || actorProfile.email || 'Unknown Admin';
    const profile = removeUndefinedFields({
      archivedBy: before.archivedBy,
      archivedDate: before.archivedDate,
      billingAddress: payload.billingAddress,
      createdDate: before.createdDate || now,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      membershipMatchedBy: before.membershipMatchedBy || '',
      membershipMemberId: before.membershipMemberId || '',
      membershipPaymentAmount: membershipPayment
        ? Number(membershipPayment.amount || 0)
        : before.membershipPaymentAmount || 0,
      membershipPaymentMethod: membershipPayment
        ? membershipPayment.method || ''
        : before.membershipPaymentMethod || '',
      membershipPaymentNote: membershipPayment
        ? membershipPayment.note || ''
        : before.membershipPaymentNote || '',
      membershipPaymentStatus: membershipPayment
        ? membershipPayment.status || 'Pending'
        : before.membershipPaymentStatus || 'Pending',
      membershipPaymentUpdatedDate: membershipPayment
        ? now
        : before.membershipPaymentUpdatedDate || undefined,
      membershipReviewNote: payload.membershipReviewNote,
      membershipReviewedBy: membershipReviewChanged
        ? reviewerName
        : before.membershipReviewedBy || '',
      membershipReviewedDate: membershipReviewChanged
        ? now
        : before.membershipReviewedDate || undefined,
      membershipStatus: payload.membershipStatus,
      membershipUpdatedDate:
        payload.membershipStatus !== before.membershipStatus
          ? now
          : before.membershipUpdatedDate || now,
      name: payload.name,
      permissions: getPermissionsForRole(payload.role, payload.permissions),
      phone: payload.phone,
      profileTags: payload.profileTags,
      role: payload.role,
      status: payload.status,
      updatedDate: now,
      userId: before.userId || targetProfileId
    });

    if (profileAuthFieldsChanged(before, profile, targetProfileId)) {
      try {
        await updateAuthUser(profile.userId, {
          disabled: profile.status !== 'Active',
          displayName: profile.name,
          email: profile.email
        });
      } catch (authError) {
        if (!String(authError.message || '').includes('USER_NOT_FOUND')) {
          throw authError;
        }

        console.warn('Firebase Auth user was not found for profile update', profile.userId);
      }
    }

    const batch = db.batch();

    batch.set(userRef, profile);
    applyMemberDirectorySync(db, batch, targetProfileId, profile, now);
    if (membershipPayment) {
      const paymentRef = db.collection('payments').doc();

      batch.set(paymentRef, buildMembershipPaymentRecord({
        actorProfile,
        actorUid,
        membershipPayment,
        paymentId: paymentRef.id,
        profile,
        targetProfileId
      }));
    }
    batch.set(db.collection('auditLogs').doc(), {
      action: 'Update',
      actorEmail: actorProfile.email || '',
      actorName: actorProfile.name || actorProfile.email || 'Unknown Admin',
      actorRole: actorProfile.role || '',
      actorUserId: actorProfile.userId || actorUid,
      after: {
        ...profile,
        createdDate: before.createdDate || null,
        membershipUpdatedDate: null,
        updatedDate: null
      },
      before,
      createdDate: now,
      entityId: targetProfileId,
      entityType: 'User',
      summary: `Updated user "${profile.name || profile.email || targetProfileId}"`
    });
    await batch.commit();

    response.status(200).json({
      user: {
        email: profile.email,
        name: profile.name,
        role: profile.role,
        status: profile.status,
        userId: profile.userId
      }
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: error.message });
  }
}

function sanitizePayload(payload, actorProfile, before, profileId) {
  const isSuperUser = actorProfile.role === 'Super User';
  const requestedRole = ['Super User', 'Admin', 'General User'].includes(payload.role)
    ? payload.role
    : before.role || 'General User';
  const canManageMembershipStatus =
    isSuperUser || actorProfile.permissions?.manageMembershipStatus === true;
  const requestedMembershipStatus = ['Pending', 'Active', 'Inactive', 'Archived', 'Unknown'].includes(
    payload.membershipStatus
  )
    ? payload.membershipStatus
    : before.membershipStatus || 'Unknown';
  const requestedMembershipReviewNote = cleanText(payload.membershipReviewNote);
  const status = requestedRole === 'Super User'
    ? 'Active'
    : payload.status === 'Inactive'
      ? 'Inactive'
      : 'Active';
  const membershipStatus = canManageMembershipStatus
    ? requestedMembershipStatus
    : before.membershipStatus || 'Unknown';
  const role = getAllowedRoleForMembership({
    isSuperUser,
    membershipStatus,
    requestedRole,
    status
  });

  return {
    billingAddress: {
      city: cleanText(payload.billingAddress?.city),
      country: cleanText(payload.billingAddress?.country) || 'United States',
      postalCode: cleanText(payload.billingAddress?.postalCode),
      state: cleanText(payload.billingAddress?.state).toUpperCase(),
      street: cleanText(payload.billingAddress?.street)
    },
    email: cleanText(payload.email).toLowerCase(),
    firstName: toTitleCase(cleanText(payload.firstName)),
    lastName: toTitleCase(cleanText(payload.lastName)),
    membershipReviewNote: canManageMembershipStatus
      ? requestedMembershipReviewNote
      : before.membershipReviewNote || '',
    membershipStatus,
    name: buildDisplayName(payload.firstName, payload.lastName),
    permissions: getPermissionsForRole(role, payload.permissions),
    phone: cleanText(payload.phone),
    profileTags: isSuperUser
      ? normalizeProfileTags(payload.profileTags)
      : normalizeProfileTags(before.profileTags),
    role,
    status,
    userId: before.userId || profileId
  };
}

function getAllowedRoleForMembership({ isSuperUser, membershipStatus, requestedRole, status }) {
  if (isSuperUser && requestedRole === 'Super User') {
    return 'Super User';
  }

  if (isSuperUser && requestedRole === 'Admin' && membershipStatus === 'Active' && status === 'Active') {
    return 'Admin';
  }

  return 'General User';
}

// Mirrors USER_PERMISSION_OPTIONS in src/data/userRoles.js - kept literal
// because api/ is bundled separately and cannot import from src/.
const USER_PERMISSION_KEYS = [
  'manageEvents',
  'viewRegistrations',
  'managePayments',
  'addUsers',
  'manageMembershipStatus',
  'registerOthers',
  'manageWaitlist'
];

// Takes the role the server resolved, not the one the caller asked for. That
// matters because getAllowedRoleForMembership() above demotes an Admin whose
// membership or profile status has lapsed: without this, the role dropped to
// General User while every admin flag stayed true underneath it. Nothing
// granted access on that - hasPermission() needs the Admin role - but the
// profile read back as an admin, and Firestore's own hasNoAdminPermissions()
// refuses the shape, which left the record unwritable from the client
// afterwards. A Super User gets the full map: its authority never comes from
// these flags, so a false one only misreports what the account can do.
export function getPermissionsForRole(role, permissions = {}) {
  return USER_PERMISSION_KEYS.reduce(
    (resolved, key) => ({
      ...resolved,
      [key]: role === 'Super User' ? true : role === 'Admin' && Boolean(permissions[key])
    }),
    {}
  );
}

function sanitizeMembershipPayment(payment = null) {
  if (!payment || typeof payment !== 'object') {
    return null;
  }

  const status = ['Pending', 'Paid', 'Refunded', 'Waived'].includes(payment.status)
    ? payment.status
    : 'Pending';
  const note = cleanText(payment.note);

  if (status === 'Pending') {
    if (!note && !Number(payment.amount || 0) && !cleanText(payment.method)) {
      return null;
    }

    return {
      amount: 0,
      method: '',
      note,
      status
    };
  }

  if (status === 'Waived') {
    return {
      amount: 0,
      method: 'Comped',
      note,
      status
    };
  }

  if (status === 'Refunded') {
    if (!note) {
      throw new Error('Enter refund details: when, who approved it, and why.');
    }

    return {
      amount: Number(payment.amount || 0),
      method: cleanText(payment.method),
      note,
      status
    };
  }

  const method = ['Cash', 'Check'].includes(payment.method) ? payment.method : 'Cash';
  const amount = Number(payment.amount || 0);

  if (amount <= 0) {
    throw new Error('Enter the amount received for a membership cash or check payment.');
  }

  return {
    amount,
    method,
    note,
    status: 'Paid'
  };
}

function buildMembershipPaymentRecord({
  actorProfile,
  actorUid,
  membershipPayment,
  paymentId,
  profile,
  targetProfileId
}) {
  return {
    amount: Number(membershipPayment.amount || 0),
    amountDue: 0,
    createdBy: actorProfile.userId || actorUid,
    createdByEmail: actorProfile.email || '',
    createdByName: actorProfile.name || actorProfile.email || 'Unknown Admin',
    createdDate: FieldValue.serverTimestamp(),
    entityId: targetProfileId,
    entityType: 'Membership',
    eventId: '',
    method: membershipPayment.method || '',
    note: membershipPayment.note || '',
    paymentId,
    processor: 'Manual',
    registrationId: '',
    registrationStatus: '',
    squareTransactionId: '',
    status: membershipPayment.status || 'Pending',
    updatedRegistrationSnapshot: {},
    updatedMembershipSnapshot: {
      membershipStatus: profile.membershipStatus || 'Unknown',
      profileStatus: profile.status || 'Active',
      userId: profile.userId || targetProfileId
    }
  };
}

async function handleSetPassword(request, response, db, actorUid, actorProfile) {
  if (actorProfile.role !== 'Super User' || actorProfile.status !== 'Active') {
    response.status(403).json({ error: 'Only active Super Users can change user passwords.' });
    return;
  }

  const userId = cleanText(request.body?.userId || request.body?.profileId);
  const password = request.body?.password;

  if (!userId) {
    response.status(400).json({ error: 'User ID is required.' });
    return;
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    response.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    response.status(404).json({ error: 'User profile was not found.' });
    return;
  }

  const userProfile = userSnap.data();
  await updateAuthUserPassword(userProfile.userId || userId, password);

  await db.collection('auditLogs').doc().set({
    action: 'Update',
    actorEmail: actorProfile.email || '',
    actorName: actorProfile.name || actorProfile.email || 'Unknown Admin',
    actorRole: actorProfile.role || '',
    actorUserId: actorProfile.userId || actorUid,
    after: {
      passwordChanged: true,
      userEmail: userProfile.email || '',
      userName: userProfile.name || ''
    },
    before: {},
    createdDate: FieldValue.serverTimestamp(),
    entityId: userId,
    entityType: 'User',
    summary: `Changed password for user "${userProfile.name || userProfile.email || userId}"`
  });

  response.status(200).json({ ok: true });
}

async function updateAuthUserPassword(localId, password) {
  const accessToken = await getGoogleAccessToken(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${firebaseProjectId}/accounts:update`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        localId,
        password,
        returnSecureToken: false
      })
    }
  );

  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const message = data.error?.message || data.error || 'Firebase Auth request failed.';
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

// Sign-in history for the admin user list: when each member last signed in and
// whether they have a password at all. Read-only, and read live from Firebase
// Auth rather than mirrored onto the profile - Auth already records both, so a
// copy in Firestore would need a write hooked to a client-side auth event plus
// a rules change to permit it, and would drift silently whenever that write
// failed.
//
// This started as its own endpoint, which is the better shape: nothing here
// writes, and the capability it needs is "may see the user list" rather than
// "may change a profile". It lives here because Vercel's Hobby plan caps a
// deployment at 12 serverless functions and api/ was already at exactly 12, so
// a thirteenth file failed the deploy outright. Any future endpoint has the
// same problem - fold it into an existing file, or the plan has to change.
async function handleAuthStatus(request, response, actorProfile) {
  if (!canUpdateUsers(actorProfile)) {
    response.status(403).json({ error: 'This account cannot read sign-in history.' });
    return;
  }

  const requested = Array.isArray(request.body?.userIds) ? request.body.userIds : [];
  // Bounded so one request cannot fan out into an unbounded number of Identity
  // Platform calls. The member list pages well inside this.
  const userIds = requested
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 1000);

  if (!userIds.length) {
    response.status(200).json({ accounts: {} });
    return;
  }

  response.status(200).json({
    accounts: await lookupAuthAccounts(firebaseProjectId, userIds)
  });
}

function canUpdateUsers(actorProfile) {
  if (actorProfile.status !== 'Active') {
    return false;
  }

  return actorProfile.role === 'Super User'
    || actorProfile.role === 'Admin' && actorProfile.permissions?.addUsers === true;
}

async function handleSendEmailInstructionsTest(request, response, actorProfile) {
  if (actorProfile.role !== 'Super User' || actorProfile.status !== 'Active') {
    response.status(403).json({ error: 'Only an active Super User can send test emails.' });
    return;
  }

  const recipientEmail = cleanText(request.body?.recipientEmail).toLowerCase();
  const instructions = normalizeEmailInstructions(request.body?.instructions || {});
  const area = getEmailInstructionArea(request.body?.areaId);
  const replyTo = await getCoordinatorReplyTo(getFirestore(), area.areaId);

  if (!isEmail(recipientEmail)) {
    response.status(400).json({ error: 'Enter a valid test email address.' });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    response.status(501).json({
      error: 'RESEND_API_KEY is not configured yet. Add the Resend API key before sending test emails.'
    });
    return;
  }

  const result = await sendResendEmail({
    html: buildTestEmailHtml(area, instructions[area.areaId]),
    replyTo: replyTo || actorProfile.email || undefined,
    subject: `Village Quilters ${area.areaLabel} Test Confirmation Email`,
    text: buildTestEmailText(area, instructions[area.areaId]),
    to: recipientEmail
  });

  response.status(200).json({
    emailId: result.id || '',
    ok: true
  });
}

function canUpdateTarget(actorProfile, targetProfile) {
  return actorProfile.role === 'Super User' || targetProfile.role === 'General User';
}

function profileAuthFieldsChanged(before, profile, targetProfileId) {
  return (before.userId || targetProfileId) !== profile.userId
    || cleanText(before.email).toLowerCase() !== profile.email
    || cleanText(before.name) !== profile.name
    || (before.status || 'Active') !== profile.status;
}

function normalizeProfileTags(profileTags = []) {
  const allowedTags = ['vqBooking', 'vqHosting'];

  return Array.isArray(profileTags)
    ? profileTags.filter((tag) => allowedTags.includes(tag))
    : [];
}

async function updateAuthUser(localId, { disabled, displayName, email }) {
  return identityPlatformRequest('accounts:update', {
    disableUser: Boolean(disabled),
    displayName,
    email,
    localId,
    returnSecureToken: false
  });
}

async function identityPlatformRequest(methodPath, body) {
  const accessToken = await getGoogleAccessToken(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${firebaseProjectId}/${methodPath}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const message = data.error?.message || data.error || 'Identity Platform request failed.';
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return data;
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
    const message = result.message || result.error || 'Resend could not send the test email.';
    const error = new Error(message);
    error.statusCode = resendResponse.status;
    throw error;
  }

  return result;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildTestEmailHtml(area, instructionText) {
  const logoUrl = `${getAppOrigin()}/assets/village-quilters-logo.png`;
  const instructions = cleanText(instructionText) || 'No instructions entered yet.';

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
                      <h1 style="margin:0;color:#fffaf5;font-size:24px;line-height:1.25;">${escapeHtml(area.areaLabel)} Confirmation Email</h1>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">This is a test message showing how the ${escapeHtml(area.areaLabel)} confirmation instructions will appear.</p>
                <section style="margin:0 0 18px;padding:16px;border:1px solid #e3d9ce;background:#fbf8f3;">
                  <h2 style="margin:0 0 8px;color:#225c56;font-size:17px;line-height:1.3;">${escapeHtml(area.areaLabel)} Instructions</h2>
                  <p style="margin:0;white-space:pre-wrap;font-size:15px;line-height:1.55;">${escapeHtml(instructions)}</p>
                </section>
                <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:18px;background:#f7f1e8;border:1px solid #e4d5c3;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0;color:#5c6966;font-size:13px;line-height:1.5;">Future confirmation emails will include the registration or membership details, coordinator reply-to address, supply list link when available, and the selected area instructions.</p>
                    </td>
                  </tr>
                </table>
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

function buildTestEmailText(area, instructionText) {
  return [
    `Village Quilters ${area.areaLabel} Test Confirmation Email`,
    '',
    `This is a test message showing how the ${area.areaLabel} confirmation instructions will appear.`,
    '',
    `${area.areaLabel} Instructions:`,
    cleanText(instructionText) || 'No instructions entered yet.'
  ].join('\n');
}

function normalizeEmailInstructions(instructions) {
  return {
    challenges: cleanText(instructions.challenges),
    membership: cleanText(instructions.membership),
    programs: cleanText(instructions.programs),
    workshops: cleanText(instructions.workshops)
  };
}

function getEmailInstructionArea(areaId) {
  const areas = [
    { areaId: 'programs', areaLabel: 'Programs' },
    { areaId: 'workshops', areaLabel: 'Workshops' },
    { areaId: 'challenges', areaLabel: 'Challenges' },
    { areaId: 'membership', areaLabel: 'Membership' }
  ];

  return areas.find((area) => area.areaId === areaId) || areas[0];
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

function getAppOrigin() {
  return process.env.APP_ORIGIN
    || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`
    || 'https://vq-event-management.vercel.app';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildDisplayName(firstName, lastName) {
  return [toTitleCase(cleanText(firstName)), toTitleCase(cleanText(lastName))]
    .filter(Boolean)
    .join(' ');
}

function toTitleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function removeUndefinedFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parseServiceAccountJson(serviceAccountJson) {
  const trimmed = String(serviceAccountJson || '').trim();

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    try {
      return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
    } catch {
      throw new Error(`Unable to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}`);
    }
  }
}
