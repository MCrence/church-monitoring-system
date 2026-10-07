const GOER_EDUCATION_LEVELS = Object.freeze([
  'Elementary',
  'Junior High School',
  'Senior High School',
  'College',
]);

function isGoerRole(role) {
  return String(role || '').toLowerCase() === 'goer';
}

function canGoerUsePermission(role, permission) {
  return !isGoerRole(role) || [
    'checkin:record',
    'goer-care:view',
    'goer-care:record',
  ].includes(permission);
}

function canGoerAccessParticipant(user, participant) {
  if (!isGoerRole(user?.role)) return true;
  return Boolean(
    participant &&
    participant.participant_type === 'sponsored_child' &&
    participant.status === 'active' &&
    GOER_EDUCATION_LEVELS.includes(user.goerEducationLevel) &&
    participant.education_level === user.goerEducationLevel
  );
}

function canGoerManageCare(user) {
  return isGoerRole(user?.role) &&
    GOER_EDUCATION_LEVELS.includes(user.goerEducationLevel) &&
    Array.isArray(user.permissions) &&
    user.permissions.includes('goer-care:record');
}

module.exports = {
  GOER_EDUCATION_LEVELS,
  canGoerAccessParticipant,
  canGoerManageCare,
  canGoerUsePermission,
  isGoerRole,
};
