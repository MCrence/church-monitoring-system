const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAttendanceHistory } = require('./attendance-history');

test('builds every year and all twelve months from registration through the current year', () => {
  const result = buildAttendanceHistory({
    registrationDate: '2023-11-18',
    asOf: '2025-06-10',
    trendYear: 2024,
    groupedRows: [
      { year: 2024, month: 1, total_events: 2, total_attended: 2, csv_synthetic_events: 2 },
      { year: 2024, month: 2, total_events: 2, total_attended: 1, csv_synthetic_events: 0 },
    ],
  });

  assert.deepEqual(result.attendanceByYear.map(({ year, totalEvents, totalAttended, totalAbsent }) => ({
    year, totalEvents, totalAttended, totalAbsent,
  })), [
    { year: 2023, totalEvents: 0, totalAttended: 0, totalAbsent: 0 },
    { year: 2024, totalEvents: 4, totalAttended: 3, totalAbsent: 1 },
    { year: 2025, totalEvents: 0, totalAttended: 0, totalAbsent: 0 },
  ]);
  assert.equal(result.attendanceByMonth.length, 12);
  assert.deepEqual(result.attendanceByMonth[0], {
    year: 2024,
    month: 1,
    totalEvents: 2,
    totalAttended: 2,
    totalAbsent: 0,
    csvSyntheticEvents: 2,
    attendanceRate: 100,
    absenceRate: 0,
    source: 'csv-synthetic',
  });
  assert.equal(result.attendanceByMonth[11].month, 12);
  assert.equal(result.attendanceByMonth[11].totalEvents, 0);
  assert.equal(result.attendanceByMonth[0].source, 'csv-synthetic');
  assert.equal(result.attendanceByYear[1].source, 'mixed');
  assert.equal(result.source, 'mixed');
  assert.equal(result.csvSyntheticEvents, 2);
  assert.equal(result.totalEvents, 4);
  assert.equal(result.totalAbsences, 1);
});

test('preserves empty year and zeroes percentages when no completed events exist', () => {
  const result = buildAttendanceHistory({
    registrationDate: new Date('2024-08-03T00:00:00'),
    asOf: new Date('2025-02-01T00:00:00'),
  });

  assert.deepEqual(result.attendanceByYear.map((year) => year.year), [2024, 2025]);
  assert.equal(result.attendanceByYear[0].months.length, 12);
  assert.equal(result.attendanceByYear[1].attendanceRate, 0);
  assert.equal(result.attendanceByMonth.length, 12);
  assert.equal(result.totalEvents, 0);
  assert.equal(result.attendanceRate, 0);
});
