const { decrypt, encrypt } = require('./encryption');

const encryptedLetterPrefix = 'FMCLETTER1:';

function encryptLetter(value) {
  if (value === null || value === undefined) return null;
  return encryptedLetterPrefix + encrypt(value);
}

function decryptLetter(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.startsWith(encryptedLetterPrefix)
    ? decrypt(text.slice(encryptedLetterPrefix.length))
    : text;
}

module.exports = { decryptLetter, encryptLetter };
