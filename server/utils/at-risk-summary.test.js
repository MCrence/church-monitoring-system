const assert = require('node:assert/strict');
const test = require('node:test');

const { summarizeAtRiskParticipants } = require('./at-risk-summary');

test('counts unique at-risk sponsored participants across status and predictive categories', () => {
  const result = summarizeAtRiskParticipants([
    { id: 1, participationStatus: 'WARNING' },
    { id: 2, participationStatus: 'SECOND_CHANCE' },
    { id: 3, participationStatus: 'GROUNDS_FOR_DEPARTURE' },
    { id: 4, participationStatus: 'ACTIVE' },
    { id: 5, participationStatus: 'REMOVED_FROM_SPONSORSHIP' },
    { id: 6, participationStatus: 'INACTIVE' },
  ], [
    { participantId: 1, riskLevel: 'Medium' },
    { participantId: 3, riskLevel: 'HIGH' },
    { participantId: 4, riskLevel: 'medium' },
    { participantId: 5, riskLevel: 'high' },
  ]);

  assert.deepEqual(result, {
    warning: 2,
    groundsForDeparture: 1,
    mediumPredictiveRisk: 2,
    highPredictiveRisk: 1,
    total: 4,
    predictiveDataAvailable: true,
  });
});

test('reports predictive data unavailable when validated risk results are absent', () => {
  const result = summarizeAtRiskParticipants([
    { id: 1, participationStatus: 'WARNING' },
    { id: 2, participationStatus: 'ACTIVE' },
  ], []);

  assert.equal(result.total, 1);
  assert.equal(result.predictiveDataAvailable, false);
});
