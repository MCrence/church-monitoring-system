function parsePositiveAmountCents(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000
    ? cents
    : null;
}

function parseBalanceCents(value) {
  const text = String(value ?? '0').trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : null;
}

function calculateAllowanceBalance(previousBalance, amountCents, transactionType) {
  const previousCents = parseBalanceCents(previousBalance);
  if (previousCents === null) {
    return { error: 'The current allowance balance is invalid' };
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { error: 'Enter a valid positive amount' };
  }
  if (transactionType !== 'add' && transactionType !== 'deduct') {
    return { error: 'Select whether to add or deduct an allowance amount' };
  }
  if (transactionType === 'deduct' && amountCents > previousCents) {
    return { error: 'The deduction cannot exceed the available balance' };
  }
  const updatedCents = previousCents + (transactionType === 'add' ? amountCents : -amountCents);
  if (updatedCents > 100_000_000) return { error: 'The available balance cannot exceed 1,000,000.00' };
  return {
    previousBalance: (previousCents / 100).toFixed(2),
    updatedBalance: (updatedCents / 100).toFixed(2),
  };
}

function calculateReversalBalance(previousBalance, amountCents, originalType) {
  const reversalType = originalType === 'add' ? 'deduct' : 'add';
  return calculateAllowanceBalance(previousBalance, amountCents, reversalType);
}

module.exports = {
  calculateAllowanceBalance,
  calculateReversalBalance,
  parseBalanceCents,
  parsePositiveAmountCents,
};
