const crypto = require('crypto');

const AUTH_SESSION_COOKIE = 'fmc_session';
const AUTH_SESSION_IDLE_SECONDS = 10 * 60;
const AUTH_SESSION_ABSOLUTE_SECONDS = 90 * 24 * 60 * 60;

function createAuthSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashAuthSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readAuthSessionToken(cookieHeader = '') {
  for (const pair of String(cookieHeader).split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== AUTH_SESSION_COOKIE) continue;
    const token = pair.slice(separator + 1).trim();
    return /^[a-f\d]{64}$/i.test(token) ? token : null;
  }
  return null;
}

function serializeAuthSessionCookie(token, {
  secure = false,
  sameSite = 'Lax',
  maxAgeSeconds = AUTH_SESSION_IDLE_SECONDS,
} = {}) {
  if (!/^[a-f\d]{64}$/i.test(String(token))) {
    throw new TypeError('Invalid authentication session token');
  }
  if (!['Strict', 'Lax', 'None'].includes(sameSite)) {
    throw new TypeError('Invalid authentication cookie SameSite value');
  }
  const requestedMaxAge = Number(maxAgeSeconds);
  if (!Number.isFinite(requestedMaxAge) || requestedMaxAge <= 0) {
    throw new TypeError('Invalid authentication cookie expiration');
  }
  const maxAge = Math.max(1, Math.floor(requestedMaxAge));
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  return [
    `${AUTH_SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAge}`,
    `Expires=${expires}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function serializeClearedAuthSessionCookie({ secure = false, sameSite = 'Lax' } = {}) {
  if (!['Strict', 'Lax', 'None'].includes(sameSite)) {
    throw new TypeError('Invalid authentication cookie SameSite value');
  }
  return [
    `${AUTH_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

module.exports = {
  AUTH_SESSION_ABSOLUTE_SECONDS,
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_IDLE_SECONDS,
  createAuthSessionToken,
  hashAuthSessionToken,
  readAuthSessionToken,
  serializeAuthSessionCookie,
  serializeClearedAuthSessionCookie,
};
