function getProductionSecurityErrors(env) {
  if (env.NODE_ENV !== 'production') return [];

  const errors = [];
  if (Buffer.byteLength(env.JWT_SECRET || '', 'utf8') < 32) {
    errors.push('JWT_SECRET must contain at least 32 bytes in production');
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.AES_KEY) {
    errors.push('JWT_SECRET and AES_KEY must be different secrets');
  }

  let clientOrigin;
  try {
    clientOrigin = new URL(env.CLIENT_ORIGIN);
  } catch {
    errors.push('CLIENT_ORIGIN must be set to the HTTPS origin of the production client');
  }
  if (clientOrigin && (clientOrigin.protocol !== 'https:' || clientOrigin.origin !== env.CLIENT_ORIGIN)) {
    errors.push('CLIENT_ORIGIN must be an exact HTTPS origin without a path or wildcard');
  }
  return errors;
}

module.exports = { getProductionSecurityErrors };
