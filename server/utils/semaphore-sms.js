const SEMAPHORE_MESSAGES_URL = 'https://api.semaphore.co/api/v4/messages';

async function sendSemaphoreSms({ apiKey, senderName, number, message, fetchImpl = fetch }) {
  if (!apiKey) return { status: 'not_configured' };

  const body = new URLSearchParams({ apikey: apiKey, number, message });
  if (senderName) body.set('sendername', senderName);

  const response = await fetchImpl(SEMAPHORE_MESSAGES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { status: 'failed' };
  }
  if (!response.ok || !Array.isArray(payload) || !payload.length) {
    return { status: 'failed' };
  }

  const providerStatus = String(payload[0]?.status || '').toLowerCase();
  if (providerStatus === 'sent') {
    return { status: 'sent', providerStatus: 'Sent' };
  }
  if (providerStatus === 'queued' || providerStatus === 'pending') {
    return { status: 'accepted', providerStatus: payload[0].status };
  }
  return {
    status: 'failed',
    ...(payload[0]?.status ? { providerStatus: payload[0].status } : {}),
  };
}

module.exports = { sendSemaphoreSms };
