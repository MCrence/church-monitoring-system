const EDUCATION_GROUPS = ['Elementary', 'High School', 'College'];

function educationGroup(value) {
  const level = String(value || '').trim().toLowerCase();
  if (level === 'elementary') return 'Elementary';
  if (level === 'junior high school' || level === 'senior high school' || level === 'high school') {
    return 'High School';
  }
  if (level === 'college') return 'College';
  return 'Other';
}

function toDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(date) {
  return dateKey(date).slice(0, 7);
}

function weekStart(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function intervalKey(date, interval) {
  if (interval === 'day') return dateKey(date);
  if (interval === 'month') return monthKey(date);
  if (interval === 'year') return String(date.getFullYear());
  return dateKey(weekStart(date));
}

function intervalLabel(key, interval) {
  if (interval === 'year') return key;
  const parts = key.split('-').map(Number);
  const date = interval === 'month'
    ? new Date(parts[0], parts[1] - 1, 1)
    : new Date(parts[0], parts[1] - 1, parts[2]);
  const label = interval === 'month'
    ? date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return interval === 'week' ? `Week of ${label}` : label;
}

function nextInterval(date, interval) {
  const next = new Date(date);
  if (interval === 'day') next.setDate(next.getDate() + 1);
  else if (interval === 'week') next.setDate(next.getDate() + 7);
  else if (interval === 'month') next.setMonth(next.getMonth() + 1);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}

function attendanceRate(present, scheduled) {
  return scheduled ? Math.round((present / scheduled) * 1000) / 10 : null;
}

function createTotals() {
  return { scheduled: 0, present: 0 };
}

function addOccurrence(totals, present) {
  totals.scheduled += 1;
  if (present) totals.present += 1;
  totals.absent = totals.scheduled - totals.present;
  totals.attendanceRate = attendanceRate(totals.present, totals.scheduled);
}

function buildAttendanceAnalytics(participants, occurrences, interval, range) {
  const byParticipant = new Map();
  const rangeStart = toDate(range.start);
  const rangeEnd = toDate(range.end);
  const today = new Date();
  const lastDate = rangeEnd && rangeEnd < today ? rangeEnd : today;
  for (const participant of participants) {
    byParticipant.set(String(participant.id), {
      ...participant,
      scheduled: 0,
      present: 0,
      absent: 0,
      attendanceRate: null,
      months: new Map(),
    });
    const registrationDate = toDate(participant.registrationDate);
    const firstDate = registrationDate && rangeStart && registrationDate > rangeStart
      ? registrationDate
      : rangeStart;
    if (!firstDate || !lastDate || firstDate > lastDate) continue;
    const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    const lastMonth = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);
    const participantRow = byParticipant.get(String(participant.id));
    while (cursor <= lastMonth) {
      const key = monthKey(cursor);
      participantRow.months.set(key, {
        year: cursor.getFullYear(),
        month: cursor.getMonth() + 1,
        key,
        ...createTotals(),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  const uniqueOccurrences = new Map();
  for (const occurrence of occurrences) {
    const participantId = String(occurrence.participantId);
    if (!byParticipant.has(participantId)) continue;
    const startsAt = toDate(occurrence.startsAt);
    if (!startsAt) continue;
    const eventId = String(occurrence.eventId);
    const key = `${participantId}|${eventId}`;
    const existing = uniqueOccurrences.get(key);
    uniqueOccurrences.set(key, {
      participantId,
      eventId,
      eventName: occurrence.eventName,
      startsAt,
      present: Boolean(Number(occurrence.present)) || Boolean(existing?.present),
    });
  }

  const trends = new Map();
  const educationComparison = new Map(
    EDUCATION_GROUPS.map((group) => [group, { educationGroup: group, ...createTotals(), participantIds: new Set() }]),
  );
  const eventOptions = new Map();
  for (const participant of byParticipant.values()) {
    educationComparison.get(educationGroup(participant.educationLevel))?.participantIds.add(participant.id);
  }
  for (const occurrence of uniqueOccurrences.values()) {
    const participant = byParticipant.get(occurrence.participantId);
    const key = monthKey(occurrence.startsAt);
    if (!participant.months.has(key)) {
      participant.months.set(key, { year: occurrence.startsAt.getFullYear(), month: occurrence.startsAt.getMonth() + 1, key, ...createTotals() });
    }
    addOccurrence(participant, occurrence.present);
    addOccurrence(participant.months.get(key), occurrence.present);

    const trendKey = intervalKey(occurrence.startsAt, interval);
    if (!trends.has(trendKey)) trends.set(trendKey, createTotals());
    addOccurrence(trends.get(trendKey), occurrence.present);

    const group = educationComparison.get(educationGroup(participant.educationLevel));
    if (group) addOccurrence(group, occurrence.present);
    eventOptions.set(occurrence.eventId, { id: occurrence.eventId, name: occurrence.eventName, startsAt: occurrence.startsAt });
  }

  const participantRows = [...byParticipant.values()].map((participant) => ({
    ...participant,
    attendanceRate: attendanceRate(participant.present, participant.scheduled),
    months: [...participant.months.values()]
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .map((month) => ({
        ...month,
        absent: month.scheduled - month.present,
        attendanceRate: attendanceRate(month.present, month.scheduled),
      })),
  }));

  const series = [];
  const start = toDate(range.start);
  const end = toDate(range.end);
  if (start && end) {
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    if (interval === 'week') cursor = weekStart(cursor);
    else if (interval === 'month') cursor.setDate(1);
    else if (interval === 'year') cursor.setMonth(0, 1);
    while (cursor <= end && series.length < 400) {
      const key = intervalKey(cursor, interval);
      const totals = trends.get(key) || createTotals();
      series.push({
        key,
        label: intervalLabel(key, interval),
        scheduled: totals.scheduled,
        present: totals.present,
        absent: totals.scheduled - totals.present,
        attendanceRate: attendanceRate(totals.present, totals.scheduled),
      });
      cursor = nextInterval(cursor, interval);
    }
  }

  return {
    participants: participantRows,
    records: series,
    educationComparison: EDUCATION_GROUPS.map((group) => {
      const totals = educationComparison.get(group);
      return {
        educationLevel: group,
        participants: totals.participantIds.size,
        scheduled: totals.scheduled,
        present: totals.present,
        absent: totals.scheduled - totals.present,
        attendanceRate: attendanceRate(totals.present, totals.scheduled),
      };
    }),
    events: [...eventOptions.values()].sort((a, b) => a.startsAt - b.startsAt || a.name.localeCompare(b.name)),
  };
}

module.exports = {
  buildAttendanceAnalytics,
  educationGroup,
};
