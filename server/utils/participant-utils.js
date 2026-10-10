function calculateAge(dateOfBirth, today = new Date()) {
  const date = String(dateOfBirth || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const birth = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== date) return null;

  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age < 0 ? null : age;
}

function normalizePhilippineMobile(value) {
  const digits = String(value || '').trim().replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\+639\d{9}$/.test(digits)) return digits;
  return null;
}

function normalizeParticipantName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function findPotentialParticipantDuplicates(candidate, existingParticipants) {
  const candidateName = normalizeParticipantName(candidate.fullName);
  const candidateDateOfBirth = String(candidate.dateOfBirth || '').slice(0, 10);
  const candidateFirstName = normalizeParticipantName(candidate.firstName);
  const candidateLastName = normalizeParticipantName(candidate.lastName);

  return existingParticipants.flatMap((participant) => {
    const existingName = normalizeParticipantName(participant.fullName);
    const existingDateOfBirth = String(participant.dateOfBirth || '').slice(0, 10);
    const sameName = candidateName && candidateName === existingName;
    const sameDateAndNames = candidateDateOfBirth &&
      candidateDateOfBirth === existingDateOfBirth &&
      candidateFirstName === normalizeParticipantName(participant.firstName) &&
      candidateLastName === normalizeParticipantName(participant.lastName);

    if (!sameName && !sameDateAndNames) return [];
    return [{
      id: participant.id,
      participantCode: participant.participant_code,
      fullName: participant.fullName,
      dateOfBirth: participant.dateOfBirth,
      age: calculateAge(participant.dateOfBirth),
      exact: Boolean(sameName && candidateDateOfBirth === existingDateOfBirth),
    }];
  });
}

function participantRegistrationErrors(body, educationLevels, gradeLevelsByEducation) {
  const errors = {};
  for (const field of ['firstName', 'lastName']) {
    if (!String(body[field] || '').trim()) errors[field] = 'This field is required.';
    else if (String(body[field]).trim().length > 100) errors[field] = 'Use 100 characters or fewer.';
  }
  if (String(body.middleName || '').trim().length > 100) {
    errors.middleName = 'Use 100 characters or fewer.';
  }
  if (!['Male', 'Female'].includes(String(body.gender || '').trim())) {
    errors.gender = 'Select Male or Female.';
  }
  if (!String(body.emergencyContactName || '').trim()) {
    errors.emergencyContactName = 'Guardian/emergency contact name is required.';
  } else if (String(body.emergencyContactName).trim().length > 100) {
    errors.emergencyContactName = 'Use 100 characters or fewer.';
  }
  if (!normalizePhilippineMobile(body.emergencyContactPhone)) {
    errors.emergencyContactPhone = 'Enter a valid Philippine mobile number.';
  }

  const age = calculateAge(body.dateOfBirth);
  if (age === null) {
    errors.dateOfBirth = 'Enter a valid date of birth.';
  } else if (age < 6 || age > 22) {
    errors.dateOfBirth = 'Sponsored children must be between 6 and 22 years old.';
  }
  if (!educationLevels.has(body.educationLevel)) {
    errors.educationLevel = 'Select an education level.';
  } else if (!gradeLevelsByEducation[body.educationLevel]?.has(body.gradeLevel)) {
    errors.gradeLevel = 'Select a valid grade or year level.';
  }
  if (body.educationLevel === 'College' && !String(body.programCourse || '').trim()) {
    errors.programCourse = 'Enter the college program or course.';
  } else if (String(body.programCourse || '').trim().length > 200) {
    errors.programCourse = 'Use 200 characters or fewer.';
  }
  if (String(body.schoolName || '').trim().length > 200) {
    errors.schoolName = 'Use 200 characters or fewer.';
  }
  if (String(body.schoolAddress || '').trim().length > 500) {
    errors.schoolAddress = 'Use 500 characters or fewer.';
  }
  return errors;
}

module.exports = {
  calculateAge,
  findPotentialParticipantDuplicates,
  normalizeParticipantName,
  normalizePhilippineMobile,
  participantRegistrationErrors,
};
