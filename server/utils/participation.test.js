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

test("starts monthly requirements from the registration month", () => {
  const result = summarizeParticipation({
    registrationDate: "2026-10-15",
    asOf: "2026-10-24",
  });

  assert.equal(result.months.length, 1);
  assert.equal(result.lifetime.required, 2);
  assert.equal(result.lifetime.absent, 2);
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

test("keeps second chance and removal distinct from the absence threshold", () => {
  assert.equal(getParticipationStatus({ totalAbsences: 6, monthlyCompliant: false }), "GROUNDS_FOR_DEPARTURE");
  assert.equal(getParticipationStatus({ totalAbsences: 6, monthlyCompliant: true, secondChanceGranted: true }), "SECOND_CHANCE");
  assert.equal(getParticipationStatus({ totalAbsences: 8, secondChanceGranted: true, removed: true }), "REMOVED_FROM_SPONSORSHIP");
});
