const assert = require('node:assert/strict');
const test = require('node:test');

const { getAttendanceTransition } = require('./attendance-transition');

test('starts a new check-in when there is no attendance record today', () => {
  assert.equal(getAttendanceTransition('check_in', null), 'check_in');
});

test('does not create another daily check-in record', () => {
  assert.equal(getAttendanceTransition('check_in', { checked_out_at: null }), 'duplicate');
  assert.equal(getAttendanceTransition('check_in', { checked_out_at: new Date() }), 'duplicate');
});

test('checks out an active attendance record', () => {
  assert.equal(getAttendanceTransition('check_out', { checked_out_at: null }), 'check_out');
});

test('requires an active check-in before check-out', () => {
  assert.equal(getAttendanceTransition('check_out', null), 'no_active_checkin');
  assert.equal(getAttendanceTransition('check_out', { checked_out_at: new Date() }), 'no_active_checkin');
});

test('rejects unsupported attendance actions', () => {
  assert.throws(() => getAttendanceTransition('toggle', null), /must be check_in or check_out/);
});
