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
  const registrationMonth = monthKey(registrationDate);
  const finalMonth = monthKey(asOf);
  if (!registrationMonth || !finalMonth || registrationMonth > finalMonth) {
    return {
      months: [],
      years: [],
      lifetime: { required: 0, attended: 0, absent: 0, attendanceRate: 0 },
      currentMonth: { required: MONTHLY_ACTIVITY_REQUIREMENT, attended: 0, absent: 0, attendanceRate: 0, status: "WARNING" },
      currentYear: { required: 0, attended: 0, absent: 0, attendanceRate: 0 },
    };
  }

  const lastDay = dateKey(asOf);
  const occurrenceKey = (name, date) => `${monthKey(date)}|${dateKey(date)}|${String(name || "").trim().toLocaleLowerCase()}`;
  const activityByKey = new Map();
  for (const event of events) {
    const date = dateKey(event.date);
    if (!date || date > lastDay) continue;
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
    if (!date || date > lastDay) continue;
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
  for (const [key, activity] of activityByKey) {
    activity.attended = attendedKeys.has(key);
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
    const requiredOccurrences = [
      ...occurrences.filter((activity) => activity.attended),
      ...occurrences.filter((activity) => !activity.attended),
    ].slice(0, MONTHLY_ACTIVITY_REQUIREMENT);
    requiredOccurrences.forEach((activity) => { activity.required = true; });
    const attended = Math.min(
      MONTHLY_ACTIVITY_REQUIREMENT,
      new Set(occurrences.filter((activity) => activity.attended)
        .map((activity) => occurrenceKey(activity.name, activity.date))).size,
    );
    const absent = MONTHLY_ACTIVITY_REQUIREMENT - attended;
    const monthSummary = {
      year,
      month,
      key,
      required: MONTHLY_ACTIVITY_REQUIREMENT,
      attended,
      absent,
      attendanceRate: Math.round((attended / MONTHLY_ACTIVITY_REQUIREMENT) * 10000) / 100,
      status: attended === MONTHLY_ACTIVITY_REQUIREMENT ? "ACTIVE" : "WARNING",
      events: occurrences.map((activity) => ({
        ...activity,
        status: activity.attended ? "ATTENDED" : "ABSENT",
      })),
    };
    months.push(monthSummary);
    lifetimeRequired += MONTHLY_ACTIVITY_REQUIREMENT;
    lifetimeAttended += attended;
    const yearly = yearTotals.get(year) || { year, required: 0, attended: 0, absent: 0 };
    yearly.required += MONTHLY_ACTIVITY_REQUIREMENT;
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
  };
}

function getParticipationStatus({ totalAbsences, monthlyCompliant, secondChanceGranted, removed }) {
  if (removed) return "REMOVED_FROM_SPONSORSHIP";
  if (secondChanceGranted) return "SECOND_CHANCE";
  if (totalAbsences >= GROUNDS_FOR_DEPARTURE_ABSENCES) return "GROUNDS_FOR_DEPARTURE";
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
