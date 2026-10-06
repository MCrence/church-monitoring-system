const assert = require('node:assert/strict');
const test = require('node:test');

const { createPersistentRateLimiter } = require('./persistent-rate-limit');

function makeHarness() {
  const records = new Map();
  const pool = {
    async execute(sql, values) {
      if (sql.startsWith('INSERT INTO security_rate_limits')) {
        const [bucket, clientKey] = values;
        const key = `${bucket}:${clientKey}`;
        const record = records.get(key) || { request_count: 0, retry_after: 900 };
        record.request_count += 1;
        records.set(key, record);
        return [{ affectedRows: 1 }];
      }
      const [bucket, clientKey] = values;
      const record = records.get(`${bucket}:${clientKey}`);
      return [[record]];
    },
  };
  const responses = [];
  const limiter = createPersistentRateLimiter({
    pool,
    tableReady: Promise.resolve(),
    secret: 'test secret',
    bucket: 'staff-login',
    maxRequests: 2,
    windowSeconds: 900,
    message: 'Rate limited',
  });
  return { limiter, records, responses };
}

function request(ip = '192.0.2.1') {
  const state = { statusCode: 200, headers: {}, body: null, nextCalls: 0, nextError: null };
  const res = {
    set(name, value) {
      state.headers[name] = value;
      return this;
    },
    status(code) {
      state.statusCode = code;
      return this;
    },
    json(body) {
      state.body = body;
      return this;
    },
  };
  return {
    req: { ip, socket: { remoteAddress: ip } },
    res,
    state,
    next(error) {
      state.nextCalls += 1;
      state.nextError = error || null;
    },
  };
}

test('persists a per-client request limit and returns retry details when exceeded', async () => {
  const { limiter, records } = makeHarness();
  const first = request();
  const second = request();
  const third = request();

  await limiter(first.req, first.res, first.next);
  await limiter(second.req, second.res, second.next);
  await limiter(third.req, third.res, third.next);

  assert.equal(first.state.nextCalls, 1);
  assert.equal(second.state.nextCalls, 1);
  assert.equal(third.state.statusCode, 429);
  assert.deepEqual(third.state.body, { error: 'Rate limited' });
  assert.equal(third.state.headers['Retry-After'], '900');
  assert.equal(third.state.headers['Cache-Control'], 'no-store');
  assert.equal(records.size, 1);
  assert.equal([...records.keys()][0].includes('192.0.2.1'), false);
});

test('passes persistence errors to Express error handling', async () => {
  const failure = new Error('database unavailable');
  const limiter = createPersistentRateLimiter({
    pool: { execute: async () => { throw failure; } },
    tableReady: Promise.resolve(),
    secret: 'test secret',
    bucket: 'staff-login',
    maxRequests: 2,
    windowSeconds: 900,
    message: 'Rate limited',
  });
  const call = request();

  await limiter(call.req, call.res, call.next);

  assert.equal(call.state.nextError, failure);
});
