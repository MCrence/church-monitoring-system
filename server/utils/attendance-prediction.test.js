const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildExamples,
  getCurrentAttendanceFeatures,
  predictInactivityProbability,
  scoreAttendanceBaseline,
  validateAttendanceModel,
} = require('./attendance-prediction');

const DAY_MS = 24 * 60 * 60 * 1000;

function createSyntheticHistory() {
  const rows = [];
  const firstDate = Date.UTC(2024, 0, 1);
  for (let participant = 0; participant < 40; participant += 1) {
    const attendanceStoppedAfter = participant % 2 === 0 ? 13 : 1_000;
    for (let month = 0; month < 30; month += 1) {
      if (month < attendanceStoppedAfter) {
        rows.push({
          participantId: `synthetic-${participant}`,
          checkedInAt: firstDate + month * 30 * DAY_MS + 10 * DAY_MS,
        });
      }
    }
  }
  return rows;
}

test('builds features from the prior 90 days and labels the following 30 days', () => {
  const base = Date.UTC(2025, 0, 1);
  const rows = [
    { participantId: 'a', checkedInAt: base },
    { participantId: 'a', checkedInAt: base + 30 * DAY_MS },
    { participantId: 'a', checkedInAt: base + 60 * DAY_MS },
    { participantId: 'a', checkedInAt: base + 100 * DAY_MS },
    { participantId: 'b', checkedInAt: base + 15 * DAY_MS },
  ];
  const examples = buildExamples(rows, base + 200 * DAY_MS);
  const atSnapshot = examples.find((row) => row.participantId === 'a' && row.snapshot === base + 90 * DAY_MS);

  assert.ok(atSnapshot);
  assert.equal(atSnapshot.label, 0);
  assert.equal(atSnapshot.features[0], 2 / 13);
  assert.equal(atSnapshot.features[1], 30 / 45);
});

test('does not label snapshots until their complete 30-day outcome window has elapsed', () => {
  const now = Date.UTC(2025, 0, 1);
  const rows = [{ participantId: 'a', checkedInAt: now - 100 * DAY_MS }];
  const examples = buildExamples(rows, now);
  assert.ok(examples.every((row) => row.snapshot + 30 * DAY_MS <= now));
});

test('keeps the model unvalidated when the available history is insufficient', () => {
  const history = [{ participantId: 'only-one', checkedInAt: Date.UTC(2025, 0, 1) }];
  const result = validateAttendanceModel(history, Date.UTC(2025, 5, 1));

  assert.equal(result.status, 'insufficient_or_failed');
  assert.equal(result.coefficients, null);
  assert.ok(result.reasons.length > 0);
});

test('validates on a later chronological holdout when synthetic signal is predictive', () => {
  const referenceTime = Date.UTC(2026, 5, 1);
  const result = validateAttendanceModel(createSyntheticHistory(), referenceTime);

  assert.equal(result.status, 'validated');
  assert.ok(result.metrics.prAuc > result.baseline.prevalence);
  assert.ok(result.metrics.brierScore < result.baseline.brierScore);
  assert.ok(result.metrics.expectedCalibrationError <= result.baseline.expectedCalibrationError);
  assert.ok(predictInactivityProbability([0, 1], result.coefficients) > 0.7);
});

test('baseline score remains on the 0-to-100 scale', () => {
  assert.equal(scoreAttendanceBaseline(13, 0), 0);
  assert.equal(scoreAttendanceBaseline(0, 45), 100);
});

test('uses the same attendance features for historical validation and current scoring', () => {
  const now = Date.UTC(2026, 0, 1);
  const history = [
    { participantId: 'a', checkedInAt: now - 80 * DAY_MS },
    { participantId: 'a', checkedInAt: now - 40 * DAY_MS },
  ];
  const features = getCurrentAttendanceFeatures(history, ['a', 'b'], now);

  assert.deepEqual(features.get('a'), [2 / 13, 40 / 45]);
  assert.deepEqual(features.get('b'), [0, 1]);
});
