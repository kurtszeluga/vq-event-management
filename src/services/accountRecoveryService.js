// Routed through /api/registration-lookup (rather than its own function)
// to stay under Vercel's per-deployment serverless function cap.
export async function startPhoneRecovery(phone) {
  const response = await fetch('/api/registration-lookup', {
    body: JSON.stringify({ action: 'startPhoneRecovery', phone }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Verification code could not be sent.');
  }

  return result;
}

export async function verifyPhoneRecoveryCode({ challengeId, code }) {
  const response = await fetch('/api/registration-lookup', {
    body: JSON.stringify({ action: 'verifyPhoneRecoveryCode', challengeId, code }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Verification failed.');
  }

  return result;
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const bodyText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return { error: bodyText || 'Unexpected server response.' };
    }
  }

  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return { error: bodyText };
  }
}
