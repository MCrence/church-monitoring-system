const REQUIRED_IMPORT_FIELDS = {
  participants: ['firstName', 'lastName', 'gender', 'dateOfBirth', 'registrationDate', 'currentStatus'],
  events: ['eventName', 'eventDate', 'eventStatus'],
  education: ['schoolName', 'educationLevel', 'schoolYear', 'startDate', 'status'],
  attendance: ['participantId', 'attendanceStatus'],
  attendanceSummary: ['participantId', 'year', 'required', 'attended', 'absent'],
};

const ALLOWED_IMPORT_FIELDS = {
  participants: ['participantId', 'participantCode', 'firstName', 'middleName', 'lastName', 'suffix', 'gender', 'dateOfBirth', 'age', 'phone', 'address', 'registrationDate', 'currentStatus', 'guardianName', 'guardianRelationship', 'guardianContact', 'guardianEmail'],
  events: ['eventId', 'eventName', 'eventType', 'eventDescription', 'educationGroup', 'eventDate', 'startTime', 'endTime', 'eventLocation', 'eventStatus', 'createdDate'],
  education: ['educationHistoryId', 'participantId', 'participantCode', 'participantName', 'schoolName', 'schoolAddress', 'gradeLevel', 'educationLevel', 'schoolYear', 'startDate', 'endDate', 'status', 'completionInformation'],
  attendance: ['attendanceRecordId', 'participantId', 'participantName', 'gender', 'educationLevel', 'eventId', 'eventName', 'eventDate', 'attendanceStatus', 'checkedInAt', 'checkedOutAt', 'recordedBy', 'attendanceRemarks'],
  attendanceSummary: ['participantId', 'year', 'required', 'attended', 'absent', 'attendanceRate', 'absenceRate'],
};

function validateImportHeaders(type, headers, mapping) {
  if (!REQUIRED_IMPORT_FIELDS[type] || !ALLOWED_IMPORT_FIELDS[type]) return ['Choose a supported import type'];
  if (!Array.isArray(headers) || !Array.isArray(mapping) || headers.length !== mapping.length) {
    return ['File columns could not be mapped. Re-upload the file and map its headers.'];
  }
  const errors = [];
  const mapped = mapping.filter(Boolean);
  const unsupported = [...new Set(mapped.filter((field) => !ALLOWED_IMPORT_FIELDS[type].includes(field)))];
  if (unsupported.length) errors.push(`Unsupported fields for this import type: ${unsupported.join(', ')}`);
  const missing = REQUIRED_IMPORT_FIELDS[type].filter((field) => !mapped.includes(field));
  if (type === 'education' && !mapped.includes('participantId') && !mapped.includes('participantCode')) {
    missing.unshift('Sponsored Child ID or Sponsored Child Code');
  }
  if (type === 'attendance' && !mapped.includes('eventId') &&
      !(mapped.includes('eventName') && mapped.includes('eventDate'))) {
    missing.push('Activity/Event ID or Activity Name and Event Date');
  }
  if (missing.length) errors.push(`Missing required columns: ${missing.join(', ')}`);
  const unmapped = headers.filter((header, index) => !mapping[index]);
  if (unmapped.length) errors.push(`Unrecognized columns must be mapped or removed: ${unmapped.join(', ')}`);
  const repeated = [...new Set(mapped.filter((field, index) => mapped.indexOf(field) !== index))];
  if (repeated.length) errors.push(`Columns are mapped more than once: ${repeated.join(', ')}`);
  return errors;
}

function normalizeSponsorshipStatus(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  const statuses = {
    active: 'ACTIVE',
    warning: 'WARNING',
    'ground for departure': 'GROUNDS_FOR_DEPARTURE',
    'grounds for departure': 'GROUNDS_FOR_DEPARTURE',
    inactive: 'INACTIVE',
  };
  return statuses[normalized] || null;
}

function normalizeEventStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const statuses = {
    scheduled: 'scheduled',
    completed: 'completed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
  };
  return statuses[normalized] || null;
}

function normalizeEducationStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return {
    'currently attending': 'Currently Attending',
    graduated: 'Graduated',
    completed: 'Completed',
    transferred: 'Transferred',
    dropped: 'Dropped',
    other: 'Other',
  }[normalized] || null;
}

function parseSchoolYear(value) {
  const match = String(value || '').match(/(?:^|\D)(\d{4})(?:\s*[-/]\s*(\d{4}))?(?:\D|$)/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2] || match[1]);
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) return null;
  return { startYear, endYear };
}

function normalizeImportTime(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  const match = input.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const meridiem = match[4]?.toUpperCase();
  if (minute > 59 || second > 59 || hour > (meridiem ? 12 : 23) || hour < (meridiem ? 1 : 0)) return null;
  if (meridiem) hour = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

module.exports = {
  normalizeEducationStatus,
  normalizeEventStatus,
  normalizeImportTime,
  normalizeSponsorshipStatus,
  parseSchoolYear,
  validateImportHeaders,
};
