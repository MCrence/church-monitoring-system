function canonicalClientOrigin(value) {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '/' && parsed.pathname !== '')
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function getProductionSecurityErrors(env) {
  if (env.NODE_ENV !== 'production') return [];

  const errors = [];
  if (Buffer.byteLength(env.JWT_SECRET || '', 'utf8') < 32) {
    errors.push('JWT_SECRET must contain at least 32 bytes in production');
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.AES_KEY) {
    errors.push('JWT_SECRET and AES_KEY must be different secrets');
  }
  if (!canonicalClientOrigin(env.CLIENT_ORIGIN)) {
    errors.push('CLIENT_ORIGIN must be set to the HTTPS origin of the production client');
  }
  return errors;
}

module.exports = { canonicalClientOrigin, getProductionSecurityErrors };
