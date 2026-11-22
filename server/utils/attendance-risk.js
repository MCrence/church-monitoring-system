const DEFAULT_ATTENDANCE_RISK_SETTINGS = Object.freeze({
  frequencyWeight: 40,
  regularityWeight: 35,
  recencyWeight: 25,
  mediumThreshold: 30,
  highThreshold: 60,
});

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeAttendanceStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'present' || status === 'checked_in') return 'present';
  if (status === 'absent') return 'absent';
  return null;
}

function normalizeAttendanceRiskSettings(settings = {}) {
  const normalized = {
    frequencyWeight: Number(settings.frequencyWeight ?? DEFAULT_ATTENDANCE_RISK_SETTINGS.frequencyWeight),
    regularityWeight: Number(settings.regularityWeight ?? DEFAULT_ATTENDANCE_RISK_SETTINGS.regularityWeight),
    recencyWeight: Number(settings.recencyWeight ?? DEFAULT_ATTENDANCE_RISK_SETTINGS.recencyWeight),
    mediumThreshold: Number(settings.mediumThreshold ?? DEFAULT_ATTENDANCE_RISK_SETTINGS.mediumThreshold),
    highThreshold: Number(settings.highThreshold ?? DEFAULT_ATTENDANCE_RISK_SETTINGS.highThreshold),
  };
  const weights = [
    normalized.frequencyWeight,
    normalized.regularityWeight,
    normalized.recencyWeight,
  ];
  if (
    weights.some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 100)
    || weights.reduce((sum, weight) => sum + weight, 0) !== 100
    || !Number.isInteger(normalized.mediumThreshold)
    || !Number.isInteger(normalized.highThreshold)
    || normalized.mediumThreshold < 1
    || normalized.highThreshold > 100
    || normalized.mediumThreshold >= normalized.highThreshold
  ) {
    throw new Error('Weights must be 0–100 and total 100; thresholds must satisfy 1 ≤ medium < high ≤ 100.');
  }
  return normalized;
}

function countTrailingAbsences(events) {
  let count = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].status !== 'absent') break;
    count += 1;
  }
  return count;
}

function classifyAttendancePattern(events, recentEvents, lastPresentAt, recencyDays) {
  if (recentEvents.length < 3) return 'Insufficient Attendance History';
  const consecutiveAbsences = countTrailingAbsences(recentEvents);
  if (consecutiveAbsences >= 2) return 'Repeated Absences';
  if (!lastPresentAt || recencyDays >= 60) return 'No Recent Attendance';

  const comparison = recentEvents.slice(-6);
  if (comparison.length >= 4) {
    const midpoint = Math.floor(comparison.length / 2);
    const earlier = comparison.slice(0, midpoint);
    const later = comparison.slice(midpoint);
    const earlierRate = earlier.filter((event) => event.status === 'present').length / earlier.length;
    const laterRate = later.filter((event) => event.status === 'present').length / later.length;
    if (laterRate - earlierRate >= 0.25) return 'Improving Attendance';
    if (earlierRate - laterRate >= 0.25) return 'Declining Attendance';
  }

  const recentRate = recentEvents.filter((event) => event.status === 'present').length / recentEvents.length;
  let changes = 0;
  for (let index = 1; index < recentEvents.length; index += 1) {
    if (recentEvents[index].status !== recentEvents[index - 1].status) changes += 1;
  }
  if (changes >= 3 || (recentRate > 0.2 && recentRate < 0.8)) return 'Irregular Attendance';
  return events.length >= 3 ? 'Consistent Attendance' : 'Insufficient Attendance History';
}

function recommendedActions(riskLevel, pattern) {
  if (riskLevel === 'high') {
    return [
      'Review recent and repeated absences.',
      'Contact the guardian through approved church procedures.',
      'Record a care note and schedule appropriate follow-up.',
    ];
  }
  if (riskLevel === 'medium') {
    return [
      'Monitor upcoming attendance and review recent absences.',
      'Coordinate with assigned church staff or Goer.',
      'Follow up with the guardian when appropriate.',
    ];
  }
  if (riskLevel === 'low') {
    return [
      'Continue routine attendance monitoring.',
      'Encourage consistent participation and record regular progress updates.',
    ];
  }
  return [
    `Continue routine attendance recording; current pattern: ${pattern.toLowerCase()}.`,
    'Do not infer absence where an attendance record is missing.',
  ];
}

function buildAttendanceRiskAssessment(events, settings, referenceTime = Date.now()) {
  const config = normalizeAttendanceRiskSettings(settings);
  const now = toTimestamp(referenceTime);
  const uniqueEvents = new Map();
  for (const event of events || []) {
    const timestamp = toTimestamp(event.startsAt ?? event.eventDate ?? event.date);
    if (timestamp === null || timestamp > now) continue;
    const eventName = String(event.eventName ?? event.name ?? '').trim();
    const key = event.eventId !== null && event.eventId !== undefined
      ? `id:${event.eventId}`
      : `${timestamp}:${eventName.toLowerCase()}`;
    if (!uniqueEvents.has(key)) {
      uniqueEvents.set(key, {
        eventId: event.eventId ?? null,
        eventName,
        startsAt: new Date(timestamp).toISOString(),
        timestamp,
        status: normalizeAttendanceStatus(event.attendanceStatus ?? event.status),
      });
    } else {
      const current = uniqueEvents.get(key);
      const nextStatus = normalizeAttendanceStatus(event.attendanceStatus ?? event.status);
      if (current.status !== 'present' && nextStatus === 'present') current.status = 'present';
      else if (!current.status && nextStatus) current.status = nextStatus;
    }
  }
  const attendanceHistory = [...uniqueEvents.values()]
    .sort((first, second) => first.timestamp - second.timestamp);
  const observed = attendanceHistory.filter((event) => event.status);
  const recentEvents = observed.filter((event) => now - event.timestamp <= 180 * 86400000);
  const present = observed.filter((event) => event.status === 'present').length;
  const absent = observed.filter((event) => event.status === 'absent').length;
  const latestPresent = observed.filter((event) => event.status === 'present').at(-1) || null;
  const recencyDays = latestPresent ? Math.max(0, Math.floor((now - latestPresent.timestamp) / 86400000)) : null;
  const enoughData = recentEvents.length >= 3;
  const recentPresent = recentEvents.filter((event) => event.status === 'present').length;
  const recentAbsent = recentEvents.filter((event) => event.status === 'absent').length;
  const frequencyRisk = recentEvents.length
    ? (recentAbsent / recentEvents.length) * 100
    : null;
  const consecutiveAbsences = countTrailingAbsences(recentEvents);
  const regularityRisk = recentEvents.length
    ? clamp(
      (recentAbsent / recentEvents.length) * 70
      + (Math.min(consecutiveAbsences, 3) / 3) * 30,
    )
    : null;
  const recencyRisk = latestPresent
    ? clamp((recencyDays / 60) * 100)
    : recentEvents.length ? 100 : null;
  const riskScore = enoughData
    ? Math.round((
      frequencyRisk * config.frequencyWeight
      + regularityRisk * config.regularityWeight
      + recencyRisk * config.recencyWeight
    ) / 100)
    : null;
  const riskLevel = riskScore === null
    ? 'insufficient_data'
    : riskScore >= config.highThreshold
      ? 'high'
      : riskScore >= config.mediumThreshold
        ? 'medium'
        : 'low';
  const pattern = classifyAttendancePattern(attendanceHistory, recentEvents, latestPresent, recencyDays);
  const scheduledEvents = attendanceHistory.length;
  const recordedEvents = observed.length;
  const attendanceRate = recordedEvents ? Math.round((present / recordedEvents) * 1000) / 10 : null;
  const absenceRate = recordedEvents ? Math.round((absent / recordedEvents) * 1000) / 10 : null;
  const attendanceDates = observed
    .filter((event) => event.status === 'present')
    .map((event) => event.startsAt);

  return {
    scheduledEvents,
    recordedEvents,
    present,
    absent,
    unrecorded: scheduledEvents - recordedEvents,
    attendanceRate,
    absenceRate,
    attendanceDates,
    mostRecentAttendanceDate: latestPresent?.startsAt || null,
    attendanceFrequency: recentEvents.length
      ? Math.round((recentPresent / recentEvents.length) * 1000) / 10
      : null,
    frequencyRisk: frequencyRisk === null ? null : Math.round(frequencyRisk * 10) / 10,
    regularityRisk: regularityRisk === null ? null : Math.round(regularityRisk * 10) / 10,
    recencyRisk: recencyRisk === null ? null : Math.round(recencyRisk * 10) / 10,
    consecutiveAbsences,
    recencyDays,
    pattern,
    riskScore,
    riskLevel,
    insufficientData: !enoughData,
    riskFactors: {
      frequency: frequencyRisk === null ? null : Math.round(frequencyRisk * 10) / 10,
      regularity: regularityRisk === null ? null : Math.round(regularityRisk * 10) / 10,
      recency: recencyRisk === null ? null : Math.round(recencyRisk * 10) / 10,
      weights: {
        frequency: config.frequencyWeight,
        regularity: config.regularityWeight,
        recency: config.recencyWeight,
      },
    },
    recommendedActions: recommendedActions(riskLevel, pattern),
    history: attendanceHistory.map(({ eventId, eventName, startsAt, status }) => ({
      eventId,
      eventName,
      startsAt,
      status: status || 'unrecorded',
    })),
  };
}

module.exports = {
  DEFAULT_ATTENDANCE_RISK_SETTINGS,
  buildAttendanceRiskAssessment,
  normalizeAttendanceRiskSettings,
};
