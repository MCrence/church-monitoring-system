const assert = require('node:assert/strict');
const test = require('node:test');

const { buildAttendanceAnalytics, educationGroup } = require('./attendance-analytics');

const range = {
  start: new Date(2026, 0, 1),
  end: new Date(2026, 1, 28),
};

test('aggregates unique completed event occurrences and deduplicates duplicate query rows', () => {
  const participants = [
    { id: 1, educationLevel: 'Elementary' },
    { id: 2, educationLevel: 'Junior High School' },
    { id: 3, educationLevel: 'College' },
  ];
  const occurrences = [
    { participantId: 1, eventId: 10, eventName: 'Sunday Service', startsAt: new Date(2026, 0, 4), present: 1 },
    { participantId: 1, eventId: 10, eventName: 'Sunday Service', startsAt: new Date(2026, 0, 4), present: 1 },
    { participantId: 1, eventId: 11, eventName: 'Sunday Service', startsAt: new Date(2026, 0, 11), present: 0 },
    { participantId: 2, eventId: 10, eventName: 'Sunday Service', startsAt: new Date(2026, 0, 4), present: 0 },
    { participantId: 3, eventId: 12, eventName: 'Youth Service', startsAt: new Date(2026, 1, 1), present: 1 },
  ];

  const result = buildAttendanceAnalytics(participants, occurrences, 'month', range);

  assert.deepEqual(result.participants.map(({ id, scheduled, present, absent, attendanceRate }) => (
    { id, scheduled, present, absent, attendanceRate }
  )), [
    { id: 1, scheduled: 2, present: 1, absent: 1, attendanceRate: 50 },
    { id: 2, scheduled: 1, present: 0, absent: 1, attendanceRate: 0 },
    { id: 3, scheduled: 1, present: 1, absent: 0, attendanceRate: 100 },
  ]);
  assert.equal(result.records.find((row) => row.key === '2026-01').scheduled, 3);
  assert.equal(result.records.find((row) => row.key === '2026-01').present, 1);
  assert.equal(result.records.find((row) => row.key === '2026-02').attendanceRate, 100);
  assert.deepEqual(result.educationComparison.map(({ educationLevel, scheduled, present }) => (
    { educationLevel, scheduled, present }
  )), [
    { educationLevel: 'Elementary', scheduled: 2, present: 1 },
    { educationLevel: 'High School', scheduled: 1, present: 0 },
    { educationLevel: 'College', scheduled: 1, present: 1 },
  ]);
});

test('returns a null attendance rate when the selected range has no completed events', () => {
  const result = buildAttendanceAnalytics(
    [{ id: 1, educationLevel: 'College' }],
    [],
    'day',
    range,
  );

  assert.equal(result.participants[0].attendanceRate, null);
  assert.equal(result.records[0].attendanceRate, null);
  assert.equal(result.educationComparison[2].participants, 1);
  assert.equal(result.educationComparison[2].attendanceRate, null);
});

test('includes zero-schedule months from the participant registration date without creating absences', () => {
  const result = buildAttendanceAnalytics(
    [{ id: 1, educationLevel: 'College', registrationDate: new Date(2026, 1, 10) }],
    [],
    'month',
    range,
  );

  assert.deepEqual(result.participants[0].months.map(({ key, scheduled, absent, attendanceRate }) => (
    { key, scheduled, absent, attendanceRate }
  )), [
    { key: '2026-02', scheduled: 0, absent: 0, attendanceRate: null },
  ]);
});

test('groups junior and senior high school together without treating goers as participants', () => {
  assert.equal(educationGroup('Junior High School'), 'High School');
  assert.equal(educationGroup('Senior High School'), 'High School');
  assert.equal(educationGroup('Goer'), 'Other');
});
