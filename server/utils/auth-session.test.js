const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_IDLE_SECONDS,
  createAuthSessionToken,
  hashAuthSessionToken,
  readAuthSessionToken,
  serializeAuthSessionCookie,
  serializeClearedAuthSessionCookie,
} = require('./auth-session');

test('authenticated sessions use the exact 600-second idle timeout', () => {
  assert.equal(AUTH_SESSION_IDLE_SECONDS, 600);
});

test('session tokens are random, fixed-length, and stored as one-way hashes', () => {
  const first = createAuthSessionToken();
  const second = createAuthSessionToken();

  assert.match(first, /^[a-f\d]{64}$/);
  assert.notEqual(first, second);
  assert.notEqual(hashAuthSessionToken(first), first);
  assert.equal(hashAuthSessionToken(first), hashAuthSessionToken(first));
});

test('session cookie serialization applies HTTP-only, secure, same-site, and expiration attributes', () => {
  const token = createAuthSessionToken();
  const cookie = serializeAuthSessionCookie(token, {
    secure: true,
    sameSite: 'None',
    maxAgeSeconds: 3600,
  });

  assert.match(cookie, new RegExp(`^${AUTH_SESSION_COOKIE}=${token};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Max-Age=3600/);
  assert.match(cookie, /Expires=/);
  assert.equal(readAuthSessionToken(`${cookie}; other=value`), token);
});

test('malformed cookies are rejected and logout serialization expires the cookie', () => {
  assert.equal(readAuthSessionToken('fmc_session=not-a-session'), null);
  assert.equal(readAuthSessionToken('other=value'), null);
  assert.match(
    serializeClearedAuthSessionCookie({ secure: true, sameSite: 'Lax' }),
    /Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure$/,
  );
  assert.throws(
    () => serializeAuthSessionCookie(createAuthSessionToken(), { maxAgeSeconds: 0 }),
    /expiration/,
  );
});
