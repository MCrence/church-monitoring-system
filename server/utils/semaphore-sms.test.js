const test = require('node:test');
const assert = require('node:assert/strict');
const { sendSemaphoreSms } = require('./semaphore-sms');

function response(payload, ok = true) {
  return { ok, json: async () => payload };
}

test('reports queued Semaphore messages as accepted', async () => {
  let request;
  const result = await sendSemaphoreSms({
    apiKey: 'secret',
    senderName: 'FMC',
    number: '+639171234567',
    message: 'A registration was created.',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response([{ message_id: 123, status: 'Queued' }]);
    },
  });
  assert.equal(result.status, 'accepted');
  assert.equal(request.url, 'https://api.semaphore.co/api/v4/messages');
  assert.equal(request.options.method, 'POST');
  assert.equal(new URLSearchParams(request.options.body).get('number'), '+639171234567');
  assert.equal(new URLSearchParams(request.options.body).get('sendername'), 'FMC');
});

test('reports sent messages as sent to the network', async () => {
  const result = await sendSemaphoreSms({
    apiKey: 'secret',
    number: '+639171234567',
    message: 'Notice',
    fetchImpl: async () => response([{ message_id: 123, status: 'Sent' }]),
  });
  assert.deepEqual(result, { status: 'sent', providerStatus: 'Sent' });
});

test('does not report provider or transport failures as sent', async () => {
  const failedResponse = await sendSemaphoreSms({
    apiKey: 'secret',
    number: '+639171234567',
    message: 'Notice',
    fetchImpl: async () => response([{ status: 'Failed' }]),
  });
  const rejectedHttp = await sendSemaphoreSms({
    apiKey: 'secret',
    number: '+639171234567',
    message: 'Notice',
    fetchImpl: async () => response([{ status: 'Queued' }], false),
  });
  assert.equal(failedResponse.status, 'failed');
  assert.equal(rejectedHttp.status, 'failed');
});

test('reports an unset API key without attempting delivery', async () => {
  let called = false;
  const result = await sendSemaphoreSms({
    number: '+639171234567',
    message: 'Notice',
    fetchImpl: async () => { called = true; },
  });
  assert.equal(result.status, 'not_configured');
  assert.equal(called, false);
});
