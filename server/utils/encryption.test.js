const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const legacyKey = 'a'.repeat(64);
const rotatedKey = 'b'.repeat(64);
process.env.AES_KEY = legacyKey;
process.env.AES_KEY_ID = 'rotated';
process.env.AES_KEYRING = JSON.stringify({ rotated: rotatedKey });

const { decrypt, decryptBytes, encrypt, encryptBytes } = require('./encryption');
const { decryptLetter, encryptLetter } = require('./letter-encryption');

function legacyEncrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(legacyKey, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

test('decrypts existing unversioned AES-256-GCM field values', () => {
  assert.equal(decrypt(legacyEncrypt('legacy participant value')), 'legacy participant value');
});

test('encrypts and decrypts field values with the selected key ID', () => {
  const encrypted = encrypt('new participant value');
  assert.match(encrypted, /^v1\.rotated\./);
  assert.equal(decrypt(encrypted), 'new participant value');
});

test('encrypts binary uploads and still reads existing plaintext blobs', () => {
  const original = crypto.randomBytes(512);
  const encrypted = encryptBytes(original);
  assert.notDeepEqual(encrypted, original);
  assert.deepEqual(decryptBytes(encrypted), original);
  assert.deepEqual(decryptBytes(original), original);
});

test('rejects modified authenticated ciphertext', () => {
  const encrypted = encrypt('authenticated value');
  const parts = encrypted.split('.');
  const modifiedCiphertext = Buffer.from(parts[4], 'base64url');
  modifiedCiphertext[0] ^= 1;
  parts[4] = modifiedCiphertext.toString('base64url');
  assert.throws(() => decrypt(parts.join('.')));
});

test('rejects encrypted values when their key ID is unavailable', () => {
  const parts = encrypt('rotated participant value').split('.');
  parts[1] = 'retired';
  assert.throws(() => decrypt(parts.join('.')), /key "retired" is unavailable/);
});

test('encrypts new letter bodies and continues returning legacy plaintext letters', () => {
  const encrypted = encryptLetter('Private guardian message');
  assert.match(encrypted, /^FMCLETTER1:v1\.rotated\./);
  assert.equal(decryptLetter(encrypted), 'Private guardian message');
  assert.equal(decryptLetter('Existing plaintext message'), 'Existing plaintext message');
});
