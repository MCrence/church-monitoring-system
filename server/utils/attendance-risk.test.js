const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAttendanceRiskAssessment,
  normalizeAttendanceRiskSettings,
} = require('./attendance-risk');

const DAY_MS = 86400000;

test('scores only explicit present and absent events and exposes unrecorded scheduled events', () => {
  const now = Date.UTC(2026, 10, 22);
  const events = [
    { eventId: 1, startsAt: now - 7 * DAY_MS, attendanceStatus: 'present' },
    { eventId: 2, startsAt: now - 14 * DAY_MS, attendanceStatus: 'absent' },
    { eventId: 3, startsAt: now - 21 * DAY_MS, attendanceStatus: null },
  ];

  const result = buildAttendanceRiskAssessment(events, undefined, now);

  assert.equal(result.scheduledEvents, 3);
  assert.equal(result.recordedEvents, 2);
  assert.equal(result.present, 1);
  assert.equal(result.absent, 1);
  assert.equal(result.unrecorded, 1);
  assert.equal(result.attendanceRate, 50);
  assert.equal(result.riskScore, null);
  assert.equal(result.riskLevel, 'insufficient_data');
});

test('deduplicates event attendance rows and prefers an explicit present record', () => {
  const now = Date.UTC(2026, 10, 22);
  const result = buildAttendanceRiskAssessment([
    { eventId: 1, startsAt: now - 7 * DAY_MS, attendanceStatus: 'absent' },
    { eventId: 1, startsAt: now - 7 * DAY_MS, attendanceStatus: 'present' },
  ], undefined, now);

  assert.equal(result.scheduledEvents, 1);
  assert.equal(result.recordedEvents, 1);
  assert.equal(result.present, 1);
  assert.equal(result.absent, 0);
});

test('uses frequency, consecutive absences, and recency for a rule-based score', () => {
  const now = Date.UTC(2026, 10, 22);
  const events = ['present', 'present', 'absent', 'absent', 'absent', 'absent']
    .map((attendanceStatus, index) => ({
      eventId: index + 1,
      startsAt: now - (6 - index) * 10 * DAY_MS,
      attendanceStatus,
    }));

  const result = buildAttendanceRiskAssessment(events, undefined, now);

  assert.equal(result.insufficientData, false);
  assert.equal(result.attendanceRate, 33.3);
  assert.equal(result.consecutiveAbsences, 4);
  assert.equal(result.riskLevel, 'high');
  assert.equal(result.pattern, 'Repeated Absences');
  assert.equal(result.riskFactors.weights.frequency, 40);
  assert.equal(result.riskFactors.weights.regularity, 35);
  assert.equal(result.riskFactors.weights.recency, 25);
  assert.ok(result.recommendedActions.length > 0);
});

test('does not classify a child as high risk based only on old or missing records', () => {
  const now = Date.UTC(2026, 10, 22);
  const events = [1, 2, 3].map((id) => ({
    eventId: id,
    startsAt: now - (200 + id) * DAY_MS,
    attendanceStatus: 'absent',
  }));

  const result = buildAttendanceRiskAssessment(events, undefined, now);

  assert.equal(result.insufficientData, true);
  assert.equal(result.riskScore, null);
  assert.equal(result.riskLevel, 'insufficient_data');
});

test('validates administrator weight and threshold configuration', () => {
  assert.deepEqual(normalizeAttendanceRiskSettings({
    frequencyWeight: 50,
    regularityWeight: 30,
    recencyWeight: 20,
    mediumThreshold: 25,
    highThreshold: 70,
  }), {
    frequencyWeight: 50,
    regularityWeight: 30,
    recencyWeight: 20,
    mediumThreshold: 25,
    highThreshold: 70,
  });
  assert.throws(() => normalizeAttendanceRiskSettings({
    frequencyWeight: 50,
    regularityWeight: 30,
    recencyWeight: 30,
    mediumThreshold: 60,
    highThreshold: 40,
  }));
});
