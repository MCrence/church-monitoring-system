const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

async function sendEmailWithResend({
  apiKey,
  from,
  to,
  subject,
  text,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new Error('Resend API key is not configured');
  if (!from) throw new Error('Email sender is not configured');
  if (typeof fetchImpl !== 'function') throw new Error('HTTP email delivery is unavailable');

  const response = await fetchImpl(RESEND_EMAILS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Resend email delivery failed with HTTP ${response.status}`);
  }
}

module.exports = { sendEmailWithResend };
