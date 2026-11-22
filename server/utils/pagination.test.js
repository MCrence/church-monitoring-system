const assert = require('node:assert/strict');
const test = require('node:test');

const { parsePage } = require('./pagination');

test('pagination defaults values and caps oversized page sizes', () => {
  assert.deepEqual(parsePage({}, 'page', 'pageSize'), { page: 1, pageSize: 20 });
  assert.deepEqual(
    parsePage({ page: '2', pageSize: '500' }, 'page', 'pageSize'),
    { page: 2, pageSize: 100 },
  );
});

test('pagination rejects malformed, unsafe, and non-positive values', () => {
  for (const query of [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { pageSize: 'abc' },
    { pageSize: '9007199254740992' },
  ]) {
    assert.throws(() => parsePage(query, 'page', 'pageSize'), /positive integer/);
  }
});
