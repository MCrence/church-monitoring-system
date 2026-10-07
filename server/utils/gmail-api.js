const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function createRawMessage({ from, to, subject, text }) {
  if (/[\r\n]/.test(from) || /[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    throw new Error('Email headers must not contain line breaks');
  }
  const fromAddress = from.match(/<([^<>]+)>/)?.[1] || from;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    throw new Error('Gmail sender must be a valid email address');
  }

  const encodedBody = Buffer.from(text, 'utf8').toString('base64');
  const body = encodedBody.match(/.{1,76}/g)?.join('\r\n') || '';
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(message, 'utf8').toString('base64url');
}

async function sendEmailWithGmailApi({
  clientId,
  clientSecret,
  refreshToken,
  from,
  to,
  subject,
  text,
  fetchImpl = globalThis.fetch,
}) {
  if (!clientId || !clientSecret || !refreshToken || !from) {
    throw new Error('Gmail API credentials or sender are not configured');
  }
  if (typeof fetchImpl !== 'function') throw new Error('HTTP email delivery is unavailable');

  const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google OAuth token endpoint returned HTTP ${tokenResponse.status}`);
  }
  const tokenBody = await tokenResponse.json();
  if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token) {
    throw new Error('Google OAuth token endpoint returned no access token');
  }

  const response = await fetchImpl(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: createRawMessage({ from, to, subject, text }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Gmail API email delivery failed with HTTP ${response.status}`);
  }
}

module.exports = { createRawMessage, sendEmailWithGmailApi };
