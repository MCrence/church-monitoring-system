const crypto = require('crypto');

const algorithm = 'aes-256-gcm';
const keyText = process.env.AES_KEY;

if (!keyText || !/^[0-9a-f]{64}$/i.test(keyText)) {
  throw new Error('AES_KEY must be a 64-character hexadecimal AES-256 key');
}

const key = Buffer.from(keyText, 'hex');

function encrypt(value) {
  if (value === null || value === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value) {
  if (value === null || value === undefined) return null;
  const parts = String(value).split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted value');
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };