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

function participantRegistrationErrors(body, educationLevels, gradeLevelsByEducation, today = new Date()) {
  const errors = {};
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const text = (field) => typeof input[field] === 'string' ? input[field] : '';
  const trimmed = (field) => text(field).trim();
  const namePattern = /^\p{L}+(?:[ ]+\p{L}+)*$/u;
  const guardianNamePattern = /^\p{L}+(?:[ '\u2019-]+\p{L}+)*$/u;
  for (const field of ['firstName', 'lastName']) {
    const value = trimmed(field);
    const label = field === 'firstName' ? 'First name' : 'Last name';
    if (!value) errors[field] = `${label} is required.`;
    else if (value.length > 50) errors[field] = `${label} must be 50 characters or fewer.`;
    else if (value.length < 2 || !namePattern.test(value)) {
      errors[field] = `${label} must contain letters only.`;
    }
  }
  const middleName = trimmed('middleName');
  if (middleName.length > 50) {
    errors.middleName = 'Middle name must be 50 characters or fewer.';
  } else if (middleName && !namePattern.test(middleName)) {
    errors.middleName = 'Middle name must contain letters only.';
  }
  if (!['Male', 'Female'].includes(trimmed('gender'))) {
    errors.gender = 'Please select a sex.';
  }
  const guardianName = trimmed('emergencyContactName');
  if (!guardianName) {
    errors.emergencyContactName = 'Guardian name is required.';
  } else if (
    guardianName.length > 100 ||
    !guardianNamePattern.test(guardianName)
  ) {
    errors.emergencyContactName = 'Guardian name must contain a valid name.';
  }
  const guardianPhone = text('emergencyContactPhone');
  if (!guardianPhone) {
    errors.emergencyContactPhone = 'Guardian contact number is required.';
  } else if (!/^09[0-9]{9}$/.test(guardianPhone)) {
    errors.emergencyContactPhone = 'Guardian contact number must be 11 digits and start with 09.';
  }

  const dateOfBirth = text('dateOfBirth');
  const parsedBirthDate = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
    ? new Date(`${dateOfBirth}T00:00:00.000Z`)
    : null;
  const validBirthDate = parsedBirthDate &&
    !Number.isNaN(parsedBirthDate.getTime()) &&
    parsedBirthDate.toISOString().slice(0, 10) === dateOfBirth;
  const age = validBirthDate ? calculateAge(dateOfBirth, today) : null;
  if (!dateOfBirth) {
    errors.dateOfBirth = 'Date of birth is required.';
  } else if (!validBirthDate) {
    errors.dateOfBirth = 'Enter a valid date of birth.';
  } else if (dateOfBirth > today.toISOString().slice(0, 10)) {
    errors.dateOfBirth = 'Date of birth cannot be in the future.';
  } else if (age < 6) {
    errors.dateOfBirth = 'Child must be at least 6 years old.';
  } else if (age > 22) {
    errors.dateOfBirth = 'Child must not be older than 22 years.';
  }
  const educationLevel = trimmed('educationLevel');
  if (!educationLevels.has(educationLevel)) {
    errors.educationLevel = 'Please select an education level.';
  } else {
    if (!gradeLevelsByEducation[educationLevel]?.has(trimmed('gradeLevel'))) {
      errors.gradeLevel = 'Please select a grade/year.';
    }
    if (!trimmed('schoolName')) {
      errors.schoolName = 'School currently attending is required.';
    } else if (
      trimmed('schoolName').length > 150 ||
      !/\p{L}/u.test(trimmed('schoolName')) ||
      !/^[\p{L}\p{N}\s.'’&,()/-]+$/u.test(trimmed('schoolName'))
    ) {
      errors.schoolName = 'Enter a valid school name (150 characters or fewer).';
    }
    if (!trimmed('schoolAddress')) {
      errors.schoolAddress = 'School address is required.';
    } else if (trimmed('schoolAddress').length > 255) {
      errors.schoolAddress = 'School address must be 255 characters or fewer.';
    }
  }
  const programCourse = trimmed('programCourse');
  if (educationLevel === 'College' && !programCourse) {
    errors.programCourse = 'College students must provide their course.';
  } else if (programCourse.length > 200 || (programCourse && !programCourse.trim())) {
    errors.programCourse = 'College course must be 200 characters or fewer.';
  }
  const address = trimmed('address');
  if (text('address') && !address) {
    errors.address = 'Home address cannot contain only spaces.';
  } else if (address && address.length < 5) {
    errors.address = 'Home address must be at least 5 characters.';
  } else if (address.length > 255) {
    errors.address = 'Home address must be 255 characters or fewer.';
  }
  for (const [field, label, maximum] of [
    ['weight', 'Weight', 500],
    ['height', 'Height', 300],
  ]) {
    const value = text(field);
    if (value && (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0 || Number(value) > maximum)) {
      errors[field] = `${label} must be a number greater than 0 and no more than ${maximum}.`;
    }
  }
  const medicalConditions = text('medicalConditions');
  if (medicalConditions.length > 500) {
    errors.medicalConditions = 'Medical conditions must be 500 characters or fewer.';
  } else if (medicalConditions && !medicalConditions.trim()) {
    errors.medicalConditions = 'Enter medical conditions or leave this field blank.';
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
