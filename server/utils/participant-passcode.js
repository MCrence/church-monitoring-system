const crypto = require('node:crypto');

function isValidParticipantPasscode(value) {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

function createParticipantPasscode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

module.exports = { createParticipantPasscode, isValidParticipantPasscode };
