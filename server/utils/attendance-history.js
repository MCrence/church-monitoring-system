function getYear(value, fallbackYear) {
  if (value === null || value === undefined || value === '') return fallbackYear;
  if (typeof value === 'string') {
    const datePrefix = value.match(/^(\d{4})-\d{2}-\d{2}/);
    if (datePrefix) return Number(datePrefix[1]);
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallbackYear : date.getFullYear();
}

function percentage(value, total) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function attendanceSource(totalEvents, csvSyntheticEvents) {
  if (!csvSyntheticEvents) return 'recorded';
  return csvSyntheticEvents >= totalEvents ? 'csv-synthetic' : 'mixed';
}

function buildAttendanceHistory({ registrationDate, asOf = new Date(), groupedRows = [], trendYear }) {
  const currentYear = getYear(asOf, new Date().getFullYear());
  const registrationYear = getYear(registrationDate, currentYear);
  const years = new Map();

  for (let year = registrationYear; year <= currentYear; year += 1) {
    years.set(year, {
      year,
      totalEvents: 0,
      totalAttended: 0,
      csvSyntheticEvents: 0,
      months: Array.from({ length: 12 }, (_, index) => ({
        year,
        month: index + 1,
        totalEvents: 0,
        totalAttended: 0,
        totalAbsent: 0,
        csvSyntheticEvents: 0,
        attendanceRate: 0,
        absenceRate: 0,
        source: 'recorded',
      })),
    });
  }

  for (const row of groupedRows) {
    const year = Number(row.year);
    const month = Number(row.month);
    const yearly = years.get(year);
    if (!yearly || !Number.isInteger(month) || month < 1 || month > 12) continue;

    const monthly = yearly.months[month - 1];
    monthly.totalEvents = Math.max(0, Number(row.total_events) || 0);
    monthly.totalAttended = Math.min(
      monthly.totalEvents,
      Math.max(0, Number(row.total_attended) || 0),
    );
    monthly.csvSyntheticEvents = Math.min(
      monthly.totalEvents,
      Math.max(0, Number(row.csv_synthetic_events) || 0),
    );
    monthly.totalAbsent = monthly.totalEvents - monthly.totalAttended;
    monthly.attendanceRate = percentage(monthly.totalAttended, monthly.totalEvents);
    monthly.absenceRate = percentage(monthly.totalAbsent, monthly.totalEvents);
    monthly.source = attendanceSource(monthly.totalEvents, monthly.csvSyntheticEvents);
    yearly.totalEvents += monthly.totalEvents;
    yearly.totalAttended += monthly.totalAttended;
    yearly.csvSyntheticEvents += monthly.csvSyntheticEvents;
  }

  const attendanceByYear = [...years.values()].map((year) => ({
    ...year,
    totalAbsent: year.totalEvents - year.totalAttended,
    attendanceRate: percentage(year.totalAttended, year.totalEvents),
    absenceRate: percentage(year.totalEvents - year.totalAttended, year.totalEvents),
    source: attendanceSource(year.totalEvents, year.csvSyntheticEvents),
  }));
  const requestedYear = Number(trendYear);
  const selectedYear = years.has(requestedYear) ? requestedYear : currentYear;
  const attendanceByMonth = years.get(selectedYear)?.months || [];
  const totalEvents = attendanceByYear.reduce((total, year) => total + year.totalEvents, 0);
  const totalAttended = attendanceByYear.reduce((total, year) => total + year.totalAttended, 0);

  return {
    attendanceByYear,
    attendanceByMonth,
    totalEvents,
    totalAttended,
    totalAbsences: totalEvents - totalAttended,
    attendanceRate: percentage(totalAttended, totalEvents),
    csvSyntheticEvents: attendanceByYear.reduce((total, year) => total + year.csvSyntheticEvents, 0),
    source: attendanceSource(
      totalEvents,
      attendanceByYear.reduce((total, year) => total + year.csvSyntheticEvents, 0),
    ),
  };
}

module.exports = { buildAttendanceHistory };
