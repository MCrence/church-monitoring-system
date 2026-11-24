const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getParticipationStatus,
  isRemovalEligible,
  summarizeParticipation,
} = require("./participation");

const event = (name, date) => ({ name, date });
const checkIn = (eventName, checkedInAt) => ({ eventName, checkedInAt });

test("counts all scheduled activities and deduplicates repeat check-ins", () => {
  const result = summarizeParticipation({
    registrationDate: "2026-10-01",
    asOf: "2026-10-24",
    events: [
      event("Children's Ministry", "2026-10-05"),
      event("Sunday Service", "2026-10-19"),
      event("Extra Activity", "2026-10-22"),
    ],
    checkIns: [
      checkIn("Children's Ministry", "2026-10-05 09:00:00"),
      checkIn("Children's Ministry", "2026-10-05 09:04:00"),
      checkIn("Sunday Service", "2026-10-19 10:00:00"),
      checkIn("Extra Activity", "2026-10-22 10:00:00"),
    ],
  });

  assert.equal(result.currentMonth.required, 3);
  assert.equal(result.currentMonth.attended, 3);
  assert.equal(result.currentMonth.absent, 0);
  assert.equal(result.currentMonth.status, "ACTIVE");
  assert.equal(result.lifetime.attended, 3);
});

test("counts imported present records without timestamps but does not treat absent records as check-ins", () => {
  const result = summarizeParticipation({
    registrationDate: "2026-10-01",
    asOf: "2026-10-24",
    events: [
      event("Children's Ministry", "2026-10-05"),
      event("Sunday Service", "2026-10-19"),
    ],
    checkIns: [
      { eventName: "Children's Ministry", eventDate: "2026-10-05", attendanceStatus: "present" },
      { eventName: "Sunday Service", eventDate: "2026-10-19", attendanceStatus: "absent" },
    ],
  });

  assert.equal(result.currentMonth.required, 2);
  assert.equal(result.currentMonth.attended, 1);
  assert.equal(result.currentMonth.absent, 1);
});

test("calculates missed monthly participation and yearly totals", () => {
  const result = summarizeParticipation({
    registrationDate: "2026-09-01",
    asOf: "2026-10-24",
    events: [
      event("Children's Ministry", "2026-09-05"),
      event("Sunday Service", "2026-09-19"),
      event("Children's Ministry", "2026-10-05"),
      event("Sunday Service", "2026-10-19"),
    ],
    checkIns: [checkIn("Children's Ministry", "2026-09-05 09:00:00")],
  });

  assert.equal(result.months[1].attended, 1);
  assert.equal(result.months[1].absent, 1);
  assert.equal(result.months[0].attended, 0);
  assert.equal(result.months[0].absent, 2);
  assert.equal(result.lifetime.absent, 3);
  assert.equal(result.currentYear.required, 4);
  assert.equal(result.currentYear.absent, 3);
});

test("keeps historical absences while annual status thresholds reset", () => {
  const events = Array.from({ length: 6 }, (_, index) =>
    event(
      `Activity ${index + 1}`,
      `2026-${String(10 + Math.floor(index / 2)).padStart(2, "0")}-${index % 2 ? "19" : "05"}`,
    ),
  );
  const result = summarizeParticipation({
    registrationDate: "2026-10-01",
    asOf: "2027-01-02",
    events,
    checkIns: [
      checkIn("Activity 1", "2026-10-05 09:00:00"),
      checkIn("Activity 2", "2026-10-19 09:00:00"),
    ],
  });

  assert.equal(result.years.find((year) => year.year === 2026).absent, 4);
  assert.equal(result.currentYear.absent, 0);
  assert.equal(getParticipationStatus({ currentYearAbsences: result.currentYear.absent }), "ACTIVE");
});

test("does not count absences in months without scheduled activities", () => {
  const result = summarizeParticipation({
    registrationDate: "2026-10-15",
    asOf: "2026-10-24",
  });

  assert.equal(result.months.length, 1);
  assert.equal(result.currentMonth.required, 0);
  assert.equal(result.currentMonth.absent, 0);
  assert.equal(result.currentMonth.status, "ACTIVE");
  assert.equal(result.lifetime.required, 0);
  assert.equal(result.lifetime.absent, 0);
});

test("counts actual scheduled activities rather than assuming two each month", () => {
  const result = summarizeParticipation({
    registrationDate: "2026-09-01",
    asOf: "2026-10-24",
    events: [
      event("Sunday Service", "2026-09-19"),
      event("Children's Ministry", "2026-10-05"),
      event("Sunday Service", "2026-10-19"),
    ],
    checkIns: [checkIn("Sunday Service", "2026-09-19 09:00:00")],
  });

  assert.equal(result.months[0].required, 2);
  assert.equal(result.months[0].attended, 0);
  assert.equal(result.months[0].absent, 2);
  assert.equal(result.months[1].required, 1);
  assert.equal(result.months[1].attended, 1);
  assert.equal(result.months[1].absent, 0);
  assert.equal(result.lifetime.absent, 2);
});

test("full attendance at a sparse event schedule does not create false absences", () => {
  const dates = [
    "2021-10-10", "2021-12-05", "2022-01-30", "2022-03-27", "2022-05-22",
    "2022-07-17", "2022-09-11", "2022-11-06", "2023-01-01", "2023-02-26",
    "2023-04-23", "2023-06-18", "2023-08-13", "2023-10-08", "2023-12-03",
    "2024-01-28", "2024-03-24", "2024-05-19", "2024-07-14", "2024-09-08",
    "2024-11-03", "2024-12-29", "2025-02-23", "2025-04-20", "2025-06-15",
    "2025-08-10", "2025-10-05", "2025-11-30", "2026-01-25", "2026-03-22",
    "2026-05-17", "2026-07-12", "2026-09-06", "2026-10-04", "2026-10-25",
  ];
  const activities = dates.map((date, index) => event(`Activity ${index}`, date));
  const checkIns = dates.map((date, index) => checkIn(`Activity ${index}`, `${date} 09:00:00`));

  const result = summarizeParticipation({
    registrationDate: "2021-10-01",
    asOf: "2026-10-25",
    events: activities,
    checkIns,
  });

  assert.equal(result.lifetime.required, 35);
  assert.equal(result.lifetime.attended, 35);
  assert.equal(result.lifetime.absent, 0);
});

test("counts attended activities even when they are not the first events that month", () => {
  const result = summarizeParticipation({
    registrationDate: "2026-10-01",
    asOf: "2026-10-24",
    events: [
      event("First Activity", "2026-10-05"),
      event("Second Activity", "2026-10-12"),
      event("Third Activity", "2026-10-19"),
    ],
    checkIns: [
      checkIn("Second Activity", "2026-10-12 09:00:00"),
      checkIn("Third Activity", "2026-10-19 09:00:00"),
    ],
  });

  assert.equal(result.currentMonth.attended, 2);
  assert.equal(result.currentMonth.absent, 1);
  assert.equal(result.currentMonth.status, "WARNING");
});

test("does not count check-ins that cannot be matched to a scheduled event", () => {
  const result = summarizeParticipation({
    registrationDate: "2026-10-01",
    asOf: "2026-10-24",
    events: [event("Sunday Service", "2026-10-05")],
    checkIns: [
      checkIn("Sunday Service", "2026-10-05 09:00:00"),
      checkIn("Unscheduled Activity", "2026-10-07 09:00:00"),
    ],
  });

  assert.equal(result.currentMonth.required, 1);
  assert.equal(result.currentMonth.attended, 1);
  assert.equal(result.lifetime.required, 1);
});

test("requires two post-second-chance absences before removal is eligible", () => {
  assert.equal(isRemovalEligible({
    secondChanceGranted: true,
    postSecondChanceAbsences: 1,
    removed: false,
  }), false);
  assert.equal(isRemovalEligible({
    secondChanceGranted: true,
    postSecondChanceAbsences: 2,
    removed: false,
  }), true);
  assert.equal(isRemovalEligible({
    secondChanceGranted: false,
    postSecondChanceAbsences: 2,
    removed: false,
  }), false);
  assert.equal(isRemovalEligible({
    secondChanceGranted: true,
    postSecondChanceAbsences: 2,
    removed: true,
  }), false);
});

test("ignores attendance before the participant registration date", () => {
  const result = summarizeParticipation({
    registrationDate: "2026-10-15",
    asOf: "2026-10-24",
    events: [
      event("Sunday Service", "2026-10-05"),
      event("Sunday Service", "2026-10-19"),
      event("Children's Ministry", "2026-10-22"),
    ],
    checkIns: [checkIn("Sunday Service", "2026-10-19 09:00:00")],
  });

  assert.equal(result.currentMonth.required, 2);
  assert.equal(result.currentMonth.attended, 1);
  assert.equal(result.currentMonth.absent, 1);
  assert.equal(result.lifetime.absent, 1);
});

test("calculates yearly attendance and absence rates from actual scheduled activities", () => {
  const result = summarizeParticipation({
    registrationDate: "2025-01-01",
    asOf: "2026-10-24",
    events: [
      event("Service", "2025-01-05"),
      event("Service", "2025-01-12"),
      event("Service", "2025-01-19"),
      event("Service", "2025-01-26"),
    ],
    checkIns: [
      checkIn("Service", "2025-01-05 09:00:00"),
      checkIn("Service", "2025-01-12 09:00:00"),
      checkIn("Service", "2025-01-19 09:00:00"),
    ],
  });

  assert.deepEqual(result.years.find((year) => year.year === 2025), {
    year: 2025,
    required: 4,
    attended: 3,
    absent: 1,
    attendanceRate: 75,
    absenceRate: 25,
  });
  assert.equal(result.currentYear.year, 2026);
  assert.equal(result.currentYear.required, 0);
});

test("evaluates annual status thresholds at four, five, and six absences", () => {
  assert.equal(getParticipationStatus({ currentYearAbsences: 3 }), "ACTIVE");
  assert.equal(getParticipationStatus({
    currentYearAbsences: 4,
  }), "WARNING");
  assert.equal(getParticipationStatus({
    currentYearAbsences: 5,
  }), "WARNING");
  assert.equal(getParticipationStatus({
    currentYearAbsences: 6,
  }), "GROUNDS_FOR_DEPARTURE");
});

test("resets participation thresholds from the second-chance absence checkpoint", () => {
  assert.equal(getParticipationStatus({
    currentYearAbsences: 6,
    secondChanceAbsenceCount: 6,
  }), "ACTIVE");
  assert.equal(getParticipationStatus({
    currentYearAbsences: 10,
    secondChanceAbsenceCount: 6,
  }), "WARNING");
  assert.equal(getParticipationStatus({
    currentYearAbsences: 12,
    secondChanceAbsenceCount: 6,
  }), "GROUNDS_FOR_DEPARTURE");
});

test("keeps inactive decisions distinct from annual attendance thresholds", () => {
  assert.equal(getParticipationStatus({ currentYearAbsences: 8, removed: true }), "INACTIVE");
});
