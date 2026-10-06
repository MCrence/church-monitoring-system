const assert = require('node:assert/strict');
const test = require('node:test');

const { getProductionSecurityErrors } = require('./security-config');

test('does not impose deployment-only requirements outside production', () => {
  assert.deepEqual(getProductionSecurityErrors({ NODE_ENV: 'development' }), []);
});

test('accepts production settings with independent strong secret and exact HTTPS origin', () => {
  assert.deepEqual(getProductionSecurityErrors({
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(64),
    AES_KEY: 'a'.repeat(64),
    CLIENT_ORIGIN: 'https://church.example',
  }), []);
});

test('rejects weak, reused, or malformed production security settings', () => {
  assert.deepEqual(getProductionSecurityErrors({
    NODE_ENV: 'production',
    JWT_SECRET: 'weak',
    AES_KEY: 'weak',
    CLIENT_ORIGIN: 'http://church.example/path',
  }), [
    'JWT_SECRET must contain at least 32 bytes in production',
    'JWT_SECRET and AES_KEY must be different secrets',
    'CLIENT_ORIGIN must be an exact HTTPS origin without a path or wildcard',
  ]);
});
