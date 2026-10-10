const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateAllowanceBalance,
  calculateReversalBalance,
  parseBalanceCents,
  parsePositiveAmountCents,
} = require('./allowance-utils');

test('parses positive monetary values accurately to cents', () => {
  assert.equal(parsePositiveAmountCents('12'), 1200);
  assert.equal(parsePositiveAmountCents('12.3'), 1230);
  assert.equal(parsePositiveAmountCents('12.34'), 1234);
  for (const value of ['0', '0.00', '-1', '1.234', '1e2', '1,000', '1000000.01', '']) {
    assert.equal(parsePositiveAmountCents(value), null);
  }
});

test('parses integer and decimal balance values as dollars', () => {
  assert.equal(parseBalanceCents('10'), 1000);
  assert.equal(parseBalanceCents('10.1'), 1010);
  assert.equal(parseBalanceCents('10.10'), 1010);
});

test('adds and deducts without floating point balance drift', () => {
  assert.deepEqual(calculateAllowanceBalance('10', 20, 'deduct'), {
    previousBalance: '10.00',
    updatedBalance: '9.80',
  });
  assert.deepEqual(calculateAllowanceBalance('10.10', 20, 'add'), {
    previousBalance: '10.10',
    updatedBalance: '10.30',
  });
  assert.deepEqual(calculateAllowanceBalance('10.30', 20, 'deduct'), {
    previousBalance: '10.30',
    updatedBalance: '10.10',
  });
});

test('rejects invalid deductions and caps the balance', () => {
  assert.match(calculateAllowanceBalance('10.00', 1001, 'deduct').error, /exceed/);
  assert.match(calculateAllowanceBalance('999999.99', 2, 'add').error, /cannot exceed/);
  assert.match(calculateAllowanceBalance('1.00', 100, 'invalid').error, /Select/);
});

test('creates a compensating reversal balance in the opposite direction', () => {
  assert.deepEqual(calculateReversalBalance('20.00', 500, 'add'), {
    previousBalance: '20.00',
    updatedBalance: '15.00',
  });
  assert.deepEqual(calculateReversalBalance('20.00', 500, 'deduct'), {
    previousBalance: '20.00',
    updatedBalance: '25.00',
  });
  assert.match(calculateReversalBalance('2.00', 500, 'add').error, /exceed/);
});
