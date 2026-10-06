const crypto = require('node:crypto');

function createPersistentRateLimiter({
  pool,
  tableReady,
  secret,
  bucket,
  maxRequests,
  windowSeconds,
  message,
}) {
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error('Rate-limit window must be a positive integer');
  }

  return async (req, res, next) => {
    try {
      await tableReady;
      const clientKey = crypto
        .createHmac('sha256', secret)
        .update(`${bucket}:${req.ip || req.socket.remoteAddress || 'unknown'}`)
        .digest('hex');
      await pool.execute(
        `INSERT INTO security_rate_limits
           (bucket, client_key, request_count, window_started_at)
         VALUES (?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE
           request_count = IF(
             window_started_at <= DATE_SUB(NOW(), INTERVAL ${windowSeconds} SECOND),
             1,
             request_count + 1
           ),
           window_started_at = IF(
             window_started_at <= DATE_SUB(NOW(), INTERVAL ${windowSeconds} SECOND),
             NOW(),
             window_started_at
           )`,
        [bucket, clientKey],
      );
      const [[record]] = await pool.execute(
        `SELECT request_count,
                GREATEST(1, TIMESTAMPDIFF(
                  SECOND, NOW(),
                  DATE_ADD(window_started_at, INTERVAL ${windowSeconds} SECOND)
                )) AS retry_after
         FROM security_rate_limits
         WHERE bucket = ? AND client_key = ?
         LIMIT 1`,
        [bucket, clientKey],
      );
      if (Number(record.request_count) > maxRequests) {
        res.set('Retry-After', String(record.retry_after));
        res.set('Cache-Control', 'no-store');
        return res.status(429).json({ error: message });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { createPersistentRateLimiter };
