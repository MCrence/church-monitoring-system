const assert = require('node:assert/strict');
const test = require('node:test');

const { canonicalClientOrigin, getProductionSecurityErrors } = require('./security-config');

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

test('canonicalizes a single trailing slash without allowing paths or origin decorations', () => {
  assert.equal(canonicalClientOrigin('https://church.example/'), 'https://church.example');
  assert.equal(canonicalClientOrigin('https://church.example/path'), null);
  assert.equal(canonicalClientOrigin('https://church.example/?query=1'), null);
  assert.equal(canonicalClientOrigin('https://church.example/#fragment'), null);
  assert.equal(canonicalClientOrigin('https://user@church.example'), null);
  assert.equal(canonicalClientOrigin('http://church.example/'), null);
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
    'CLIENT_ORIGIN must be set to the HTTPS origin of the production client',
  ]);
});
