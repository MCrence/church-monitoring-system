const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeEducationStatus,
  normalizeEventStatus,
  normalizeImportTime,
  normalizeSponsorshipStatus,
  parseSchoolYear,
  validateImportHeaders,
} = require('./participant-import');

test('requires type-specific columns and rejects unmapped or repeated headers', () => {
  const missingAndUnmapped = validateImportHeaders(
    'participants',
    ['First Name', 'Last Name', 'Unused'],
    ['firstName', 'lastName', ''],
  );
  assert.ok(missingAndUnmapped.some((error) => error.includes('Missing required columns')));
  assert.ok(missingAndUnmapped.some((error) => error.includes('Unrecognized columns')));
  const duplicate = validateImportHeaders(
    'education',
    ['Child ID', 'Child Name', 'School'],
    ['participantId', 'participantId', 'schoolName'],
  );
  assert.ok(duplicate.some((error) => error.includes('Missing required columns')));
  assert.ok(duplicate.some((error) => error.includes('mapped more than once')));
});

test('accepts either child identifier for education and a resolvable event reference for attendance', () => {
  assert.deepEqual(validateImportHeaders(
    'education',
    ['Sponsored Child Code', 'School Name', 'Education Level', 'School Year', 'Start Date', 'Current Education Status'],
    ['participantCode', 'schoolName', 'educationLevel', 'schoolYear', 'startDate', 'status'],
  ), []);
  assert.deepEqual(validateImportHeaders(
    'attendance',
    ['Sponsored Child ID', 'Activity Name', 'Event Date', 'Attendance Status'],
    ['participantId', 'eventName', 'eventDate', 'attendanceStatus'],
  ), []);
});

test('normalizes only supported statuses and parses school years and times', () => {
  assert.equal(normalizeSponsorshipStatus('Grounds for Departure'), 'GROUNDS_FOR_DEPARTURE');
  assert.equal(normalizeSponsorshipStatus('Ground for Departure'), 'GROUNDS_FOR_DEPARTURE');
  assert.equal(normalizeSponsorshipStatus('Second Chance'), null);
  assert.equal(normalizeEventStatus('Cancelled'), 'cancelled');
  assert.equal(normalizeEventStatus('Postponed'), null);
  assert.equal(normalizeEducationStatus('currently attending'), 'Currently Attending');
  assert.deepEqual(parseSchoolYear('SY 2024-2025'), { startYear: 2024, endYear: 2025 });
  assert.equal(normalizeImportTime('9:30 PM'), '21:30:00');
  assert.equal(normalizeImportTime('25:00'), null);
});
