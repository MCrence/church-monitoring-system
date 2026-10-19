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

const educationLevels = new Set([
  'Elementary',
  'Junior High School',
  'Senior High School',
  'College',
]);
const grades = {
  Elementary: new Set(['Grade 1']),
  'Junior High School': new Set(['Grade 7']),
  'Senior High School': new Set(['Grade 11']),
  College: new Set(['Year 1']),
};
const registrationToday = new Date('2026-10-19T12:00:00.000Z');
const validRegistration = {
  firstName: '  Juan ',
  middleName: ' Miguel ',
  lastName: ' Dela Cruz ',
  dateOfBirth: '2016-01-01',
  gender: 'Male',
  address: ' 10 Main Street ',
  educationLevel: 'Elementary',
  gradeLevel: 'Grade 1',
  schoolName: 'Agusan National High School',
  schoolAddress: '10 School Road',
  weight: '32.5',
  height: '132.5',
  medicalConditions: 'None reported.',
  emergencyContactName: "Mary Jane Dela-Cruz",
  emergencyContactPhone: '09123456789',
};

test('requires all registration fields and applies education-dependent requirements', () => {
  const errors = participantRegistrationErrors({}, educationLevels, grades, registrationToday);
  assert.deepEqual(
    Object.keys(errors).sort(),
    ['dateOfBirth', 'educationLevel', 'emergencyContactName', 'emergencyContactPhone', 'firstName', 'gender', 'lastName'].sort(),
  );
  assert.equal(errors.emergencyContactPhone, 'Guardian contact number is required.');
  assert.deepEqual(
    participantRegistrationErrors(null, educationLevels, grades, registrationToday),
    errors,
  );

  const validErrors = participantRegistrationErrors(validRegistration, educationLevels, grades, registrationToday);
  assert.deepEqual(validErrors, {});
  assert.equal(
    participantRegistrationErrors({
      ...validRegistration,
      educationLevel: 'College',
      gradeLevel: 'Year 1',
      programCourse: '   ',
    }, educationLevels, grades, registrationToday).programCourse,
    'College students must provide their course.',
  );
  assert.equal(
    participantRegistrationErrors({
      ...validRegistration,
      educationLevel: 'Not a real level',
    }, educationLevels, grades, registrationToday).educationLevel,
    'Please select an education level.',
  );
  assert.equal(
    participantRegistrationErrors({
      ...validRegistration,
      gradeLevel: 'Not a real grade',
    }, educationLevels, grades, registrationToday).gradeLevel,
    'Please select a grade/year.',
  );
});

test('requires strict 09-prefixed 11-digit guardian phone numbers', () => {
  const validNumbers = ['09123456789', '09051234567'];
  for (const emergencyContactPhone of validNumbers) {
    assert.equal(
      participantRegistrationErrors({ ...validRegistration, emergencyContactPhone }, educationLevels, grades, registrationToday).emergencyContactPhone,
      undefined,
      `${emergencyContactPhone} should be accepted`,
    );
  }
  const invalidNumbers = [
    '0912345678',
    '091234567890',
    '+639123456789',
    '639123456789',
    '09-1234-56789',
    '09ABC456789',
    '09 123456789',
    '12345678901',
    '88123456789',
  ];
  for (const emergencyContactPhone of invalidNumbers) {
    assert.equal(
      participantRegistrationErrors({ ...validRegistration, emergencyContactPhone }, educationLevels, grades, registrationToday).emergencyContactPhone,
      'Guardian contact number must be 11 digits and start with 09.',
      `${emergencyContactPhone} should be rejected`,
    );
  }
});

test('validates names, dates of birth, addresses, school, and health values', () => {
  for (const [dateOfBirth, expected] of [
    ['2026-10-20', 'Date of birth cannot be in the future.'],
    ['2021-10-19', 'Child must be at least 6 years old.'],
    ['2003-10-18', 'Child must not be older than 22 years.'],
  ]) {
    assert.equal(
      participantRegistrationErrors({ ...validRegistration, dateOfBirth }, educationLevels, grades, registrationToday).dateOfBirth,
      expected,
    );
  }
  for (const dateOfBirth of ['2020-10-19', '2004-10-19']) {
    assert.equal(
      participantRegistrationErrors({ ...validRegistration, dateOfBirth }, educationLevels, grades, registrationToday).dateOfBirth,
      undefined,
    );
  }
  assert.equal(
    participantRegistrationErrors({ ...validRegistration, firstName: 'Juan123' }, educationLevels, grades, registrationToday).firstName,
    'First name must contain letters only.',
  );
  assert.equal(
    participantRegistrationErrors({ ...validRegistration, lastName: 'Dela-Cruz' }, educationLevels, grades, registrationToday).lastName,
    'Last name must contain letters only.',
  );
  assert.equal(
    participantRegistrationErrors({ ...validRegistration, middleName: 'Ana2' }, educationLevels, grades, registrationToday).middleName,
    'Middle name must contain letters only.',
  );
  assert.equal(
    participantRegistrationErrors({ ...validRegistration, emergencyContactName: 'Roberto123' }, educationLevels, grades, registrationToday).emergencyContactName,
    'Guardian name must contain a valid name.',
  );
  assert.equal(
    participantRegistrationErrors({ ...validRegistration, address: 'abc' }, educationLevels, grades, registrationToday).address,
    'Home address must be at least 5 characters.',
  );
  assert.ok(participantRegistrationErrors({ ...validRegistration, schoolName: '12345' }, educationLevels, grades, registrationToday).schoolName);
  assert.ok(participantRegistrationErrors({ ...validRegistration, schoolName: '' }, educationLevels, grades, registrationToday).schoolName);
  assert.ok(participantRegistrationErrors({ ...validRegistration, schoolAddress: '   ' }, educationLevels, grades, registrationToday).schoolAddress);
  assert.ok(participantRegistrationErrors({ ...validRegistration, weight: '32 kg' }, educationLevels, grades, registrationToday).weight);
  assert.ok(participantRegistrationErrors({ ...validRegistration, height: '-10' }, educationLevels, grades, registrationToday).height);
  assert.ok(participantRegistrationErrors({ ...validRegistration, medicalConditions: 'x'.repeat(501) }, educationLevels, grades, registrationToday).medicalConditions);
});

test('preserves valid optional middle name and whitespace-only optional data is rejected where relevant', () => {
  assert.deepEqual(
    participantRegistrationErrors({
      ...validRegistration,
      middleName: '',
      address: '',
      weight: '',
      height: '',
      medicalConditions: '',
    }, educationLevels, grades, registrationToday),
    {},
  );
  assert.ok(participantRegistrationErrors({ ...validRegistration, address: '   ' }, educationLevels, grades, registrationToday).address);
  assert.ok(participantRegistrationErrors({ ...validRegistration, medicalConditions: '   ' }, educationLevels, grades, registrationToday).medicalConditions);
});
