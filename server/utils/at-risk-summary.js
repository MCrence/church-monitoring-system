function summarizeAtRiskParticipants(participants, riskRecords) {
  const risksById = new Map(
    riskRecords.map((record) => [String(record.participantId), String(record.riskLevel || '').toLowerCase()]),
  );
  const categories = {
    warning: new Set(),
    groundsForDeparture: new Set(),
    mediumPredictiveRisk: new Set(),
    highPredictiveRisk: new Set(),
  };
  const uniqueAtRisk = new Set();
  for (const participant of participants) {
    const id = String(participant.id);
    const status = String(participant.participationStatus || '').toUpperCase();
    if (['INACTIVE', 'REMOVED_FROM_SPONSORSHIP'].includes(status)) continue;
    const risk = risksById.get(id);
    if (['WARNING', 'SECOND_CHANCE'].includes(status)) categories.warning.add(id);
    if (status === 'GROUNDS_FOR_DEPARTURE') categories.groundsForDeparture.add(id);
    if (risk === 'medium') categories.mediumPredictiveRisk.add(id);
    if (risk === 'high') categories.highPredictiveRisk.add(id);
    if (
      ['WARNING', 'SECOND_CHANCE', 'GROUNDS_FOR_DEPARTURE'].includes(status)
      || ['medium', 'high'].includes(risk)
    ) uniqueAtRisk.add(id);
  }
  return {
    warning: categories.warning.size,
    groundsForDeparture: categories.groundsForDeparture.size,
    mediumPredictiveRisk: categories.mediumPredictiveRisk.size,
    highPredictiveRisk: categories.highPredictiveRisk.size,
    total: uniqueAtRisk.size,
    predictiveDataAvailable: categories.mediumPredictiveRisk.size + categories.highPredictiveRisk.size > 0
      || riskRecords.some((record) => ['low', 'medium', 'high'].includes(
        String(record.riskLevel || '').toLowerCase(),
      )),
  };
}

module.exports = { summarizeAtRiskParticipants };
