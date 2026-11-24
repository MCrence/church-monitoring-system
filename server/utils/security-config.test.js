const assert = require('node:assert/strict');
const test = require('node:test');

const { getAllowedClientOrigins, getProductionSecurityErrors } = require('./security-config');

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

test('allows the configured deployment origin and FMC custom domains in production', () => {
  const origins = getAllowedClientOrigins({
    NODE_ENV: 'production',
    CLIENT_ORIGIN: 'https://church-monitoring-system-rouge.vercel.app',
  });
  assert.equal(origins.has('https://church-monitoring-system-rouge.vercel.app'), true);
  assert.equal(origins.has('https://fmcsponsorship.site'), true);
  assert.equal(origins.has('https://www.fmcsponsorship.site'), true);
  assert.equal(origins.has('https://untrusted.example'), false);
});

test('accepts and validates additional exact HTTPS client origins', () => {
  const env = {
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(64),
    AES_KEY: 'a'.repeat(64),
    CLIENT_ORIGIN: 'https://church.example',
    CLIENT_ORIGINS: 'https://www.church.example, https://preview.example',
  };
  assert.deepEqual(getProductionSecurityErrors(env), []);
  const origins = getAllowedClientOrigins(env);
  assert.equal(origins.has('https://www.church.example'), true);
  assert.equal(origins.has('https://preview.example'), true);
  assert.deepEqual(getProductionSecurityErrors({
    ...env,
    CLIENT_ORIGINS: 'https://valid.example, *',
  }), ['CLIENT_ORIGINS must contain exact HTTPS origins']);
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
