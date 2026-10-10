const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSponsor } = require('./sponsor-utils');

test('trims and validates a complete sponsor profile', () => {
  assert.deepEqual(
    validateSponsor({ familyName: '  Dela Cruz ', sex: 'Female', sponsorType: 'Family' }),
    {
      familyName: 'Dela Cruz',
      sex: 'Female',
      sponsorType: 'Family',
      errors: {},
    },
  );
});

test('rejects missing family names and unsupported sponsor classifications', () => {
  const result = validateSponsor({
    familyName: ' ',
    sex: 'Prefer not to say',
    sponsorType: 'Organization',
  });
  assert.deepEqual(Object.keys(result.errors).sort(), ['familyName', 'sex', 'sponsorType']);
});

test('limits family name length', () => {
  const result = validateSponsor({
    familyName: 'A'.repeat(101),
    sex: 'Male',
    sponsorType: 'Individual',
  });
  assert.equal(result.errors.familyName, 'Family name must be 100 characters or fewer.');
});
