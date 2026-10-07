const assert = require('node:assert/strict');
const test = require('node:test');

const { createRawMessage, sendEmailWithGmailApi } = require('./gmail-api');

test('encodes a valid Gmail API message as base64url MIME', () => {
  const raw = createRawMessage({
    from: 'FMC Field Care <sender@gmail.com>',
    to: 'staff@example.com',
    subject: 'Verify your FMC Field Care email address',
    text: 'Your verification code is 012345.',
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /From: FMC Field Care <sender@gmail\.com>/);
  assert.match(decoded, /To: staff@example\.com/);
  assert.match(decoded, /Subject: Verify your FMC Field Care email address/);
  assert.equal(
    Buffer.from(decoded.split('\r\n\r\n').at(-1), 'base64').toString('utf8'),
    'Your verification code is 012345.',
  );
});

test('refreshes a Google access token and sends mail through Gmail API', async () => {
  const calls = [];
  await sendEmailWithGmailApi({
    clientId: 'oauth-client-id',
    clientSecret: 'oauth-client-secret',
    refreshToken: 'oauth-refresh-token',
    from: 'sender@gmail.com',
    to: 'staff@example.com',
    subject: 'Verify your email',
    text: 'Your code is 012345.',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'short-lived-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer short-lived-token');
  const payload = JSON.parse(calls[1].options.body);
  assert.match(Buffer.from(payload.raw, 'base64url').toString('utf8'), /To: staff@example\.com/);
});

test('surfaces Google OAuth and Gmail API HTTP failures', async (t) => {
  await t.test('OAuth token refresh failed', async () => {
    await assert.rejects(
      sendEmailWithGmailApi({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
        from: 'sender@gmail.com',
        to: 'staff@example.com',
        subject: 'Verify',
        text: 'Code',
        fetchImpl: async () => new Response(null, { status: 400 }),
      }),
      /token endpoint returned HTTP 400/,
    );
  });

  await t.test('Gmail send failed', async () => {
    await assert.rejects(
      sendEmailWithGmailApi({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
        from: 'sender@gmail.com',
        to: 'staff@example.com',
        subject: 'Verify',
        text: 'Code',
        fetchImpl: async (url) => url === 'https://oauth2.googleapis.com/token'
          ? new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 })
          : new Response(null, { status: 403 }),
      }),
      /Gmail API email delivery failed with HTTP 403/,
    );
  });
});

test('requires credentials and rejects header injection in sender', async () => {
  await assert.rejects(
    sendEmailWithGmailApi({
      from: 'sender@gmail.com',
      to: 'staff@example.com',
      subject: 'Verify',
      text: 'Code',
    }),
    /credentials or sender/,
  );
  assert.throws(
    () => createRawMessage({
      from: 'sender@gmail.com\r\nBcc: attacker@example.com',
      to: 'staff@example.com',
      subject: 'Verify',
      text: 'Code',
    }),
    /line breaks/,
  );
});
