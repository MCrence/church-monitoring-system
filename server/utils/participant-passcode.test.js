const assert = require('node:assert/strict');
const test = require('node:test');

const { createParticipantPasscode, isValidParticipantPasscode } = require('./participant-passcode');

test('accepts exactly six numeric digits, including leading zeroes', () => {
  assert.equal(isValidParticipantPasscode('012345'), true);
  assert.equal(isValidParticipantPasscode('987654'), true);
});

test('generates six numeric digits and preserves leading zeroes', () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(createParticipantPasscode(), /^\d{6}$/);
  }
});

test('rejects incorrect length, non-digits, and non-string values', () => {
  for (const value of ['', '12345', '1234567', '12a456', 123456, null, undefined]) {
    assert.equal(isValidParticipantPasscode(value), false);
  }
});
