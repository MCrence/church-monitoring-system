const MONTHLY_ACTIVITY_REQUIREMENT = 2;
const GROUNDS_FOR_DEPARTURE_ABSENCES = 6;

const dateKey = (value) => {
  if (!value) return "";
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
};

const monthKey = (value) => dateKey(value).slice(0, 7);

function summarizeParticipation({ registrationDate, events = [], checkIns = [], asOf = new Date() }) {
  const registrationDateKey = dateKey(registrationDate);
  const registrationMonth = monthKey(registrationDate);
  const finalMonth = monthKey(asOf);
  if (!registrationMonth || !finalMonth || registrationMonth > finalMonth) {
    return {
      months: [],
      years: [],
      lifetime: { required: 0, attended: 0, absent: 0, attendanceRate: 0 },
      currentMonth: { required: MONTHLY_ACTIVITY_REQUIREMENT, attended: 0, absent: 0, attendanceRate: 0, status: "WARNING" },
      currentYear: { required: 0, attended: 0, absent: 0, attendanceRate: 0 },
      monthsMonitored: 0,
      recentThreeMonthAbsences: 0,
      recentThreeMonthSummary: { required: 0, attended: 0, absent: 0, attendanceRate: 0, status: "ACTIVE" },
    };
  }

  const lastDay = dateKey(asOf);
  const occurrenceKey = (name, date) => `${monthKey(date)}|${dateKey(date)}|${String(name || "").trim().toLocaleLowerCase()}`;
  const activityByKey = new Map();
  for (const event of events) {
    const date = dateKey(event.date);
    if (!date || date < registrationDateKey || date > lastDay) continue;
    const key = occurrenceKey(event.name, date);
    activityByKey.set(key, {
      name: event.name || "Activity",
      date,
      location: event.location || "",
      attended: false,
      required: false,
    });
  }

  const attendedKeys = new Set();
  for (const checkIn of checkIns) {
    const date = dateKey(checkIn.checkedInAt);
    if (!date || date < registrationDateKey || date > lastDay) continue;
    const key = occurrenceKey(checkIn.eventName, date);
    attendedKeys.add(key);
    if (!activityByKey.has(key)) {
      activityByKey.set(key, {
        name: checkIn.eventName || "Activity",
        date,
        location: checkIn.location || "",
        attended: true,
        required: false,
      });
    }
  }
  for (const activity of activityByKey.values()) {
    activity.attended = attendedKeys.has(occurrenceKey(activity.name, activity.date));
  }

  const months = [];
  const yearTotals = new Map();
  let lifetimeRequired = 0;
  let lifetimeAttended = 0;
  for (let [year, month] = registrationMonth.split("-").map(Number);
    year < Number(finalMonth.slice(0, 4)) ||
    (year === Number(finalMonth.slice(0, 4)) && month <= Number(finalMonth.slice(5, 7)));
    month += 1) {
    if (month > 12) {
      year += 1;
      month = 1;
    }
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const occurrences = [...activityByKey.values()]
      .filter((activity) => activity.date.slice(0, 7) === key)
      .sort((first, second) => first.date.localeCompare(second.date) || first.name.localeCompare(second.name));
    const required = Math.min(MONTHLY_ACTIVITY_REQUIREMENT, occurrences.length);
    const requiredOccurrences = [
      ...occurrences.filter((activity) => activity.attended),
      ...occurrences.filter((activity) => !activity.attended),
    ].slice(0, required);
    requiredOccurrences.forEach((activity) => { activity.required = true; });
    const attended = Math.min(
      required,
      new Set(occurrences.filter((activity) => activity.attended)
        .map((activity) => occurrenceKey(activity.name, activity.date))).size,
    );
    const absent = required - attended;
    const monthSummary = {
      year,
      month,
      key,
      required,
      attended,
      absent,
      attendanceRate: required ? Math.round((attended / required) * 10000) / 100 : 0,
      status: attended === required ? "ACTIVE" : "WARNING",
      events: occurrences.map((activity) => ({
        ...activity,
        status: activity.attended ? "ATTENDED" : "ABSENT",
      })),
    };
    months.push(monthSummary);
    lifetimeRequired += required;
    lifetimeAttended += attended;
    const yearly = yearTotals.get(year) || { year, required: 0, attended: 0, absent: 0 };
    yearly.required += required;
    yearly.attended += attended;
    yearly.absent += absent;
    yearTotals.set(year, yearly);
  }

  const lifetimeAbsent = lifetimeRequired - lifetimeAttended;
  const currentMonth = months[months.length - 1] || {
    required: MONTHLY_ACTIVITY_REQUIREMENT,
    attended: 0,
    absent: MONTHLY_ACTIVITY_REQUIREMENT,
    attendanceRate: 0,
    status: "WARNING",
  };
  const currentYear = yearTotals.get(Number(finalMonth.slice(0, 4))) || {
    required: 0,
    attended: 0,
    absent: 0,
  };
  const years = [...yearTotals.values()]
    .sort((first, second) => second.year - first.year)
    .map((year) => ({
      ...year,
      attendanceRate: year.required
        ? Math.round((year.attended / year.required) * 10000) / 100
        : 0,
    }));
  const recentMonths = months.slice(-3);
  const recentThreeMonthAbsences = recentMonths.reduce((total, month) => total + month.absent, 0);
  const recentThreeMonthSummary = recentMonths.reduce((summary, month) => {
    summary.required += month.required;
    summary.attended += month.attended;
    summary.absent += month.absent;
    return summary;
  }, { required: 0, attended: 0, absent: 0 });
  recentThreeMonthSummary.attendanceRate = recentThreeMonthSummary.required
    ? Math.round((recentThreeMonthSummary.attended / recentThreeMonthSummary.required) * 10000) / 100
    : 0;
  recentThreeMonthSummary.status = recentThreeMonthSummary.required === 0 || recentThreeMonthSummary.attended >= recentThreeMonthSummary.required
    ? "ACTIVE"
    : "WARNING";

  return {
    months: months.reverse(),
    years,
    lifetime: {
      required: lifetimeRequired,
      attended: lifetimeAttended,
      absent: lifetimeAbsent,
      attendanceRate: lifetimeRequired
        ? Math.round((lifetimeAttended / lifetimeRequired) * 10000) / 100
        : 0,
    },
    currentMonth,
    currentYear: {
      ...currentYear,
      attendanceRate: currentYear.required
        ? Math.round((currentYear.attended / currentYear.required) * 10000) / 100
        : 0,
    },
    monthsMonitored: months.length,
    recentThreeMonthAbsences,
    recentThreeMonthSummary,
  };
}

function getParticipationStatus({
  totalAbsences = 0,
  monthlyCompliant = false,
  secondChanceGranted = false,
  removed = false,
  monthsMonitored,
  recentThreeMonthAbsences = 0,
} = {}) {
  if (removed) return "REMOVED_FROM_SPONSORSHIP";
  if (secondChanceGranted) return "SECOND_CHANCE";
  const monitoredMonths = Number.isFinite(Number(monthsMonitored)) ? Number(monthsMonitored) : 0;
  const recentAbsences = Number(recentThreeMonthAbsences) || 0;
  if (monitoredMonths >= 4 && totalAbsences > GROUNDS_FOR_DEPARTURE_ABSENCES) return "GROUNDS_FOR_DEPARTURE";
  if (recentAbsences >= 3 && recentAbsences <= 4) return "WARNING";
  return monthlyCompliant ? "ACTIVE" : "WARNING";
}

function isRemovalEligible({ secondChanceGranted, postSecondChanceAbsences, removed }) {
  return Boolean(secondChanceGranted) && !removed && postSecondChanceAbsences >= 2;
}

module.exports = {
  GROUNDS_FOR_DEPARTURE_ABSENCES,
  MONTHLY_ACTIVITY_REQUIREMENT,
  getParticipationStatus,
  isRemovalEligible,
  summarizeParticipation,
};
