const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePositiveAmountCents } = require('./amount-utils');

test('parses positive monetary values accurately to cents', () => {
  assert.equal(parsePositiveAmountCents('12'), 1200);
  assert.equal(parsePositiveAmountCents('12.3'), 1230);
  assert.equal(parsePositiveAmountCents('12.34'), 1234);
  for (const value of ['0', '0.00', '-1', '1.234', '1e2', '1,000', '1000000.01', '']) {
    assert.equal(parsePositiveAmountCents(value), null);
  }
});
