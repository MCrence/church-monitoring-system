const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getParticipationStatus,
  isRemovalEligible,
  summarizeParticipation,
} = require("./participation");

const event = (name, date) => ({ name, date });
const checkIn = (eventName, checkedInAt) => ({ eventName, checkedInAt });

test("counts no more than two unique attended activities per month", () => {
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

  assert.equal(result.currentMonth.required, 2);
  assert.equal(result.currentMonth.attended, 2);
  assert.equal(result.currentMonth.absent, 0);
  assert.equal(result.currentMonth.status, "ACTIVE");
  assert.equal(result.lifetime.attended, 2);
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

test("counts only scheduled activities toward the monthly requirement", () => {
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

  assert.equal(result.months[1].required, 1);
  assert.equal(result.months[1].attended, 1);
  assert.equal(result.months[1].absent, 0);
  assert.equal(result.months[0].required, 2);
  assert.equal(result.months[0].attended, 0);
  assert.equal(result.months[0].absent, 2);
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
  assert.equal(result.currentMonth.absent, 0);
  assert.equal(result.currentMonth.status, "ACTIVE");
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

test("treats 3 to 4 recent absences as a warning before grounds is triggered", () => {
  assert.equal(getParticipationStatus({
    totalAbsences: 4,
    monthsMonitored: 4,
    recentThreeMonthAbsences: 4,
    monthlyCompliant: true,
  }), "WARNING");
  assert.equal(getParticipationStatus({
    totalAbsences: 7,
    monthsMonitored: 3,
    recentThreeMonthAbsences: 2,
    monthlyCompliant: false,
  }), "WARNING");
  assert.equal(getParticipationStatus({
    totalAbsences: 7,
    recentThreeMonthAbsences: 2,
    monthlyCompliant: false,
  }), "WARNING");
});

test("keeps second chance and removal distinct from the absence threshold", () => {
  assert.equal(getParticipationStatus({ totalAbsences: 6, monthsMonitored: 4, monthlyCompliant: false }), "WARNING");
  assert.equal(getParticipationStatus({ totalAbsences: 7, monthsMonitored: 4, monthlyCompliant: false }), "GROUNDS_FOR_DEPARTURE");
  assert.equal(getParticipationStatus({ totalAbsences: 7, monthsMonitored: 4, monthlyCompliant: true, secondChanceGranted: true }), "SECOND_CHANCE");
  assert.equal(getParticipationStatus({ totalAbsences: 8, secondChanceGranted: true, removed: true }), "REMOVED_FROM_SPONSORSHIP");
});
