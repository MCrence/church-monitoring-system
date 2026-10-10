const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateAge,
  findPotentialParticipantDuplicates,
  normalizeParticipantName,
  normalizePhilippineMobile,
  participantRegistrationErrors,
} = require('./participant-utils');

test('calculates age by calendar date and rejects invalid or future dates', () => {
  const today = new Date('2025-06-15T12:00:00.000Z');
  assert.equal(calculateAge('2010-06-15', today), 15);
  assert.equal(calculateAge('2010-06-16', today), 14);
  assert.equal(calculateAge('2026-01-01', today), null);
  assert.equal(calculateAge('2010-02-30', today), null);
});

test('normalizes Philippine mobile numbers to E.164', () => {
  assert.equal(normalizePhilippineMobile('0917 123 4567'), '+639171234567');
  assert.equal(normalizePhilippineMobile('639171234567'), '+639171234567');
  assert.equal(normalizePhilippineMobile('+639171234567'), '+639171234567');
  assert.equal(normalizePhilippineMobile('+14155552671'), null);
  assert.equal(normalizePhilippineMobile('0917 123'), null);
});

test('normalizes names without case or whitespace differences', () => {
  assert.equal(normalizeParticipantName('  Ana   Maria Dela Cruz '), 'ana maria dela cruz');
});

test('finds exact and potential participant duplicates', () => {
  const existing = [
    { id: 1, participant_code: 'FMC-1', fullName: 'Ana Cruz', firstName: 'Ana', lastName: 'Cruz', dateOfBirth: '2015-02-10' },
    { id: 2, participant_code: 'FMC-2', fullName: 'Bea Cruz', firstName: 'Bea', lastName: 'Cruz', dateOfBirth: '2015-02-10' },
  ];
  assert.deepEqual(
    findPotentialParticipantDuplicates(
      { fullName: ' ana  CRUZ ', firstName: 'Ana', lastName: 'Cruz', dateOfBirth: '2015-02-10' },
      existing,
    ).map(({ id, exact }) => ({ id, exact })),
    [{ id: 1, exact: true }],
  );
  assert.deepEqual(
    findPotentialParticipantDuplicates(
      { fullName: 'Ana Cruz', firstName: 'Ana', lastName: 'Cruz', dateOfBirth: '2015-02-11' },
      existing,
    ).map(({ id, exact }) => ({ id, exact })),
    [{ id: 1, exact: false }],
  );
});

test('returns inline registration validation errors for missing or invalid required fields', () => {
  const educationLevels = new Set(['Elementary', 'College']);
  const grades = {
    Elementary: new Set(['Grade 1']),
    College: new Set(['Year 1']),
  };
  const errors = participantRegistrationErrors({}, educationLevels, grades);
  assert.deepEqual(
    Object.keys(errors).sort(),
    [
      'dateOfBirth',
      'educationLevel',
      'emergencyContactName',
      'emergencyContactPhone',
      'firstName',
      'gender',
      'lastName',
    ].sort(),
  );
  assert.equal(
    participantRegistrationErrors({
      firstName: 'Ana',
      lastName: 'Cruz',
      dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01`,
      gender: 'Female',
      educationLevel: 'Elementary',
      gradeLevel: 'Grade 1',
      emergencyContactName: 'Guardian',
      emergencyContactPhone: '09171234567',
    }, educationLevels, grades).dateOfBirth,
    undefined,
  );
  assert.equal(
    participantRegistrationErrors({
      firstName: 'Ana',
      lastName: 'Cruz',
      dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01`,
      gender: 'Prefer not to say',
      educationLevel: 'Elementary',
      gradeLevel: 'Grade 1',
      emergencyContactName: 'Guardian',
      emergencyContactPhone: '123',
    }, educationLevels, grades).gender,
    'Select Male or Female.',
  );
});
