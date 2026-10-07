const assert = require('node:assert/strict');
const test = require('node:test');

const { sendEmailWithResend } = require('./email-delivery');

test('sends verification mail through the Resend HTTPS API', async () => {
  let request;
  await sendEmailWithResend({
    apiKey: 'test-api-key',
    from: 'FMC Field Care <verified@example.com>',
    to: 'recipient@example.com',
    subject: 'Verify your email',
    text: 'Your verification code is 123456.',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-api-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    from: 'FMC Field Care <verified@example.com>',
    to: 'recipient@example.com',
    subject: 'Verify your email',
    text: 'Your verification code is 123456.',
  });
});

test('reports a non-success response from Resend', async () => {
  await assert.rejects(
    sendEmailWithResend({
      apiKey: 'test-api-key',
      from: 'FMC Field Care <verified@example.com>',
      to: 'recipient@example.com',
      subject: 'Verify your email',
      text: 'Verification code',
      fetchImpl: async () => new Response(null, { status: 422 }),
    }),
    /HTTP 422/,
  );
});

test('requires an API key and verified sender configuration', async () => {
  const email = {
    to: 'recipient@example.com',
    subject: 'Verify your email',
    text: 'Verification code',
    fetchImpl: async () => new Response(null, { status: 200 }),
  };
  await assert.rejects(sendEmailWithResend({ ...email, from: 'FMC Field Care <verified@example.com>' }), /API key/);
  await assert.rejects(sendEmailWithResend({ ...email, apiKey: 'test-api-key' }), /sender/);
});
