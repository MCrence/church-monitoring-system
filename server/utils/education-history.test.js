const test = require('node:test');
const assert = require('node:assert/strict');
const { educationRecordKey, validateEducationRecord } = require('./education-history');

test('education history requires supported level, school, status, and start year', () => {
  assert.deepEqual(validateEducationRecord({
    educationLevel: 'College',
    schoolName: 'FMC University',
    startYear: 2025,
    status: 'Currently Attending',
  }, 2026), []);
});

test('education completion requires end year and rejects reversed years', () => {
  const base = {
    educationLevel: 'Elementary',
    schoolName: 'ABC School',
    startYear: 2014,
    status: 'Graduated',
  };
  assert.ok(validateEducationRecord(base, 2026).includes('End year is required for Graduated or Completed records'));
  assert.ok(validateEducationRecord({ ...base, endYear: 2013 }, 2026).includes('End year cannot be earlier than start year'));
});

test('education identity ignores case and surrounding whitespace', () => {
  assert.equal(
    educationRecordKey({ educationLevel: 'College', schoolName: 'ABC', startYear: 2025, status: 'Currently Attending' }),
    educationRecordKey({ educationLevel: ' college ', schoolName: ' abc ', startYear: '2025', status: ' currently attending ' }),
  );
});
