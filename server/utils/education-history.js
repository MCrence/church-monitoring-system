const EDUCATION_LEVELS = new Set([
  'Elementary',
  'Junior High School',
  'Senior High School',
  'College',
  'Vocational',
  'Other',
]);

const EDUCATION_STATUSES = new Set([
  'Currently Attending',
  'Graduated',
  'Completed',
  'Transferred',
  'Dropped',
  'Other',
]);

function validateEducationRecord(record, currentYear = new Date().getFullYear()) {
  const errors = [];
  const educationLevel = String(record.educationLevel || '').trim();
  const schoolName = String(record.schoolName || '').trim();
  const status = String(record.status || '').trim();
  const startYear = Number(record.startYear);
  const endYear = record.endYear === '' || record.endYear === null || record.endYear === undefined
    ? null
    : Number(record.endYear);

  if (!EDUCATION_LEVELS.has(educationLevel)) errors.push('Education level is required and must be recognized');
  if (!schoolName) errors.push('School name is required');
  if (!Number.isInteger(startYear) || startYear < 1900 || startYear > currentYear + 1) {
    errors.push('Start year must be a valid year');
  }
  if (!EDUCATION_STATUSES.has(status)) errors.push('Status is required and must be recognized');
  if (endYear !== null && (!Number.isInteger(endYear) || endYear < 1900 || endYear > currentYear + 1)) {
    errors.push('End year must be a valid year');
  }
  if (endYear !== null && Number.isInteger(startYear) && endYear < startYear) {
    errors.push('End year cannot be earlier than start year');
  }
  if (['Graduated', 'Completed'].includes(status) && endYear === null) {
    errors.push('End year is required for Graduated or Completed records');
  }
  return errors;
}

function educationRecordKey(record) {
  return [
    record.educationLevel,
    record.schoolName,
    record.schoolAddress || '',
    record.startYear,
    record.endYear || '',
    record.status,
    record.courseStrand || '',
  ].map((value) => String(value).trim().toLocaleLowerCase()).join('|');
}

module.exports = {
  EDUCATION_LEVELS,
  EDUCATION_STATUSES,
  educationRecordKey,
  validateEducationRecord,
};
