function getAttendanceTransition(action, latestAttendance) {
  if (!['check_in', 'check_out'].includes(action)) {
    throw new Error('Attendance action must be check_in or check_out');
  }
  if (action === 'check_in') {
    return latestAttendance ? 'duplicate' : 'check_in';
  }
  if (!latestAttendance || latestAttendance.checked_out_at) {
    return 'no_active_checkin';
  }
  return 'check_out';
}

module.exports = { getAttendanceTransition };
