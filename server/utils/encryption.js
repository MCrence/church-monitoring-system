const crypto = require('crypto');

const algorithm = 'aes-256-gcm';
const legacyKeyText = process.env.AES_KEY;
const activeKeyId = process.env.AES_KEY_ID || 'primary';
const blobPrefix = Buffer.from('FMCENC1:', 'ascii');

function parseKey(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be a 64-character hexadecimal AES-256 key`);
  }
  return Buffer.from(value, 'hex');
}

function validateKeyId(keyId) {
  return typeof keyId === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(keyId);
}

if (!legacyKeyText) {
  throw new Error('AES_KEY is required for legacy decryption compatibility');
}
if (!validateKeyId(activeKeyId)) {
  throw new Error('AES_KEY_ID must contain 1 to 32 letters, digits, underscores, or hyphens');
}

const legacyKey = parseKey(legacyKeyText, 'AES_KEY');
let configuredKeyring = {};
if (process.env.AES_KEYRING) {
  try {
    configuredKeyring = JSON.parse(process.env.AES_KEYRING);
  } catch {
    throw new Error('AES_KEYRING must be a JSON object mapping key IDs to 64-character hexadecimal keys');
  }
  if (!configuredKeyring || Array.isArray(configuredKeyring) || typeof configuredKeyring !== 'object') {
    throw new Error('AES_KEYRING must be a JSON object mapping key IDs to 64-character hexadecimal keys');
  }
}

const keys = new Map([['legacy', legacyKey]]);
for (const [keyId, keyText] of Object.entries(configuredKeyring)) {
  if (!validateKeyId(keyId)) throw new Error('AES_KEYRING contains an invalid key ID');
  keys.set(keyId, parseKey(keyText, `AES_KEYRING.${keyId}`));
}
if (!keys.has(activeKeyId)) {
  if (activeKeyId === 'primary') keys.set(activeKeyId, legacyKey);
  else throw new Error('AES_KEY_ID must refer to a key in AES_KEYRING');
}

function seal(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, keys.get(activeKeyId), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    'v1',
    activeKeyId,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

function open(envelope) {
  const [version, keyId, ivText, tagText, encryptedText, ...extra] = envelope.split('.');
  if (version !== 'v1' || extra.length || !validateKeyId(keyId)) {
    throw new Error('Invalid encrypted value');
  }
  const key = keys.get(keyId);
  if (!key) throw new Error(`Encryption key "${keyId}" is unavailable`);
  const iv = Buffer.from(ivText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  const encrypted = Buffer.from(encryptedText, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Invalid encrypted value');
  }
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function encrypt(value) {
  if (value === null || value === undefined) return null;
  return seal(Buffer.from(String(value), 'utf8'));
}

function decrypt(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text.startsWith('v1.')) return open(text).toString('utf8');

  const parts = text.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted value');
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted value');
  const decipher = crypto.createDecipheriv(algorithm, legacyKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function encryptBytes(value) {
  if (value === null || value === undefined) return null;
  return Buffer.concat([blobPrefix, Buffer.from(seal(Buffer.from(value)))]);
}

function decryptBytes(value) {
  if (value === null || value === undefined) return null;
  const data = Buffer.from(value);
  if (!data.subarray(0, blobPrefix.length).equals(blobPrefix)) return data;
  return open(data.subarray(blobPrefix.length).toString('ascii'));
}

module.exports = { decrypt, decryptBytes, encrypt, encryptBytes };
