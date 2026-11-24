require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');
const mysql = require('mysql2/promise');
const { encrypt, decrypt, decryptBytes, encryptBytes } = require('./utils/encryption');
const { getAttendanceTransition } = require('./utils/attendance-transition');
const { createParticipantPasscode, isValidParticipantPasscode } = require('./utils/participant-passcode');
const { createPersistentRateLimiter } = require('./utils/persistent-rate-limit');
const { initializeSponsorshipTables } = require('./utils/sponsorship-tables');
const { sendEmailWithGmailApi } = require('./utils/gmail-api');
const {
  calculateAge,
  findPotentialParticipantDuplicates,
  normalizePhilippineDateOnly,
  normalizeParticipantName,
  participantRegistrationErrors,
} = require('./utils/participant-utils');
const { buildAttendanceAnalytics, educationGroup } = require('./utils/attendance-analytics');
const { summarizeAtRiskParticipants } = require('./utils/at-risk-summary');
const { buildAttendanceHistory } = require('./utils/attendance-history');
const {
  normalizeParticipantStatuses,
  removeRetiredSponsorshipData,
} = require('./utils/retired-sponsorship-data');
const {
  MAX_IMPORT_ROWS,
  inspectImportFile,
  safeImportFileName,
} = require('./utils/import-file');
const {
  normalizeEducationStatus,
  normalizeEventStatus,
  normalizeImportTime,
  normalizeSponsorshipStatus,
  parseSchoolYear,
  validateImportHeaders,
} = require('./utils/participant-import');
const { parsePositiveAmountCents } = require('./utils/amount-utils');
const { parsePage } = require('./utils/pagination');
const { csvRecord } = require('./utils/report-csv');
const {
  getParticipationStatus,
  GROUNDS_FOR_DEPARTURE_ABSENCES,
  isRemovalEligible,
  summarizeParticipation,
} = require('./utils/participation');
const {
  GOER_EDUCATION_LEVELS,
  canGoerAccessParticipant,
  canGoerManageCare,
  canGoerUsePermission,
  isGoerRole,
} = require('./utils/goer-access');
const { getProductionSecurityErrors } = require('./utils/security-config');
const {
  AUTH_SESSION_ABSOLUTE_SECONDS,
  AUTH_SESSION_IDLE_SECONDS,
  AUTH_SESSION_COOKIE,
  createAuthSessionToken,
  hashAuthSessionToken,
  readAuthSessionToken,
  serializeAuthSessionCookie,
  serializeClearedAuthSessionCookie,
} = require('./utils/auth-session');
const {
  EDUCATION_LEVELS,
  educationRecordKey,
  validateEducationRecord,
} = require('./utils/education-history');
const {
  DEFAULT_ATTENDANCE_RISK_SETTINGS,
  buildAttendanceRiskAssessment,
  normalizeAttendanceRiskSettings,
} = require('./utils/attendance-risk');

const required = ['JWT_SECRET', 'AES_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const productionSecurityErrors = getProductionSecurityErrors(process.env);
if (productionSecurityErrors.length) {
  throw new Error(`Invalid production security configuration: ${productionSecurityErrors.join('; ')}`);
}
const isProduction = process.env.NODE_ENV === 'production';
const authCookieSameSite = String(process.env.AUTH_COOKIE_SAME_SITE || 'Lax');
if (!['Strict', 'Lax', 'None'].includes(authCookieSameSite)) {
  throw new Error('AUTH_COOKIE_SAME_SITE must be Strict, Lax, or None');
}
const authCookieSecure = isProduction || authCookieSameSite === 'None';
const clientOrigin = process.env.CLIENT_ORIGIN || 'https://localhost:5173';
const trustProxyHops = process.env.TRUST_PROXY_HOPS === undefined
  ? 0
  : Number(process.env.TRUST_PROXY_HOPS);
if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
}

const app = express();
app.set('trust proxy', trustProxyHops);
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ...(isProduction || process.env.DB_SSL === 'true' || process.env.DB_SSL_CA
    ? {
        ssl: {
          rejectUnauthorized: true,
          minVersion: isProduction ? 'TLSv1.3' : 'TLSv1.2',
          ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}),
        },
      }
    : {}),
  waitForConnections: true,
  connectionLimit: 10,
});
const authSessionsReady = (async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expires_at DATETIME(3) NOT NULL,
      absolute_expires_at DATETIME(3) NOT NULL,
      PRIMARY KEY (token_hash),
      INDEX idx_auth_sessions_user_id (user_id),
      INDEX idx_auth_sessions_expiration (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME, DATETIME_PRECISION
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_sessions'
       AND COLUMN_NAME IN ('created_at', 'last_activity_at', 'expires_at', 'absolute_expires_at')`,
  );
  if (columns.some((column) => Number(column.DATETIME_PRECISION) < 3)) {
    await pool.query(`
      ALTER TABLE auth_sessions
        MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        MODIFY last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        MODIFY expires_at DATETIME(3) NOT NULL,
        MODIFY absolute_expires_at DATETIME(3) NOT NULL
    `);
  }
})();
const eventsTableReady = (async () => {
  await pool.query(`
  CREATE TABLE IF NOT EXISTS events (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) DEFAULT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME DEFAULT NULL,
    location VARCHAR(100) DEFAULT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
    is_sample BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INT UNSIGNED DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_events_starts_at (starts_at),
    UNIQUE KEY uq_events_name_starts_at (name, starts_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events'
       AND COLUMN_NAME = 'is_sample'`,
  );
  if (!columns.length) {
    try {
      await pool.query('ALTER TABLE events ADD COLUMN is_sample BOOLEAN NOT NULL DEFAULT FALSE');
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  await pool.query(
    `UPDATE events SET is_sample = TRUE
     WHERE description LIKE 'Synthetic %' AND is_sample = FALSE`,
  );
})();
const attendanceImportColumnsReady = eventsTableReady.then(async () => {
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'check_in_logs'`,
  );
  const existing = new Set(columns.map((column) => column.COLUMN_NAME));
  const additions = [
    ['event_id', 'INT UNSIGNED DEFAULT NULL'],
    ['attendance_status', 'VARCHAR(16) DEFAULT NULL'],
    ['recorded_by_encrypted', 'TEXT DEFAULT NULL'],
    ['remarks_encrypted', 'TEXT DEFAULT NULL'],
  ];
  for (const [column, definition] of additions) {
    if (!existing.has(column)) {
      try {
        await pool.query(`ALTER TABLE check_in_logs ADD COLUMN ${column} ${definition}`);
      } catch (error) {
        if (error.code !== 'ER_DUP_FIELDNAME') throw error;
      }
    }
  }
});
const educationHistoryReady = eventsTableReady.then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS participant_education_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    participant_id INT UNSIGNED NOT NULL,
    education_level VARCHAR(50) NOT NULL,
    school_name_encrypted TEXT NOT NULL,
    school_address_encrypted TEXT DEFAULT NULL,
    start_year SMALLINT UNSIGNED NOT NULL,
    end_year SMALLINT UNSIGNED DEFAULT NULL,
    status VARCHAR(30) NOT NULL,
    course_strand_encrypted TEXT DEFAULT NULL,
    notes_encrypted TEXT DEFAULT NULL,
    record_fingerprint CHAR(64) NOT NULL,
    created_by INT UNSIGNED DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_participant_education_fingerprint (participant_id, record_fingerprint),
    INDEX idx_participant_education_progression (participant_id, start_year, id),
    CONSTRAINT fk_participant_education_history_participant
      FOREIGN KEY (participant_id) REFERENCES participants (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`));
const participantImportHistoryReady = pool.query(`
  CREATE TABLE IF NOT EXISTS participant_import_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    file_name VARCHAR(255) NOT NULL,
    import_type VARCHAR(40) NOT NULL,
    imported_by INT UNSIGNED DEFAULT NULL,
    imported_by_name VARCHAR(150) NOT NULL,
    participants_imported INT UNSIGNED NOT NULL DEFAULT 0,
    participants_updated INT UNSIGNED NOT NULL DEFAULT 0,
    attendance_imported INT UNSIGNED NOT NULL DEFAULT 0,
    attendance_summaries_imported INT UNSIGNED NOT NULL DEFAULT 0,
    education_imported INT UNSIGNED NOT NULL DEFAULT 0,
    events_imported INT UNSIGNED NOT NULL DEFAULT 0,
    skipped INT UNSIGNED NOT NULL DEFAULT 0,
    failed INT UNSIGNED NOT NULL DEFAULT 0,
    details_json JSON DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_participant_import_history_created (created_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).then(async () => {
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'participant_import_history'`,
  );
  if (!columns.some((column) => column.COLUMN_NAME === 'attendance_summaries_imported')) {
    try {
      await pool.query(
        'ALTER TABLE participant_import_history ADD COLUMN attendance_summaries_imported INT UNSIGNED NOT NULL DEFAULT 0 AFTER attendance_imported',
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  if (!columns.some((column) => column.COLUMN_NAME === 'events_imported')) {
    try {
      await pool.query(
        'ALTER TABLE participant_import_history ADD COLUMN events_imported INT UNSIGNED NOT NULL DEFAULT 0 AFTER education_imported',
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  if (!columns.some((column) => column.COLUMN_NAME === 'details_json')) {
    try {
      await pool.query(
        'ALTER TABLE participant_import_history ADD COLUMN details_json JSON DEFAULT NULL AFTER failed',
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
});
const historicalAttendanceSummaryReady = pool.query(`
  CREATE TABLE IF NOT EXISTS participant_attendance_summaries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    participant_id INT UNSIGNED NOT NULL,
    attendance_year SMALLINT UNSIGNED NOT NULL,
    required_count SMALLINT UNSIGNED NOT NULL,
    attended_count SMALLINT UNSIGNED NOT NULL,
    absent_count SMALLINT UNSIGNED NOT NULL,
    created_by INT UNSIGNED DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_participant_attendance_summary_year (participant_id, attendance_year),
    CONSTRAINT fk_participant_attendance_summary_participant
      FOREIGN KEY (participant_id) REFERENCES participants (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
const eventPhotosTableReady = eventsTableReady.then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS event_photos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id INT UNSIGNED NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(30) NOT NULL,
    photo_data LONGBLOB NOT NULL,
    created_by INT UNSIGNED DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_event_photos_event (event_id, id),
    CONSTRAINT fk_event_photos_event
      FOREIGN KEY (event_id) REFERENCES events (id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`));
const participantProfileColumnsReady = (async () => {
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'participants'
       AND COLUMN_NAME IN (
         'education_level', 'grade_level', 'program_course_encrypted',
         'first_name_encrypted', 'middle_name_encrypted', 'last_name_encrypted',
         'passcode_encrypted',
         'school_name_encrypted', 'school_address_encrypted',
         'guardian_name_encrypted', 'parent_contact_encrypted',
         'sponsorship_registered_at'
       )`,
  );
  const existing = new Set(columns.map((column) => column.COLUMN_NAME));
  const additions = [
    ['education_level', 'VARCHAR(50) DEFAULT NULL'],
    ['grade_level', 'VARCHAR(50) DEFAULT NULL'],
    ['program_course_encrypted', 'TEXT DEFAULT NULL'],
    ['first_name_encrypted', 'TEXT DEFAULT NULL'],
    ['middle_name_encrypted', 'TEXT DEFAULT NULL'],
    ['last_name_encrypted', 'TEXT DEFAULT NULL'],
    ['passcode_encrypted', 'TEXT DEFAULT NULL'],
    ['school_name_encrypted', 'TEXT DEFAULT NULL'],
    ['school_address_encrypted', 'TEXT DEFAULT NULL'],
    ['guardian_name_encrypted', 'TEXT DEFAULT NULL'],
    ['parent_contact_encrypted', 'TEXT DEFAULT NULL'],
    ['sponsorship_registered_at', 'DATE DEFAULT NULL'],
  ];
  for (const [column, definition] of additions) {
    if (!existing.has(column)) {
      try {
        await pool.query(`ALTER TABLE participants ADD COLUMN ${column} ${definition}`);
      } catch (error) {
        if (error.code !== 'ER_DUP_FIELDNAME') throw error;
      }
    }
  }
})();
const goerQrRevocationReady = participantProfileColumnsReady.then(() => pool.query(`
  UPDATE qr_codes q
  JOIN participants p ON p.id = q.participant_id
  SET q.status = 'revoked', q.revoked_at = COALESCE(q.revoked_at, NOW())
  WHERE p.participant_type = 'goer' AND q.status = 'active'
`));
const sponsorshipTablesReady = initializeSponsorshipTables(pool);
const sponsoredChildUpdatesReady = eventsTableReady.then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS sponsored_child_updates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    participant_id INT UNSIGNED NOT NULL,
    update_type VARCHAR(20) NOT NULL,
    recorded_on DATE NOT NULL,
    activity_encrypted TEXT DEFAULT NULL,
    height_encrypted TEXT DEFAULT NULL,
    weight_encrypted TEXT DEFAULT NULL,
    note_encrypted TEXT DEFAULT NULL,
    created_by INT UNSIGNED DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_sponsored_child_updates_child_date (participant_id, recorded_on, id),
    CONSTRAINT fk_sponsored_child_updates_participant
      FOREIGN KEY (participant_id) REFERENCES participants (id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`));
const participationTrackingReady = participantProfileColumnsReady.then(async () => {
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'participants'
       AND COLUMN_NAME = 'participation_status'`,
  );
  if (!columns.length) {
    await pool.query(
      "ALTER TABLE participants ADD COLUMN participation_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'",
    );
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsored_child_participation_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      participant_id INT UNSIGNED NOT NULL,
      action_type VARCHAR(32) NOT NULL,
      evaluation_year SMALLINT UNSIGNED DEFAULT NULL,
      previous_status VARCHAR(32) NOT NULL,
      current_status VARCHAR(32) NOT NULL,
      reason TEXT DEFAULT NULL,
      absence_count INT UNSIGNED NOT NULL DEFAULT 0,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_child_participation_history (participant_id, created_at, id),
      UNIQUE KEY uq_child_participation_action_year (participant_id, action_type, evaluation_year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [indexes] = await pool.execute(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sponsored_child_participation_history'
       AND INDEX_NAME = 'uq_child_participation_action_year'`,
  );
  const [evaluationYearColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sponsored_child_participation_history'
       AND COLUMN_NAME = 'evaluation_year'`,
  );
  if (!evaluationYearColumns.length) {
    try {
      await pool.query(
        'ALTER TABLE sponsored_child_participation_history ADD COLUMN evaluation_year SMALLINT UNSIGNED DEFAULT NULL AFTER action_type',
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  await pool.query(
    `UPDATE sponsored_child_participation_history
     SET evaluation_year = YEAR(created_at)
     WHERE evaluation_year IS NULL`,
  );
  const [legacyActionIndexes] = await pool.execute(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sponsored_child_participation_history'
       AND INDEX_NAME = 'uq_child_participation_action'`,
  );
  if (legacyActionIndexes.length) {
    await pool.query(
      'ALTER TABLE sponsored_child_participation_history DROP INDEX uq_child_participation_action',
    );
  }
  if (!indexes.length) {
    await pool.query(`ALTER TABLE sponsored_child_participation_history
      ADD UNIQUE KEY uq_child_participation_action_year
      (participant_id, action_type, evaluation_year)`);
  }
  const [historyColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sponsored_child_participation_history'
       AND COLUMN_NAME = 'notes'`,
  );
  if (!historyColumns.length) {
    try {
      await pool.query(
        'ALTER TABLE sponsored_child_participation_history ADD COLUMN notes TEXT DEFAULT NULL',
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
});
const attendanceRiskSettingsReady = pool.query(`
  CREATE TABLE IF NOT EXISTS attendance_risk_settings (
    setting_id TINYINT UNSIGNED NOT NULL,
    frequency_weight DECIMAL(5,2) NOT NULL DEFAULT 40,
    regularity_weight DECIMAL(5,2) NOT NULL DEFAULT 35,
    recency_weight DECIMAL(5,2) NOT NULL DEFAULT 25,
    medium_threshold TINYINT UNSIGNED NOT NULL DEFAULT 30,
    high_threshold TINYINT UNSIGNED NOT NULL DEFAULT 60,
    updated_by INT UNSIGNED DEFAULT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).then(() => pool.execute(
  `INSERT IGNORE INTO attendance_risk_settings
   (setting_id, frequency_weight, regularity_weight, recency_weight, medium_threshold, high_threshold)
   VALUES (1, ?, ?, ?, ?, ?)`,
  [
    DEFAULT_ATTENDANCE_RISK_SETTINGS.frequencyWeight,
    DEFAULT_ATTENDANCE_RISK_SETTINGS.regularityWeight,
    DEFAULT_ATTENDANCE_RISK_SETTINGS.recencyWeight,
    DEFAULT_ATTENDANCE_RISK_SETTINGS.mediumThreshold,
    DEFAULT_ATTENDANCE_RISK_SETTINGS.highThreshold,
  ],
));
const staffPermissionsReady = (async () => {
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME IN (
         'access_permissions', 'goer_education_level',
         'first_name', 'middle_name', 'last_name'
       )`,
  );
  const existing = new Set(columns.map((column) => column.COLUMN_NAME));
  const additions = [
    ['access_permissions', 'TEXT DEFAULT NULL'],
    ['goer_education_level', 'VARCHAR(50) DEFAULT NULL'],
    ['first_name', 'VARCHAR(100) DEFAULT NULL'],
    ['middle_name', 'VARCHAR(100) DEFAULT NULL'],
    ['last_name', 'VARCHAR(100) DEFAULT NULL'],
  ];
  for (const [column, definition] of additions) {
    if (!existing.has(column)) {
      try {
        await pool.query(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
      } catch (error) {
        if (error.code !== 'ER_DUP_FIELDNAME') throw error;
      }
    }
  }
})();
const legacyRolesReady = pool.query(`
  UPDATE users
  SET status = CASE
    WHEN LOWER(role) IN ('program coordinator', 'check-in volunteer') THEN 'inactive'
    ELSE status
  END,
  role = CASE
    WHEN LOWER(role) = 'admin' THEN 'System Administrator'
    ELSE 'Church Administrator'
  END
  WHERE LOWER(role) IN ('admin', 'program coordinator', 'check-in volunteer')
`);
const auditTableReady = pool.query(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED DEFAULT NULL,
    username VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) DEFAULT NULL,
    details JSON DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_audit_logs_created_at (created_at),
    INDEX idx_audit_logs_user_id (user_id),
    INDEX idx_audit_logs_entity (entity_type, entity_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
const sponsorLookupAttemptsReady = pool.query(`
  CREATE TABLE IF NOT EXISTS public_sponsor_lookup_attempts (
    qr_key CHAR(64) NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    window_started_at DATETIME NOT NULL,
    locked_until DATETIME DEFAULT NULL,
    PRIMARY KEY (qr_key),
    INDEX idx_public_sponsor_attempts_locked_until (locked_until)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
const securityRateLimitsReady = pool.query(`
  CREATE TABLE IF NOT EXISTS security_rate_limits (
    bucket VARCHAR(48) NOT NULL,
    client_key CHAR(64) NOT NULL,
    request_count INT UNSIGNED NOT NULL DEFAULT 0,
    window_started_at DATETIME NOT NULL,
    PRIMARY KEY (bucket, client_key),
    INDEX idx_security_rate_limits_window (window_started_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
const retiredSponsorDataReady = Promise.all([participationTrackingReady, auditTableReady])
  .then(async () => {
    await normalizeParticipantStatuses(pool);
    await removeRetiredSponsorshipData(pool);
  });
app.use((req, res, next) => {
  retiredSponsorDataReady.then(() => next()).catch(next);
});
const emailChallenges = new Map();
const uploadsDir = path.join(__dirname, 'uploads', 'qr_codes');
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(helmet(isProduction
  ? { hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false } }
  : {}));
app.use(cors({ origin: clientOrigin, credentials: true }));
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && origin !== clientOrigin) {
    return res.status(403).json({ error: 'Request origin is not allowed' });
  }
  next();
});
app.use((req, res, next) => {
  const hasReceiptUpload = req.method === 'POST' &&
    /^\/api\/sponsorship\/children\/\d+\/disbursements$/.test(req.path);
  const hasEventPhotoUpload = req.method === 'POST' &&
    (/^\/api\/events$/.test(req.path) || /^\/api\/events\/\d+\/photos$/.test(req.path));
  const hasParticipantImport = req.method === 'POST' && /^\/api\/participants\/import\//.test(req.path);
  const limit = hasParticipantImport ? '16mb'
    : hasEventPhotoUpload ? '22mb'
      : hasReceiptUpload ? '6mb' : '1mb';
  express.json({ limit })(req, res, next);
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(async (req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    pool.execute(
      'INSERT INTO system_logs (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [req.user?.id || null, `${req.method} ${req.path}`, 'request', null, JSON.stringify({ status: res.statusCode, durationMs: Date.now() - started })],
    ).catch(() => {});
  });
  next();
});

async function createAuthSession(userId, res, existingCookie = '') {
  await authSessionsReady;
  await pool.execute(
    'DELETE FROM auth_sessions WHERE expires_at <= NOW() OR absolute_expires_at <= NOW()',
  );
  const previousToken = readAuthSessionToken(existingCookie);
  if (previousToken) {
    await pool.execute('DELETE FROM auth_sessions WHERE token_hash = ?', [
      hashAuthSessionToken(previousToken),
    ]);
  }
  const token = createAuthSessionToken();
  const lastActivityAt = await insertAuthSession(pool, userId, token);
  res.setHeader('Set-Cookie', serializeAuthSessionCookie(token, {
    secure: authCookieSecure,
    sameSite: authCookieSameSite,
    maxAgeSeconds: AUTH_SESSION_IDLE_SECONDS,
  }));
  return lastActivityAt;
}

async function insertAuthSession(executor, userId, token) {
  await executor.execute(
    `INSERT INTO auth_sessions
       (token_hash, user_id, created_at, last_activity_at, expires_at, absolute_expires_at)
     VALUES (?, ?, NOW(3), NOW(3),
             DATE_ADD(NOW(3), INTERVAL ${AUTH_SESSION_IDLE_SECONDS} SECOND),
             DATE_ADD(NOW(3), INTERVAL ${AUTH_SESSION_ABSOLUTE_SECONDS} SECOND))`,
    [hashAuthSessionToken(token), userId],
  );
  const [[session]] = await executor.execute(
    `SELECT CAST(UNIX_TIMESTAMP(last_activity_at) * 1000 AS UNSIGNED) AS last_activity_at
     FROM auth_sessions WHERE token_hash = ? LIMIT 1`,
    [hashAuthSessionToken(token)],
  );
  return Number(session.last_activity_at);
}

function clearAuthSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeClearedAuthSessionCookie({
    secure: authCookieSecure,
    sameSite: authCookieSameSite,
  }));
}

async function authenticate(req, res, next) {
  try {
    await authSessionsReady;
    await legacyRolesReady;
    await staffPermissionsReady;
    const token = readAuthSessionToken(req.headers.cookie);
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const tokenHash = hashAuthSessionToken(token);
    const [users] = await pool.execute(
      `SELECT s.last_activity_at,
              CAST(UNIX_TIMESTAMP(s.last_activity_at) * 1000 AS UNSIGNED) AS last_activity_ms,
              CEIL(TIMESTAMPDIFF(MICROSECOND, NOW(3), s.expires_at) / 1000000) AS idle_seconds,
              CEIL(TIMESTAMPDIFF(MICROSECOND, NOW(3), s.absolute_expires_at) / 1000000) AS absolute_seconds,
              (s.last_activity_at <= DATE_SUB(NOW(3), INTERVAL ${AUTH_SESSION_IDLE_SECONDS} SECOND)) AS inactivity_expired,
              (s.expires_at <= NOW(3)) AS idle_expired,
              (s.absolute_expires_at <= NOW(3)) AS absolute_expired,
              u.id, u.username, u.email, u.role, u.status, u.access_permissions,
              u.goer_education_level, u.first_name, u.middle_name, u.last_name
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
       LIMIT 1`,
      [tokenHash],
    );
    const user = users[0];
    const inactivityExpired = user && (
      Boolean(user.inactivity_expired) ||
      Boolean(user.idle_expired)
    );
    if (!user || user.status !== 'active' || inactivityExpired || Boolean(user.absolute_expired)) {
      await pool.execute('DELETE FROM auth_sessions WHERE token_hash = ?', [tokenHash]);
      clearAuthSessionCookie(res);
      if (inactivityExpired) {
        return res.status(401).json({
          error: 'Session expired due to inactivity',
          code: 'SESSION_INACTIVE',
        });
      }
      return res.status(401).json({ error: 'Session is invalid or expired', code: 'SESSION_INVALID' });
    }
    const maxAgeSeconds = Math.min(
      AUTH_SESSION_IDLE_SECONDS,
      Math.max(1, Number(user.idle_seconds) || 1),
      Math.max(1, Number(user.absolute_seconds) || 1),
    );
    res.setHeader('Set-Cookie', serializeAuthSessionCookie(token, {
      secure: authCookieSecure,
      sameSite: authCookieSameSite,
      maxAgeSeconds,
    }));
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      goerEducationLevel: user.goer_education_level,
      firstName: user.first_name,
      middleName: user.middle_name,
      lastName: user.last_name,
      permissions: permissionsForUser(user),
    };
    req.user.username = [
      user.first_name,
      user.middle_name,
      user.last_name,
    ].filter(Boolean).join(' ') || user.username || user.email;
    req.authenticatedUser = accountView(user);
    req.authSessionHash = tokenHash;
    req.authSessionLastActivityAt = Number(user.last_activity_ms);
    next();
  } catch (error) {
    next(error);
  }
}

function checkRole(allowedRoles) {
  const allowed = allowedRoles.map((role) => role.toLowerCase());
  return (req, res, next) => {
    if (!req.user || !allowed.includes(String(req.user.role).toLowerCase())) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

const staffRoles = ['System Administrator', 'Church Administrator'];
const accountRoles = [...staffRoles, 'Goer'];
const STAFF_PERMISSION_KEYS = [
  'dashboard:view',
  'participants:view',
  'participants:edit',
  'participants:delete',
  'events:view',
  'events:manage',
  'checkin:record',
  'analytics:view',
  'reports:view',
  'portal:view',
  'sponsorship:view',
  'sponsorship:manage',
];
const LEGACY_STAFF_PERMISSIONS = STAFF_PERMISSION_KEYS.filter(
  (permission) => !permission.startsWith('sponsorship:') &&
    !['participants:edit', 'participants:delete'].includes(permission),
);

function permissionsForUser(user) {
  if (String(user.role).toLowerCase() === 'system administrator') {
    return STAFF_PERMISSION_KEYS;
  }
  if (isGoerRole(user.role)) {
    return ['dashboard:view', 'checkin:record', 'participants:view', 'goer-care:view', 'goer-care:record'];
  }
  if (user.access_permissions === null || user.access_permissions === undefined) {
    return LEGACY_STAFF_PERMISSIONS;
  }
  try {
    const decoded = typeof user.access_permissions === 'string'
      ? JSON.parse(user.access_permissions)
      : user.access_permissions;
    if (!Array.isArray(decoded)) return [];
    const permissions = decoded.filter((permission) => STAFF_PERMISSION_KEYS.includes(permission));
    if (decoded.includes('participants:manage')) {
      permissions.push('participants:view', 'participants:edit', 'participants:delete');
    }
    return [...new Set(permissions)];
  } catch (error) {
    console.error('Invalid saved staff permissions for account', user.id, error);
    return [];
  }
}

function hasPermission(user, permission) {
  if (String(user.role).toLowerCase() === 'system administrator') return true;
  if (!canGoerUsePermission(user.role, permission)) return false;
  if (isGoerRole(user.role)) return Boolean(user.permissions?.includes(permission));
  const permissions = user.permissions || permissionsForUser(user);
  if (permissions.includes(permission)) return true;
  return (
    (permission === 'events:view' && permissions.includes('events:manage')) ||
    (permission === 'sponsorship:view' && permissions.includes('sponsorship:manage'))
  );
}

function checkPermission(permission) {
  return (req, res, next) => {
    if (!req.user || !hasPermission(req.user, permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function checkImportPermission(req, res, next) {
  const importType = req.body?.importType;
  if (importType === 'participants') {
    return checkRole(['System Administrator', 'Church Administrator'])(req, res, next);
  }
  if (importType === 'events') return checkPermission('events:manage')(req, res, next);
  if (['education', 'attendance', 'attendanceSummary'].includes(importType)) {
    return checkPermission('sponsorship:manage')(req, res, next);
  }
  return res.status(400).json({ error: 'Choose a supported import type' });
}

function hasReportCategoryPermission(user, permission) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'church administrator' || role === 'system administrator'
    || hasPermission(user, permission);
}

function checkReportCategoryPermission(permission) {
  return (req, res, next) => {
    if (!req.user || !hasReportCategoryPermission(req.user, permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function canViewParticipant(user, participant) {
  return !isGoerRole(user?.role) || canGoerAccessParticipant(user, participant);
}

function canViewParticipantCare(user) {
  return isGoerRole(user?.role)
    ? Boolean(user.permissions?.includes('goer-care:view'))
    : hasPermission(user, 'sponsorship:view');
}

async function hasParticipantScope(user, participantId) {
  if (!isGoerRole(user?.role)) return true;
  const [[participant]] = await pool.execute(
    `SELECT participant_type, education_level, status
     FROM participants WHERE id = ? LIMIT 1`,
    [participantId],
  );
  return canViewParticipant(user, participant);
}

function checkSponsorshipView(req, res, next) {
  const allowed = isGoerRole(req.user?.role)
    ? GOER_EDUCATION_LEVELS.includes(req.user.goerEducationLevel)
      && req.user.permissions?.includes('goer-care:view')
    : hasPermission(req.user, 'sponsorship:view');
  if (!allowed) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
}

function checkSponsorshipChildrenView(req, res, next) {
  if (
    String(req.user?.role || '').toLowerCase() === 'church administrator'
    && hasPermission(req.user, 'reports:view')
  ) {
    return next();
  }
  return checkSponsorshipView(req, res, next);
}

function checkSponsorshipRecord(req, res, next) {
  const allowed = isGoerRole(req.user?.role)
    ? canGoerManageCare(req.user)
    : hasPermission(req.user, 'sponsorship:manage');
  if (!allowed) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
}

const educationLevels = new Set([
  ...GOER_EDUCATION_LEVELS,
]);
const genderOptions = new Set(['Male', 'Female']);
const gradeLevelsByEducation = {
  Elementary: new Set(['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']),
  'Junior High School': new Set(['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10']),
  'Senior High School': new Set(['Grade 11', 'Grade 12']),
  College: new Set(['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6']),
};

function sponsoredChildEligibilityError(body) {
  if (body.participantType !== 'sponsored_child') return null;
  const dateOfBirth = String(body.dateOfBirth || '').slice(0, 10);
  if (dateOfBirth) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return 'Enter a valid date of birth';
    const birthDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(birthDate.getTime()) || birthDate.toISOString().slice(0, 10) !== dateOfBirth) {
      return 'Enter a valid date of birth';
    }
    const today = new Date();
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    if (
      today.getUTCMonth() < birthDate.getUTCMonth() ||
      (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() < birthDate.getUTCDate())
    ) {
      age -= 1;
    }
    if (age < 6 || age > 22) return 'Sponsored children must be between 6 and 22 years old';
  }
  if (body.educationLevel && !educationLevels.has(body.educationLevel)) {
    return 'Select an education level for the sponsored child';
  }
  if (body.gradeLevel && !gradeLevelsByEducation[body.educationLevel]?.has(body.gradeLevel)) {
    return 'Select a valid grade or year level for the education level';
  }
  return null;
}

function participantNameError(body) {
  const fields = ['firstName', 'middleName', 'lastName'];
  for (const field of fields) {
    if (String(body[field] || '').trim().length > 100) {
      return `${field} must be 100 characters or fewer`;
    }
  }
  if (!String(body.firstName || '').trim() || !String(body.lastName || '').trim()) {
    return 'First name and last name are required';
  }
  return null;
}

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] || '', middleName: '', lastName: '' };
  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts[parts.length - 1],
  };
}

function staffNameFields(body) {
  const firstName = String(body.firstName || '').trim();
  const middleName = String(body.middleName || '').trim();
  const lastName = String(body.lastName || '').trim();
  if (!firstName || !lastName) return { error: 'First name and last name are required' };
  if ([firstName, middleName, lastName].some((part) => part.length > 100)) {
    return { error: 'Each name must be 100 characters or fewer' };
  }
  return { firstName, middleName, lastName, fullName: [firstName, middleName, lastName].filter(Boolean).join(' ') };
}

function accountView(user) {
  const hasStoredName = Boolean(user.first_name || user.middle_name || user.last_name);
  const legacyName = !hasStoredName && user.username ? splitFullName(user.username) : {};
  const firstName = user.first_name || legacyName.firstName || '';
  const middleName = user.middle_name || legacyName.middleName || '';
  const lastName = user.last_name || legacyName.lastName || '';
  return {
    id: user.id,
    firstName,
    middleName,
    lastName,
    fullName: [firstName, middleName, lastName].filter(Boolean).join(' ') || user.username || '',
    email: user.email,
    role: user.role,
    permissions: permissionsForUser(user),
    goerEducationLevel: user.goer_education_level || null,
  };
}

async function writeAuditLog(user, action, entityType, entityId = null, details = null, executor = pool) {
  await auditTableReady;
  await executor.execute(
    'INSERT INTO audit_logs (user_id, username, role, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      user.id,
      user.username,
      user.role,
      action,
      entityType,
      entityId === null ? null : String(entityId),
      details === null ? null : JSON.stringify(details),
    ],
  );
}

function participantView(row) {
  const result = { ...row };
  delete result.passcode_hash;
  delete result.passcode_encrypted;
  delete result.sponsorship_start_date;
  const safeDecrypt = (value) => {
    if (!value) return null;
    try {
      return decrypt(value);
    } catch {
      return null;
    }
  };
  for (const [field, encryptedField] of Object.entries({ fullName: 'full_name_encrypted', firstName: 'first_name_encrypted', middleName: 'middle_name_encrypted', lastName: 'last_name_encrypted', dateOfBirth: 'date_of_birth_encrypted', phone: 'phone_encrypted', address: 'address_encrypted', schoolName: 'school_name_encrypted', schoolAddress: 'school_address_encrypted', guardianName: 'guardian_name_encrypted', parentContact: 'parent_contact_encrypted', medicalNotes: 'medical_notes_encrypted', weight: 'weight_encrypted', height: 'height_encrypted', medicalConditions: 'medical_conditions_encrypted', emergencyContactName: 'emergency_contact_name_encrypted', emergencyContactPhone: 'emergency_contact_phone_encrypted', programCourse: 'program_course_encrypted' })) {
    result[field] = safeDecrypt(result[encryptedField]);
    delete result[encryptedField];
  }
  if (!result.firstName || !result.lastName) {
    const legacyName = splitFullName(result.fullName);
    result.firstName ||= legacyName.firstName;
    result.middleName ||= legacyName.middleName;
    result.lastName ||= legacyName.lastName;
  }
  result.guardianName ||= result.emergencyContactName;
  result.parentContact ||= result.emergencyContactPhone;
  result.fullName = [result.firstName, result.middleName, result.lastName].filter(Boolean).join(' ')
    || result.fullName;
  result.age = calculateAge(result.dateOfBirth);
  result.participantType = result.participant_type;
  result.educationLevel = result.education_level;
  result.gradeLevel = result.grade_level;
  if (result.sponsorship_registered_at != null) {
    result.sponsorship_registered_at = normalizePhilippineDateOnly(result.sponsorship_registered_at)
      || result.sponsorship_registered_at;
  }
  result.enrollmentDate = result.enrollment_date instanceof Date
    ? new Date(result.enrollment_date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : result.enrollment_date;
  return result;
}

function educationFingerprint(record) {
  return crypto.createHmac('sha256', process.env.AES_KEY)
    .update(educationRecordKey(record))
    .digest('hex');
}

async function preservePreviousCurrentSchool(connection, participantRow, nextSchoolName, actorId) {
  const previousSchool = decrypt(participantRow.school_name_encrypted);
  const nextSchool = String(nextSchoolName || '').trim();
  if (
    participantRow.participant_type !== 'sponsored_child' ||
    !previousSchool ||
    !nextSchool ||
    previousSchool.trim().toLocaleLowerCase() === nextSchool.toLocaleLowerCase()
  ) return false;
  const educationLevel = participantRow.education_level;
  if (!EDUCATION_LEVELS.has(educationLevel)) return false;
  const currentYear = new Date().getFullYear();
  const enrollmentDate = participantRow.enrollment_date instanceof Date
    ? new Date(participantRow.enrollment_date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : String(participantRow.enrollment_date || participantRow.created_at || '').slice(0, 10);
  const parsedStartYear = Number(enrollmentDate.slice(0, 4));
  const record = {
    educationLevel,
    schoolName: previousSchool,
    schoolAddress: decrypt(participantRow.school_address_encrypted) || '',
    startYear: Number.isInteger(parsedStartYear) && parsedStartYear >= 1900 && parsedStartYear <= currentYear
      ? parsedStartYear
      : currentYear,
    endYear: currentYear,
    status: 'Transferred',
    courseStrand: decrypt(participantRow.program_course_encrypted) || '',
    notes: '',
  };
  await connection.execute(
    `INSERT IGNORE INTO participant_education_history
       (participant_id, education_level, school_name_encrypted, school_address_encrypted,
        start_year, end_year, status, course_strand_encrypted, notes_encrypted,
        record_fingerprint, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      participantRow.id, record.educationLevel, encrypt(record.schoolName),
      encrypt(record.schoolAddress || null), record.startYear, record.endYear,
      record.status, encrypt(record.courseStrand || null), null,
      educationFingerprint(record), actorId,
    ],
  );
  return true;
}

function educationHistoryView(row) {
  return {
    id: row.id,
    educationLevel: row.education_level,
    schoolName: decrypt(row.school_name_encrypted) || '',
    schoolAddress: decrypt(row.school_address_encrypted) || '',
    startYear: Number(row.start_year),
    endYear: row.end_year === null ? null : Number(row.end_year),
    status: row.status,
    courseStrand: decrypt(row.course_strand_encrypted) || '',
    notes: decrypt(row.notes_encrypted) || '',
  };
}

app.get('/api/health', async (req, res) => {
  const connection = await pool.getConnection();
  let databaseTlsProtocol = null;
  try {
    await connection.query('SELECT 1');
    const stream = connection.connection?.stream;
    if (stream?.encrypted && typeof stream.getProtocol === 'function') {
      databaseTlsProtocol = stream.getProtocol();
    }
  } finally {
    connection.release();
  }
  res.json({
    status: 'ok',
    database: 'connected',
    databaseTlsProtocol,
  });
});

const loginRateLimit = createPersistentRateLimiter({
  pool,
  tableReady: securityRateLimitsReady,
  secret: process.env.JWT_SECRET,
  bucket: 'staff-login',
  maxRequests: 10,
  windowSeconds: 15 * 60,
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
});
const guardianRateLimit = createPersistentRateLimiter({
  pool,
  tableReady: securityRateLimitsReady,
  secret: process.env.JWT_SECRET,
  bucket: 'guardian-verification',
  maxRequests: 12,
  windowSeconds: 15 * 60,
  message: 'Too many verification attempts. Try again in 15 minutes.',
});

app.get('/api/audit-logs', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    await auditTableReady;
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const offset = Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
    const [entries] = await pool.execute(
      'SELECT id, user_id, username, role, action, entity_type, entity_id, details, created_at FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      [limit, offset],
    );
    res.json({ entries, limit, offset });
  } catch (error) { next(error); }
});

app.get('/api/dashboard', authenticate, checkPermission('dashboard:view'), async (req, res, next) => {
  try {
    const role = String(req.user.role || '').toLowerCase();
    const isAdmin = role === 'system administrator';
    const isGoer = isGoerRole(role);
    if (isGoer && !GOER_EDUCATION_LEVELS.includes(req.user.goerEducationLevel)) {
      return res.status(403).json({ error: 'A Goer account with an assigned education group is required' });
    }

    await Promise.all([
      eventsTableReady, participantProfileColumnsReady, attendanceImportColumnsReady, participationTrackingReady,
    ]);
    const yearEventsPromise = pool.execute(
      `SELECT id, name, starts_at, location, status
       FROM events
       WHERE YEAR(starts_at) = YEAR(CURDATE())
       ORDER BY (starts_at >= NOW()) DESC, starts_at ASC, id ASC
       LIMIT 8`,
    );
    const [todayEventCountRows] = await pool.execute(
      `SELECT COUNT(*) AS count FROM events
       WHERE is_sample = FALSE AND status <> 'cancelled' AND DATE(starts_at) = CURDATE()`,
    );
    const upcomingEventsPromise = pool.execute(
      `SELECT id, name, starts_at, location, status
       FROM events WHERE status = 'scheduled' AND starts_at >= NOW()
       ORDER BY starts_at ASC LIMIT 5`,
    );
    const participantFilter = isGoer
      ? `participant_type = 'sponsored_child' AND education_level = ?
         AND status = 'active'
         AND COALESCE(participation_status, 'ACTIVE') <> 'INACTIVE'`
      : `participant_type = 'sponsored_child' AND status <> 'deleted'`;
    const participantParams = isGoer ? [req.user.goerEducationLevel] : [];
    const [[participantCounts]] = await pool.execute(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(
                LOWER(TRIM(COALESCE(status, ''))) = 'active'
                AND NOT (participant_type = 'sponsored_child'
                  AND UPPER(TRIM(COALESCE(participation_status, ''))) = 'INACTIVE')
              ), 0) AS active,
              COALESCE(SUM(
                LOWER(TRIM(COALESCE(status, ''))) = 'inactive'
                OR (participant_type = 'sponsored_child'
                  AND UPPER(TRIM(COALESCE(participation_status, ''))) = 'INACTIVE')
              ), 0) AS inactive,
              COALESCE(SUM(LOWER(gender) IN ('male', 'm')), 0) AS male,
              COALESCE(SUM(LOWER(gender) IN ('female', 'f')), 0) AS female,
              COALESCE(SUM(
                DATE(COALESCE(sponsorship_registered_at, sponsorship_start_date, created_at))
                  BETWEEN DATE_FORMAT(CURDATE(), '%Y-01-01') AND CURDATE()
              ), 0) AS newThisYear
       FROM participants WHERE ${participantFilter}`,
      participantParams,
    );
    const [[yearEvents], [upcomingEvents]] = await Promise.all([
      yearEventsPromise,
      upcomingEventsPromise,
    ]);

    const groupClause = isGoer
      ? `AND p.participant_type = 'sponsored_child'
         AND p.education_level = ? AND p.status = 'active'
         AND COALESCE(p.participation_status, 'ACTIVE') <> 'INACTIVE'`
      : `AND p.status = 'active'`;
    const attendanceParams = isGoer
      ? [req.user.goerEducationLevel, `${new Date().getFullYear()}-01-01`]
      : [`${new Date().getFullYear()}-01-01`];
    const [attendanceRows] = await pool.execute(
      `SELECT MIN(e.name) AS name, DATE_FORMAT(MIN(e.starts_at), '%Y-%m-%d') AS event_date,
              COUNT(DISTINCT p.id) AS required,
              COUNT(DISTINCT CASE WHEN c.status = 'checked_in' OR c.attendance_status = 'present' THEN p.id END) AS attended
       FROM events e
       JOIN participants p
         ON COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at) <= e.starts_at
         ${groupClause}
       LEFT JOIN check_in_logs c
         ON c.participant_id = p.id
        AND (
          (c.status = 'checked_in' AND LOWER(c.event_name) = LOWER(e.name)
           AND DATE(c.checked_in_at) = DATE(e.starts_at))
          OR (c.attendance_status = 'present' AND c.event_id = e.id)
        )
       WHERE (e.is_sample = FALSE OR e.description = 'Synthetic monthly attendance record.')
         AND e.status = 'completed' AND e.starts_at >= ? AND e.starts_at < NOW()
       GROUP BY LOWER(e.name), DATE(e.starts_at)
       ORDER BY event_date`,
      attendanceParams,
    );
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    startOfWeek.setHours(0, 0, 0, 0);
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const formatDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const todayKey = formatDateKey(now);
    const weekStartKey = formatDateKey(startOfWeek);
    const attendance = { today: { required: 0, attended: 0 }, week: { required: 0, attended: 0 }, month: { required: 0, attended: 0 }, year: { required: 0, attended: 0 } };
    const monthlyAttendance = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, required: 0, attended: 0 }));
    for (const row of attendanceRows) {
      const eventDate = String(row.event_date).slice(0, 10);
      const year = Number(eventDate.slice(0, 4));
      const month = Number(eventDate.slice(5, 7));
      const required = Number(row.required) || 0;
      const attended = Number(row.attended) || 0;
      attendance.year.required += required;
      attendance.year.attended += attended;
      monthlyAttendance[month - 1].required += required;
      monthlyAttendance[month - 1].attended += attended;
      if (eventDate === todayKey) {
        attendance.today.required += required;
        attendance.today.attended += attended;
      }
      if (eventDate >= weekStartKey) {
        attendance.week.required += required;
        attendance.week.attended += attended;
      }
      if (eventDate.slice(0, 7) === monthKey) {
        attendance.month.required += required;
        attendance.month.attended += attended;
      }
    }
    const withRate = (period) => ({
      ...period,
      absent: Math.max(0, period.required - period.attended),
      rate: period.required ? Math.round((period.attended / period.required) * 1000) / 10 : 0,
    });
    const [eventsThisMonthRows] = await pool.execute(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(status = 'completed' OR starts_at < NOW()), 0) AS completed
       FROM events WHERE is_sample = FALSE AND status <> 'cancelled'
         AND YEAR(starts_at) = YEAR(CURDATE()) AND MONTH(starts_at) = MONTH(CURDATE())`,
    );
    const [[eventsUpcomingCount]] = await pool.execute(
      `SELECT COUNT(*) AS count FROM events
       WHERE is_sample = FALSE AND status = 'scheduled' AND starts_at >= NOW()`,
    );
    const [recentCheckins] = await pool.execute(
      `SELECT c.participant_id, p.full_name_encrypted, p.participant_type,
              c.event_name, c.location, c.checked_in_at, c.status
       FROM check_in_logs c JOIN participants p ON p.id = c.participant_id
       WHERE c.status = 'checked_in' ${isGoer ? "AND p.participant_type = 'sponsored_child' AND p.education_level = ? AND COALESCE(p.participation_status, 'ACTIVE') <> 'INACTIVE'" : ''}
       ORDER BY c.checked_in_at DESC LIMIT 8`,
      isGoer ? [req.user.goerEducationLevel] : [],
    );
    const dashboard = {
      role: isAdmin ? 'admin' : isGoer ? 'goer' : 'staff',
      participantCounts: isAdmin || isGoer
        ? participantCounts
        : { active: Number(participantCounts.active) || 0 },
      attendance: Object.fromEntries(Object.entries(attendance).map(([key, period]) => [key, withRate(period)])),
      monthlyAttendance: monthlyAttendance.map(withRate),
      yearEvents,
      upcomingEvents,
      events: {
        today: Number(todayEventCountRows[0].count) || 0,
        upcoming: Number(eventsUpcomingCount.count) || 0,
        thisMonth: Number(eventsThisMonthRows[0].count) || 0,
        completedThisMonth: Number(eventsThisMonthRows[0].completed) || 0,
      },
      recentCheckins: recentCheckins.map((row) => ({
        ...row,
        participantName: isGoer || hasPermission(req.user, 'participants:view')
          ? decrypt(row.full_name_encrypted) || (row.participant_type === 'sponsored_child' ? 'Unnamed sponsored child' : 'Unnamed Church Goer')
          : null,
        full_name_encrypted: undefined,
      })),
    };

    if (isAdmin) {
      const [[users]] = await pool.execute(
        `SELECT COUNT(CASE WHEN role IN ('System Administrator', 'Church Administrator') THEN 1 END) AS totalStaff,
                COUNT(CASE WHEN role IN ('System Administrator', 'Church Administrator') AND status = 'active' THEN 1 END) AS activeStaff,
                COUNT(CASE WHEN role = 'Goer' THEN 1 END) AS goerAccounts,
                COUNT(CASE WHEN role = 'Church Administrator' THEN 1 END) AS churchAdministrators
         FROM users WHERE status <> 'deleted'`,
      );
      const children = await getSponsoredParticipationSummaries();
      const followups = children.filter((child) =>
        ['WARNING', 'GROUNDS_FOR_DEPARTURE'].includes(child.status),
      );
      await auditTableReady;
      const [recentActivity] = await pool.execute(
        `SELECT id, username, role, action, entity_type, details, created_at
         FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 8`,
      );
      dashboard.users = users;
      dashboard.sponsoredCare = {
        active: children.filter((child) => child.status === 'ACTIVE').length,
        warning: children.filter((child) => child.status === 'WARNING').length,
        groundsForDeparture: children.filter((child) => child.status === 'GROUNDS_FOR_DEPARTURE').length,
        removed: children.filter((child) => child.status === 'INACTIVE').length,
      };
      dashboard.followups = followups.slice(0, 8).map((child) => ({
        id: child.id,
        name: child.name,
        status: child.status,
        absent: child.lifetime?.absent || 0,
        postSecondChanceAbsences: child.postSecondChanceAbsences || 0,
      }));
      dashboard.followupCount = followups.length;
      dashboard.recentActivity = recentActivity;
    } else if (isGoer) {
      dashboard.educationLevel = req.user.goerEducationLevel;
      const groupChildren = await getSponsoredParticipationSummaries();
      const groupFollowups = groupChildren
        .filter((child) => child.educationLevel === req.user.goerEducationLevel
          && ['WARNING', 'GROUNDS_FOR_DEPARTURE'].includes(child.status));
      dashboard.followups = groupFollowups
        .slice(0, 8)
        .map((child) => ({
          id: child.id,
          name: child.name,
          status: child.status,
          absent: child.lifetime?.absent || 0,
          attendanceRate: child.lifetime?.attendanceRate || 0,
        }));
      dashboard.followupCount = groupFollowups.length;
      dashboard.groupParticipants = groupChildren
        .filter((child) => child.educationLevel === req.user.goerEducationLevel
          && child.status !== 'INACTIVE')
        .slice(0, 8)
        .map((child) => ({
          id: child.id,
          name: child.name,
          gender: child.gender,
          age: child.age,
          attendanceRate: child.lifetime?.attendanceRate || 0,
        }));
    } else if (hasPermission(req.user, 'sponsorship:view')) {
      const children = await getSponsoredParticipationSummaries();
      const staffFollowups = children
        .filter((child) => ['WARNING', 'GROUNDS_FOR_DEPARTURE'].includes(child.status));
      dashboard.followups = staffFollowups
        .slice(0, 8)
        .map((child) => ({
          id: child.id,
          name: child.name,
          status: child.status,
          absent: child.lifetime?.absent || 0,
          attendanceRate: child.lifetime?.attendanceRate || 0,
        }));
      dashboard.followupCount = staffFollowups.length;
      await sponsoredChildUpdatesReady;
      const [recentUpdates] = await pool.execute(
        `SELECT u.id, u.update_type, u.recorded_on, u.created_at,
                p.full_name_encrypted
         FROM sponsored_child_updates u
         JOIN participants p ON p.id = u.participant_id
         WHERE p.participant_type = 'sponsored_child' AND p.status <> 'deleted'
         ORDER BY u.created_at DESC, u.id DESC LIMIT 6`,
      );
      dashboard.recentCareUpdates = recentUpdates.map((row) => ({
        id: row.id,
        type: row.update_type,
        recordedOn: row.recorded_on,
        createdAt: row.created_at,
        participantName: decrypt(row.full_name_encrypted) || 'Unnamed sponsored child',
      }));
    }
    res.json(dashboard);
  } catch (error) { next(error); }
});

app.get('/api/participants', authenticate, checkPermission('participants:view'), async (req, res, next) => {
  try {
    await Promise.all([participantProfileColumnsReady, goerQrRevocationReady, participationTrackingReady]);
    if (isGoerRole(req.user.role) && !GOER_EDUCATION_LEVELS.includes(req.user.goerEducationLevel)) {
      return res.status(403).json({ error: 'A Goer account with an assigned education group is required' });
    }
    const canViewSponsorship = canViewParticipantCare(req.user);
    const goerScope = isGoerRole(req.user.role)
      ? "WHERE p.participant_type = 'sponsored_child' AND p.education_level = ? AND p.status = 'active'"
      : '';
    const [rows] = await pool.execute(
      `SELECT p.id, p.participant_code, p.participant_type, p.gender, p.status, p.created_at,
              p.participation_status, p.full_name_encrypted, p.first_name_encrypted, p.middle_name_encrypted,
              p.last_name_encrypted, p.date_of_birth_encrypted, p.education_level, p.grade_level,
              (SELECT q.qr_code_image FROM qr_codes q
               WHERE q.participant_id = p.id AND q.status = 'active'
                 AND p.participant_type = 'sponsored_child'
               ORDER BY q.id DESC LIMIT 1) AS qr_code_image
       FROM participants p ${goerScope} ORDER BY p.id DESC`,
      isGoerRole(req.user.role) ? [req.user.goerEducationLevel] : [],
    );
    const participationById = canViewSponsorship
      ? new Map((await getSponsoredParticipationSummaries()).map((child) => [Number(child.id), child]))
      : new Map();
    res.json(rows.map((row) => {
      const participant = participantView(row);
      const participation = participationById.get(Number(row.id));
      return {
        id: participant.id,
        participant_code: participant.participant_code,
        participant_type: participant.participant_type,
        gender: participant.gender,
        status: participant.status,
        created_at: participant.created_at,
        fullName: participant.fullName,
        age: participant.age,
        ...(canViewSponsorship ? {
          participation_status: participation?.status || 'ACTIVE',
          monthly_participation: participation?.monthly || null,
        } : {}),
        education_level: participant.education_level,
        grade_level: participant.grade_level,
        qr_code_image: participant.qr_code_image,
      };
    }));
  } catch (error) { next(error); }
});

app.get('/api/events', authenticate, checkPermission('events:view'), async (req, res, next) => {
  try {
    await eventPhotosTableReady;
    const [rows] = await pool.query(
      `SELECT e.id, e.name, e.description, e.starts_at, e.ends_at, e.location, e.status, e.is_sample, e.created_at,
              (SELECT COUNT(*) FROM event_photos p WHERE p.event_id = e.id) AS photo_count
       FROM events e ORDER BY e.starts_at DESC`,
    );
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/checkin/events', authenticate, checkPermission('checkin:record'), async (req, res, next) => {
  try {
    await Promise.all([eventsTableReady, attendanceImportColumnsReady]);
    const [rows] = await pool.query(
      'SELECT id, name, starts_at, location FROM events WHERE is_sample = FALSE ORDER BY starts_at DESC',
    );
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/checkin/group', authenticate, checkPermission('checkin:record'), async (req, res, next) => {
  try {
    if (!isGoerRole(req.user.role) || !GOER_EDUCATION_LEVELS.includes(req.user.goerEducationLevel)) {
      return res.status(403).json({ error: 'A Goer account with an assigned education group is required' });
    }
    await participantProfileColumnsReady;
    const [rows] = await pool.execute(
      `SELECT p.id, p.participant_code, p.full_name_encrypted, p.grade_level,
              (SELECT c.event_name FROM check_in_logs c
               WHERE c.participant_id = p.id AND DATE(c.checked_in_at) = CURDATE()
               ORDER BY c.checked_in_at DESC, c.id DESC LIMIT 1) AS attendance_event,
              (SELECT c.checked_in_at FROM check_in_logs c
               WHERE c.participant_id = p.id AND DATE(c.checked_in_at) = CURDATE()
               ORDER BY c.checked_in_at DESC, c.id DESC LIMIT 1) AS checked_in_at,
              (SELECT c.checked_out_at FROM check_in_logs c
               WHERE c.participant_id = p.id AND DATE(c.checked_in_at) = CURDATE()
               ORDER BY c.checked_in_at DESC, c.id DESC LIMIT 1) AS checked_out_at
       FROM participants p
       WHERE p.participant_type = 'sponsored_child'
         AND p.education_level = ? AND p.status = 'active'
       ORDER BY p.participant_code`,
      [req.user.goerEducationLevel],
    );
    const children = rows.map((row) => ({
      id: row.id,
      participantCode: row.participant_code,
      name: decrypt(row.full_name_encrypted) || 'Unnamed child',
      gradeLevel: row.grade_level || '',
      attendanceEvent: row.attendance_event,
      checkedInAt: row.checked_in_at,
      checkedOutAt: row.checked_out_at,
    })).sort((left, right) => left.name.localeCompare(right.name));
    res.json({ educationLevel: req.user.goerEducationLevel, children });
  } catch (error) { next(error); }
});

app.post('/api/events', authenticate, checkPermission('events:manage'), async (req, res, next) => {
  try {
    await eventPhotosTableReady;
    const name = String(req.body.name || '').trim();
    const startsAt = String(req.body.startsAt || '').trim();
    const endsAt = req.body.endsAt ? String(req.body.endsAt).trim() : null;
    const location = req.body.location ? String(req.body.location).trim() : null;
    const description = req.body.description ? String(req.body.description).trim() : null;
    const isSample = Boolean(description?.startsWith('Synthetic '));
    const parsedPhotos = parseEventPhotos(req.body.photos);
    if (!name || !startsAt) return res.status(400).json({ error: 'Event name and start time are required' });
    if (parsedPhotos.error) return res.status(400).json({ error: parsedPhotos.error });
    const startsDate = new Date(startsAt);
    const endsDate = endsAt ? new Date(endsAt) : null;
    if (Number.isNaN(startsDate.getTime()) || (endsDate && Number.isNaN(endsDate.getTime()))) return res.status(400).json({ error: 'Event times must be valid dates' });
    if (endsDate && endsDate < startsDate) return res.status(400).json({ error: 'End time must be after the start time' });
    const connection = await pool.getConnection();
    let result;
    try {
      await connection.beginTransaction();
      [result] = await connection.execute(
        'INSERT INTO events (name, description, starts_at, ends_at, location, is_sample, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, description, startsAt.replace('T', ' '), endsAt ? endsAt.replace('T', ' ') : null, location, isSample, req.user.id],
      );
      for (const photo of parsedPhotos.photos) {
        await connection.execute(
          'INSERT INTO event_photos (event_id, file_name, mime_type, photo_data, created_by) VALUES (?, ?, ?, ?, ?)',
          [result.insertId, photo.fileName, photo.mime, encryptBytes(photo.data), req.user.id],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeAuditLog(req.user, 'event.created', 'event', result.insertId, { photoCount: parsedPhotos.photos.length });
    const [rows] = await pool.execute(
      `SELECT e.id, e.name, e.description, e.starts_at, e.ends_at, e.location, e.status, e.is_sample, e.created_at,
              (SELECT COUNT(*) FROM event_photos p WHERE p.event_id = e.id) AS photo_count
       FROM events e WHERE e.id = ?`,
      [result.insertId],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An event with the same name and start time already exists' });
    next(error);
  }
});

app.get('/api/events/:id/photos', authenticate, checkPermission('events:view'), async (req, res, next) => {
  try {
    await eventPhotosTableReady;
    const [[event]] = await pool.execute('SELECT id FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const [photos] = await pool.execute(
      'SELECT id, file_name, mime_type, photo_data, OCTET_LENGTH(photo_data) AS byte_size, created_at FROM event_photos WHERE event_id = ? ORDER BY id',
      [req.params.id],
    );
    res.json(photos.map((photo) => {
      const data = decryptBytes(photo.photo_data);
      return {
        id: photo.id,
        fileName: photo.file_name,
        mimeType: photo.mime_type,
        data: data.toString('base64'),
        byteSize: data.length,
        createdAt: photo.created_at,
      };
    }));
  } catch (error) { next(error); }
});

app.post('/api/events/:id/photos', authenticate, checkPermission('events:manage'), async (req, res, next) => {
  try {
    await eventPhotosTableReady;
    const parsedPhotos = parseEventPhotos(req.body.photos);
    if (parsedPhotos.error) return res.status(400).json({ error: parsedPhotos.error });
    if (!parsedPhotos.photos.length) return res.status(400).json({ error: 'Select at least one event photo to upload' });
    const [[event]] = await pool.execute('SELECT id FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('SELECT id FROM events WHERE id = ? FOR UPDATE', [req.params.id]);
      const [[count]] = await connection.execute(
        `SELECT COUNT(*) AS photo_count, COALESCE(SUM(OCTET_LENGTH(photo_data)), 0) AS photo_bytes
         FROM event_photos WHERE event_id = ?`,
        [req.params.id],
      );
      if (Number(count.photo_count) + parsedPhotos.photos.length > eventPhotosMaxCount) {
        await connection.rollback();
        return res.status(400).json({ error: `Each event can have no more than ${eventPhotosMaxCount} photos` });
      }
      const newPhotoBytes = parsedPhotos.photos.reduce((total, photo) => total + photo.data.length, 0);
      if (Number(count.photo_bytes) + newPhotoBytes > eventPhotosMaxTotalBytes) {
        await connection.rollback();
        return res.status(400).json({ error: 'Photos for each event must total no more than 15 MB' });
      }
      for (const photo of parsedPhotos.photos) {
        await connection.execute(
          'INSERT INTO event_photos (event_id, file_name, mime_type, photo_data, created_by) VALUES (?, ?, ?, ?, ?)',
          [req.params.id, photo.fileName, photo.mime, encryptBytes(photo.data), req.user.id],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeAuditLog(req.user, 'event.photos.uploaded', 'event', req.params.id, { photoCount: parsedPhotos.photos.length });
    res.status(201).json({ uploaded: parsedPhotos.photos.length });
  } catch (error) { next(error); }
});

app.get('/api/events/:id/attendance', authenticate, checkPermission('events:view'), async (req, res, next) => {
  try {
    await Promise.all([eventsTableReady, attendanceImportColumnsReady]);
    const [[event]] = await pool.execute('SELECT id, name, description, starts_at, ends_at, location, status, is_sample FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const [attendance] = await pool.execute(
      `SELECT c.id, c.participant_id, p.participant_code, p.participant_type,
              p.full_name_encrypted, p.first_name_encrypted, p.middle_name_encrypted, p.last_name_encrypted,
              c.event_name, c.location, c.checked_in_at, c.checked_out_at, c.status,
              c.attendance_status
       FROM check_in_logs c JOIN participants p ON p.id = c.participant_id
       WHERE (c.event_id = ? AND c.attendance_status = 'present')
          OR (c.event_name = ?
            AND c.checked_in_at >= DATE(?)
            AND c.checked_in_at < DATE_ADD(DATE(?), INTERVAL 1 DAY)
            AND c.status = 'checked_in')
       ORDER BY c.checked_in_at IS NULL, c.checked_in_at ASC, c.id`,
      [event.id, event.name, event.starts_at, event.starts_at],
    );
    res.json({
      event,
      attendance: attendance.map((row) => {
        const participant = participantView(row);
        const {
          full_name_encrypted,
          first_name_encrypted,
          middle_name_encrypted,
          last_name_encrypted,
          ...attendanceRow
        } = row;
        return {
          ...attendanceRow,
          participant_name: participant.fullName,
        };
      }),
    });
  } catch (error) { next(error); }
});

app.get('/api/participants/:id', authenticate, checkPermission('participants:view'), async (req, res, next) => {
  try {
    await Promise.all([participantProfileColumnsReady, goerQrRevocationReady, participationTrackingReady]);
    const [rows] = await pool.execute("SELECT p.*, q.qr_code_image, q.qr_uid FROM participants p LEFT JOIN qr_codes q ON q.id = (SELECT q2.id FROM qr_codes q2 WHERE q2.participant_id = p.id AND q2.status = 'active' AND p.participant_type = 'sponsored_child' ORDER BY q2.id DESC LIMIT 1) WHERE p.id = ? LIMIT 1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Record not found' });
    if (!canViewParticipant(req.user, rows[0])) {
      return res.status(404).json({ error: 'Record not found or not assigned to your group.' });
    }
    if (rows[0].participant_type !== 'goer' && rows[0].qr_code_image && rows[0].qr_uid) {
      const qrFile = path.join(__dirname, rows[0].qr_code_image);
      if (!fs.existsSync(qrFile)) {
        await QRCode.toFile(qrFile, rows[0].qr_uid);
      }
    }
    const participant = participantView(rows[0]);
    delete participant.qr_uid;
    if (canViewParticipantCare(req.user) && participant.participant_type === 'sponsored_child') {
      const [monitoring] = await getSponsoredParticipationSummaries(Number(req.params.id));
      participant.participation_status = monitoring?.status || 'ACTIVE';
      participant.monthly_participation = monitoring?.monthly || null;
    } else {
      delete participant.participation_status;
    }
    res.json({ participant });
  } catch (error) { next(error); }
});

app.get('/api/participants/:id/education-history', authenticate, checkPermission('participants:view'), async (req, res, next) => {
  try {
    await Promise.all([participantProfileColumnsReady, educationHistoryReady]);
    const [[participant]] = await pool.execute(
      `SELECT id, participant_type, education_level, emergency_contact_phone_encrypted, status
       FROM participants WHERE id = ? AND status <> 'deleted' LIMIT 1`,
      [req.params.id],
    );
    if (!participant) return res.status(404).json({ error: 'Record not found' });
    if (!canViewParticipant(req.user, participant)) {
      return res.status(404).json({ error: 'Record not found or not assigned to your group.' });
    }
    const [rows] = await pool.execute(
      `SELECT id, education_level, school_name_encrypted, school_address_encrypted,
              start_year, end_year, status, course_strand_encrypted, notes_encrypted
       FROM participant_education_history
       WHERE participant_id = ? ORDER BY start_year DESC, id DESC`,
      [participant.id],
    );
    res.json(rows.map(educationHistoryView));
  } catch (error) { next(error); }
});

app.post('/api/participants/:id/education-history', authenticate, checkPermission('participants:edit'), async (req, res, next) => {
  try {
    await Promise.all([participantProfileColumnsReady, educationHistoryReady]);
    const record = {
      educationLevel: String(req.body.educationLevel || '').trim(),
      schoolName: String(req.body.schoolName || '').trim(),
      schoolAddress: String(req.body.schoolAddress || '').trim(),
      startYear: req.body.startYear,
      endYear: req.body.endYear === '' || req.body.endYear === undefined ? null : req.body.endYear,
      status: String(req.body.status || '').trim(),
      courseStrand: String(req.body.courseStrand || '').trim(),
      notes: String(req.body.notes || '').trim(),
    };
    const errors = validateEducationRecord(record);
    if (record.schoolName.length > 200) errors.push('School name must be 200 characters or fewer');
    if (record.schoolAddress.length > 500) errors.push('School address must be 500 characters or fewer');
    if (record.courseStrand.length > 200) errors.push('Course or strand must be 200 characters or fewer');
    if (record.notes.length > 2000) errors.push('Notes must be 2,000 characters or fewer');
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    const [[participant]] = await pool.execute(
      `SELECT id FROM participants WHERE id = ? AND status <> 'deleted' LIMIT 1`,
      [req.params.id],
    );
    if (!participant) return res.status(404).json({ error: 'Record not found' });
    const fingerprint = educationFingerprint(record);
    try {
      const [result] = await pool.execute(
        `INSERT INTO participant_education_history
           (participant_id, education_level, school_name_encrypted, school_address_encrypted,
            start_year, end_year, status, course_strand_encrypted, notes_encrypted,
            record_fingerprint, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          participant.id, record.educationLevel, encrypt(record.schoolName),
          encrypt(record.schoolAddress || null), Number(record.startYear),
          record.endYear === null ? null : Number(record.endYear), record.status,
          encrypt(record.courseStrand || null), encrypt(record.notes || null),
          fingerprint, req.user.id,
        ],
      );
      await writeAuditLog(req.user, 'participant.education.created', 'participant', participant.id, {
        educationLevel: record.educationLevel,
        startYear: Number(record.startYear),
      });
      res.status(201).json({ id: result.insertId });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This education record already exists' });
      throw error;
    }
  } catch (error) { next(error); }
});

app.delete('/api/participants/:id/education-history/:recordId', authenticate, checkPermission('participants:edit'), async (req, res, next) => {
  try {
    await educationHistoryReady;
    const [result] = await pool.execute(
      'DELETE FROM participant_education_history WHERE id = ? AND participant_id = ?',
      [req.params.recordId, req.params.id],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Education record not found' });
    await writeAuditLog(req.user, 'participant.education.deleted', 'participant', req.params.id);
    res.status(204).end();
  } catch (error) { next(error); }
});

function validImportDate(value) {
  const date = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function importDateOnly(value) {
  const normalized = normalizePhilippineDateOnly(value);
  if (normalized) return normalized;
  if (value instanceof Date) {
    return '';
  }
  return String(value || '').slice(0, 10);
}

function normalizeImportDate(value) {
  if (value instanceof Date) return importDateOnly(value);
  const input = String(value || '').trim();
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const us = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T ].*)?$/);
  if (us) return `${us[3]}-${String(us[1]).padStart(2, '0')}-${String(us[2]).padStart(2, '0')}`;
  return input;
}

function normalizeImportDateTime(value) {
  const input = String(value || '').trim();
  let date;
  let time;
  const iso = input.match(/^(\d{4}-\d{2}-\d{2})[T ](.+)$/);
  const us = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(.+)$/);
  if (iso) {
    date = iso[1];
    time = normalizeImportTime(iso[2]);
  } else if (us) {
    date = `${us[3]}-${String(us[1]).padStart(2, '0')}-${String(us[2]).padStart(2, '0')}`;
    time = normalizeImportTime(us[4]);
  }
  if (!date || !time || !validImportDate(date)) return null;
  return `${date} ${time}`;
}

function importAttendanceStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'present' ? 'Present'
    : normalized === 'absent' ? 'Absent' : null;
}

function importParticipantId(value) {
  const input = String(value || '').trim();
  return /^[1-9]\d*$/.test(input) && Number.isSafeInteger(Number(input))
    ? Number(input) : null;
}

app.post('/api/participants/import/inspect', authenticate, checkImportPermission, async (req, res, next) => {
  try {
    res.json(inspectImportFile(req.body.fileName, req.body.fileData));
  } catch (error) {
    if (error.code === 'INVALID_IMPORT_FILE') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

async function validateParticipantImport(type, rows, headers, mapping) {
  const errors = [];
  const normalized = [];
  errors.push(...validateImportHeaders(type, headers, mapping));
  if (errors.length) return { errors, normalized: [] };
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_IMPORT_ROWS) {
    return { errors: [`The import must contain between 1 and ${MAX_IMPORT_ROWS.toLocaleString('en-US')} data rows`], normalized: [] };
  }
  const [participants] = await pool.execute(
    `SELECT id, participant_code, participant_type, full_name_encrypted,
            first_name_encrypted, middle_name_encrypted, last_name_encrypted,
            date_of_birth_encrypted, gender, sponsorship_registered_at,
            sponsorship_start_date, created_at, participation_status
     FROM participants
     WHERE COALESCE(status, '') <> 'deleted'`,
  );
  const byId = new Map();
  const byCode = new Map();
  const existingParticipantViews = participants
    .filter((participant) => participant.participant_type === 'sponsored_child')
    .map((participant) => participantView(participant));
  for (const participant of participants) {
    byId.set(Number(participant.id), participant);
    if (participant.participant_code) byCode.set(String(participant.participant_code).toLowerCase(), participant);
  }

  const resolveParticipant = (source, row) => {
    const rawId = String(source.participantId || '').trim();
    const code = String(source.participantCode || '').trim();
    let bySuppliedId = null;
    if (rawId) {
      const id = importParticipantId(rawId);
      if (!id) row.errors.push('Sponsored Child ID must be a positive numeric ID');
      else if (id > 4294967295) row.errors.push('Sponsored Child ID exceeds the database limit');
      else {
        row.participantId = id;
        bySuppliedId = byId.get(id) || null;
      }
    }
    const bySuppliedCode = code ? byCode.get(code.toLowerCase()) || null : null;
    if (bySuppliedId && bySuppliedCode && Number(bySuppliedId.id) !== Number(bySuppliedCode.id)) {
      row.errors.push('Sponsored Child ID and Sponsored Child Code refer to different children');
    }
    const match = bySuppliedId || bySuppliedCode;
    if (match && match.participant_type !== 'sponsored_child') {
      row.errors.push('The supplied identifier belongs to a non-sponsored participant');
      return null;
    }
    return match;
  };

  const resolvedParticipants = rows.map((source) => {
    const row = { errors: [] };
    const participant = resolveParticipant(source || {}, row);
    return participant ? Number(participant.id) : null;
  }).filter(Boolean);
  const participantIds = [...new Set(resolvedParticipants)];
  const existingEducationKeys = new Set();
  const existingEducationIds = new Map();
  if (type === 'education') {
    if (participantIds.length) {
      for (let offset = 0; offset < participantIds.length; offset += 500) {
        const batch = participantIds.slice(offset, offset + 500);
        const placeholders = batch.map(() => '?').join(', ');
        const [existingEducation] = await pool.execute(
          `SELECT id, participant_id, record_fingerprint FROM participant_education_history
           WHERE participant_id IN (${placeholders})`,
          batch,
        );
        for (const record of existingEducation) {
          existingEducationKeys.add(`${record.participant_id}|${record.record_fingerprint}`);
          existingEducationIds.set(Number(record.id), Number(record.participant_id));
        }
      }
    }
  }
  const existingAttendanceKeys = new Set();
  const eventsById = new Map();
  const eventsByOccurrence = new Map();
  const existingEventKeys = new Set();
  const existingEventIds = new Set();
  const existingSummaryKeys = new Set();
  const eventRows = [];
  if (type === 'events') {
    const [events] = await pool.execute(
      `SELECT id, name, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at
       FROM events WHERE is_sample = FALSE`,
    );
    for (const event of events) {
      existingEventKeys.add(`${String(event.name).trim().toLowerCase()}|${event.starts_at}`);
      existingEventIds.add(Number(event.id));
    }
  }
  if (type === 'attendanceSummary' && participantIds.length) {
    for (let offset = 0; offset < participantIds.length; offset += 500) {
      const batch = participantIds.slice(offset, offset + 500);
      const placeholders = batch.map(() => '?').join(', ');
      const [summaries] = await pool.execute(
        `SELECT participant_id, attendance_year FROM participant_attendance_summaries
         WHERE participant_id IN (${placeholders})`,
        batch,
      );
      for (const record of summaries) {
        existingSummaryKeys.add(`${record.participant_id}|${record.attendance_year}`);
      }
    }
  }
  if (type === 'attendance') {
    const eventIds = [...new Set(rows
      .map((source) => Number(source?.eventId))
      .filter((id) => Number.isSafeInteger(id) && id > 0))];
    const eventDates = [...new Set(rows
      .map((source) => normalizeImportDate(source?.eventDate))
      .filter((date) => validImportDate(date)))].sort();
    const dateRange = eventDates.length
      ? [eventDates[0], eventDates[eventDates.length - 1]]
      : null;

    if (dateRange) {
      const [scheduledEvents] = await pool.execute(
        `SELECT id, name, starts_at, ends_at, location, status,
                DATE_FORMAT(starts_at, '%Y-%m-%d') AS event_date
         FROM events WHERE is_sample = FALSE
           AND starts_at >= ? AND starts_at < DATE_ADD(?, INTERVAL 1 DAY)`,
        dateRange,
      );
      eventRows.push(...scheduledEvents);
    }
    for (let offset = 0; offset < eventIds.length; offset += 500) {
      const batch = eventIds.slice(offset, offset + 500);
      const placeholders = batch.map(() => '?').join(', ');
      const [byIds] = await pool.execute(
        `SELECT id, name, starts_at, ends_at, location, status,
                DATE_FORMAT(starts_at, '%Y-%m-%d') AS event_date
         FROM events WHERE is_sample = FALSE AND id IN (${placeholders})`,
        batch,
      );
      eventRows.push(...byIds);
    }
    for (const event of eventRows) {
      const id = Number(event.id);
      eventsById.set(id, event);
      const key = `${String(event.name).trim().toLowerCase()}|${event.event_date}`;
      const matches = eventsByOccurrence.get(key) || [];
      if (!matches.some((match) => Number(match.id) === id)) matches.push(event);
      eventsByOccurrence.set(key, matches);
    }
    if (participantIds.length && eventRows.length) {
      const ids = [...new Set(eventRows.map((event) => Number(event.id)))];
      const eventDateRange = [...new Set(eventRows.map((event) => String(event.event_date).slice(0, 10)))]
        .filter((date) => validImportDate(date))
        .sort();
      const range = eventDateRange.length
        ? [eventDateRange[0], eventDateRange[eventDateRange.length - 1]]
        : null;
      for (let participantOffset = 0; participantOffset < participantIds.length; participantOffset += 250) {
        const people = participantIds.slice(participantOffset, participantOffset + 250);
        const peopleMarks = people.map(() => '?').join(', ');
        for (let eventOffset = 0; eventOffset < ids.length; eventOffset += 250) {
          const eventBatch = ids.slice(eventOffset, eventOffset + 250);
          const eventMarks = eventBatch.map(() => '?').join(', ');
          const [existingAttendance] = await pool.execute(
            `SELECT id, participant_id, event_id, LOWER(TRIM(event_name)) AS event_name,
                    DATE_FORMAT(checked_in_at, '%Y-%m-%d') AS event_date,
                    attendance_status, status
             FROM check_in_logs
             WHERE participant_id IN (${peopleMarks})
               AND (event_id IN (${eventMarks}) ${range
                 ? 'OR (checked_in_at >= ? AND checked_in_at < DATE_ADD(?, INTERVAL 1 DAY))'
                 : ''})`,
            [...people, ...eventBatch, ...(range || [])],
          );
          for (const record of existingAttendance) {
            if (record.status === 'checked_in' || ['present', 'absent'].includes(String(record.attendance_status || '').toLowerCase())) {
              if (record.event_id) {
              existingAttendanceKeys.add(`${record.participant_id}|event:${record.event_id}`);
              } else if (record.event_date) {
                existingAttendanceKeys.add(`${record.participant_id}|${record.event_name}|${record.event_date}`);
              }
            }
          }
        }
      }
    }
    const attendanceRecordIds = [...new Set(rows
      .map((source) => Number(source?.attendanceRecordId))
      .filter((id) => Number.isSafeInteger(id) && id > 0))];
    for (let offset = 0; offset < attendanceRecordIds.length; offset += 500) {
      const batch = attendanceRecordIds.slice(offset, offset + 500);
      const placeholders = batch.map(() => '?').join(', ');
      const [existingIds] = await pool.execute(
        `SELECT id FROM check_in_logs WHERE id IN (${placeholders})`,
        batch,
      );
      for (const record of existingIds) existingAttendanceKeys.add(`record:${record.id}`);
    }
  }
  const seenParticipantIdentifiers = new Set();
  const seenParticipantIds = new Set();
  const seenParticipantNames = new Set();
  const seenEducation = new Set();
  const seenEducationIds = new Set();
  const seenAttendance = new Set();
  const seenAttendanceRecordIds = new Set();
  const seenEventIds = new Set();
  const seenAttendanceSummaries = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const source = rows[index] && typeof rows[index] === 'object' && !Array.isArray(rows[index])
      ? rows[index]
      : {};
    const row = { ...source, rowNumber: index + 2, errors: [], warnings: [] };
    if (type === 'participants') {
      const matchingIdentifier = resolveParticipant(source, row);
      row.firstName = String(source.firstName || '').trim();
      row.middleName = String(source.middleName || '').trim();
      row.lastName = String(source.lastName || '').trim();
      row.participantCode = String(source.participantCode || '').trim();
      row.suffix = String(source.suffix || '').trim();
      row.dateOfBirth = normalizeImportDate(source.dateOfBirth);
      const rawGender = String(source.gender || '').trim().toLowerCase();
      row.gender = ['m', 'male'].includes(rawGender) ? 'Male'
        : ['f', 'female'].includes(rawGender) ? 'Female' : String(source.gender || '').trim();
      if (!row.firstName || !row.lastName) row.errors.push('First and last name are required');
      if (!validImportDate(row.dateOfBirth)) row.errors.push('Invalid or missing date of birth');
      if (!genderOptions.has(row.gender)) row.errors.push('Gender must be Male or Female');
      if (row.dateOfBirth && row.dateOfBirth > new Date().toISOString().slice(0, 10)) row.errors.push('Date of birth cannot be in the future');
      if (row.firstName.length > 100 || row.middleName.length > 100 || row.lastName.length > 100) {
        row.errors.push('Names must be 100 characters or fewer');
      }
      row.registrationDate = normalizeImportDate(source.registrationDate);
      if (!validImportDate(row.registrationDate)) row.errors.push('Registration Date is required and must be a valid date');
      if (validImportDate(row.registrationDate) && validImportDate(row.dateOfBirth) && row.registrationDate < row.dateOfBirth) {
        row.errors.push('Registration Date cannot be earlier than Date of Birth');
      }
      row.currentStatus = normalizeSponsorshipStatus(source.currentStatus);
      if (!row.currentStatus) row.errors.push('Participation Status must be Active, Warning, Ground for Departure, or Inactive');
      const suppliedAge = String(source.age || '').trim();
      if (suppliedAge && /^\d+$/.test(suppliedAge) && validImportDate(row.dateOfBirth)) {
        const calculatedAge = calculateAge(row.dateOfBirth);
        if (Number(suppliedAge) !== calculatedAge) {
          row.warnings.push(`Uploaded age (${suppliedAge}) differs from the calculated age (${calculatedAge}); the calculated age is used`);
        }
      } else if (suppliedAge) {
        row.warnings.push('Uploaded age is ignored; age is calculated from Date of Birth');
      }
      row.guardianName = String(source.guardianName || '').trim();
      row.guardianContact = String(source.guardianContact || '').trim();
      row.phone = String(source.phone || '').trim();
      row.address = String(source.address || '').trim();
      if (row.suffix) row.warnings.push('Suffix is not stored because the current database has no suffix field');
      if (String(source.guardianRelationship || '').trim()) row.warnings.push('Guardian Relationship is not stored because the current database has no relationship field');
      if (String(source.guardianEmail || '').trim()) row.warnings.push('Guardian Email is not stored because the current database has no guardian email field');
      if (row.participantCode && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/.test(row.participantCode)) {
        row.errors.push('Sponsored Child Code contains unsupported characters or is too long');
      }
      if (row.participantCode) {
        const codeKey = row.participantCode.toLowerCase();
        if (seenParticipantIdentifiers.has(codeKey)) row.errors.push('Duplicate Sponsored Child Code in this file');
        seenParticipantIdentifiers.add(codeKey);
      }
      if (String(source.participantId || '').trim()) {
        const id = importParticipantId(source.participantId);
        if (id) {
          if (seenParticipantIds.has(id)) row.errors.push('Duplicate Sponsored Child ID in this file');
          seenParticipantIds.add(id);
        }
      }
      const participantNameKey = `${normalizeParticipantName([row.firstName, row.middleName, row.lastName].filter(Boolean).join(' '))}|${row.dateOfBirth}`;
      const duplicateNameRow = row.dateOfBirth && seenParticipantNames.has(participantNameKey);
      if (row.dateOfBirth) seenParticipantNames.add(participantNameKey);
      const fullName = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ');
      const possibleDuplicate = findPotentialParticipantDuplicates({
        fullName,
        firstName: row.firstName,
        lastName: row.lastName,
        dateOfBirth: row.dateOfBirth,
      }, existingParticipantViews)[0];
      const matching = matchingIdentifier
        || participants.find((participant) => Number(participant.id) === Number(possibleDuplicate?.id));
      if (matching && row.participantCode && String(matching.participant_code || '').toLowerCase() !== row.participantCode.toLowerCase()) {
        row.errors.push('Sponsored Child Code does not match the existing Sponsored Child ID');
      }
      row.matchingParticipantId = matching?.id || null;
      row.operation = matching ? 'review' : 'create';
      if (duplicateNameRow) row.errors.push('Duplicate sponsored child name and date of birth in this file');
      if (matching) row.warnings.push(`Possible existing sponsored child match: ${matching.participant_code || `#${matching.id}`}`);
    } else if (type === 'education') {
      const participant = resolveParticipant(source, row);
      if (!String(source.participantId || '').trim() && !String(source.participantCode || '').trim()) {
        row.errors.push('Sponsored Child ID or Sponsored Child Code is required');
      }
      if (!participant) row.errors.push('Sponsored Child does not match an existing sponsored child');
      else row.participantId = Number(participant.id);
      row.educationHistoryId = source.educationHistoryId ? importParticipantId(source.educationHistoryId) : null;
      if (source.educationHistoryId && !row.educationHistoryId) row.errors.push('Education History ID must be a positive numeric ID');
      if (row.educationHistoryId && seenEducationIds.has(row.educationHistoryId)) {
        row.errors.push('Duplicate Education History ID in this file');
      }
      if (row.educationHistoryId) seenEducationIds.add(row.educationHistoryId);
      row.schoolName = String(source.schoolName || '').trim();
      row.schoolAddress = String(source.schoolAddress || '').trim();
      row.educationLevel = String(source.educationLevel || '').trim();
      row.startDate = normalizeImportDate(source.startDate);
      row.endDate = normalizeImportDate(source.endDate);
      const schoolYear = parseSchoolYear(source.schoolYear);
      if (!schoolYear) row.errors.push('School Year is required and must contain a valid year or year range');
      if (!validImportDate(row.startDate)) row.errors.push('Start Date is required and must be a valid date');
      if (row.endDate && !validImportDate(row.endDate)) row.errors.push('End Date must be a valid date');
      if (validImportDate(row.startDate) && validImportDate(row.endDate) && row.endDate < row.startDate) {
        row.errors.push('End Date cannot be earlier than Start Date');
      }
      row.status = normalizeEducationStatus(source.status);
      row.startYear = validImportDate(row.startDate) ? Number(row.startDate.slice(0, 4)) : schoolYear?.startYear;
      row.endYear = row.endDate ? Number(row.endDate.slice(0, 4))
        : ['Graduated', 'Completed'].includes(row.status) ? schoolYear?.endYear ?? null : null;
      row.completionInformation = String(source.completionInformation || '').trim();
      row.courseStrand = '';
      row.notes = row.completionInformation;
      if (String(source.gradeLevel || '').trim()) row.warnings.push('Grade or Year Level is not stored because the current database has no grade history field');
      if (schoolYear && row.startYear && schoolYear.startYear !== row.startYear) {
        row.warnings.push('School Year does not begin in the same year as Start Date');
      }
      row.errors.push(...validateEducationRecord(row));
      const duplicateKey = `${row.participantId || ''}|${educationFingerprint(row)}`;
      if (seenEducation.has(duplicateKey)) row.errors.push('Duplicate education record in this file');
      seenEducation.add(duplicateKey);
      if (row.educationHistoryId && existingEducationIds.has(row.educationHistoryId)) {
        if (existingEducationIds.get(row.educationHistoryId) !== row.participantId) {
          row.errors.push('Education History ID already belongs to a different child');
        } else {
          row.warnings.push('Education History ID already exists');
          row.duplicate = true;
        }
      }
      if (row.participantId && existingEducationKeys.has(duplicateKey)) {
        row.warnings.push('Education record already exists');
        row.duplicate = true;
      }
      row.operation = row.errors.length ? 'error' : row.duplicate ? 'review' : 'create';
    } else if (type === 'attendanceSummary') {
      const participant = resolveParticipant(source, row);
      if (!String(source.participantId || '').trim()) row.errors.push('Sponsored Child ID is required');
      if (!participant) row.errors.push('Sponsored Child ID does not match an existing sponsored child');
      else row.participantId = Number(participant.id);
      row.year = Number(source.year);
      row.required = Number(source.required);
      row.attended = Number(source.attended);
      row.absent = Number(source.absent);
      if (source.year === undefined || String(source.year).trim() === '') row.errors.push('Attendance Year is required');
      if (source.required === undefined || String(source.required).trim() === '') row.errors.push('Required Count is required');
      if (source.attended === undefined || String(source.attended).trim() === '') row.errors.push('Attended Count is required');
      if (source.absent === undefined || String(source.absent).trim() === '') row.errors.push('Absent Count is required');
      if (!Number.isInteger(row.year) || row.year < 1900 || row.year > new Date().getFullYear()) {
        row.errors.push('Attendance Year must be a valid calendar year');
      }
      if (!Number.isInteger(row.required) || row.required < 0 || row.required > 1000) {
        row.errors.push('Required Count must be a whole number from 0 to 1,000');
      }
      if (!Number.isInteger(row.attended) || row.attended < 0 || row.attended > row.required) {
        row.errors.push('Attended Count must be a whole number no greater than Required Count');
      }
      if (!Number.isInteger(row.absent) || row.absent < 0 || row.absent > row.required) {
        row.errors.push('Absent Count must be a whole number no greater than Required Count');
      }
      if (row.attended + row.absent !== row.required) {
        row.errors.push('Attended Count and Absent Count must total Required Count');
      }
      row.attendanceRate = row.required ? (row.attended / row.required) * 100 : 0;
      row.absenceRate = row.required ? (row.absent / row.required) * 100 : 0;
      for (const [field, calculated] of [['attendanceRate', row.attendanceRate], ['absenceRate', row.absenceRate]]) {
        const supplied = String(source[field] || '').trim();
        const suppliedValue = supplied.endsWith('%') ? Number(supplied.slice(0, -1)) : Number(supplied);
        if (supplied && (!Number.isFinite(suppliedValue) || Math.abs(suppliedValue - calculated) > 0.1)) {
          row.warnings.push(`${field === 'attendanceRate' ? 'Attendance' : 'Absence'} Rate was recalculated from the counts`);
        }
      }
      const summaryKey = `${row.participantId || ''}|${row.year}`;
      if (seenAttendanceSummaries.has(summaryKey)) row.errors.push('Duplicate yearly attendance summary in this file');
      seenAttendanceSummaries.add(summaryKey);
      if (row.participantId && Number.isInteger(row.year) && existingSummaryKeys.has(summaryKey)) {
        row.warnings.push('Historical attendance summary already exists');
        row.duplicate = true;
      }
      row.operation = row.errors.length ? 'error' : row.duplicate ? 'review' : 'create';
    } else if (type === 'events') {
      row.eventId = source.eventId ? importParticipantId(source.eventId) : null;
      if (source.eventId && (!row.eventId || row.eventId > 4294967295)) row.errors.push('Activity/Event ID must be a positive numeric ID within the database limit');
      if (row.eventId && seenEventIds.has(row.eventId)) row.errors.push('Duplicate Activity/Event ID in this file');
      if (row.eventId) seenEventIds.add(row.eventId);
      row.eventName = String(source.eventName || '').trim();
      row.eventDescription = String(source.eventDescription || '').trim();
      row.eventDate = normalizeImportDate(source.eventDate);
      row.startTime = normalizeImportTime(source.startTime);
      row.endTime = normalizeImportTime(source.endTime);
      row.eventStatus = normalizeEventStatus(source.eventStatus);
      row.eventStart = validImportDate(row.eventDate)
        ? `${row.eventDate} ${row.startTime || '00:00:00'}` : null;
      row.eventEnd = row.endTime && validImportDate(row.eventDate)
        ? `${row.eventDate} ${row.endTime}` : null;
      row.createdDate = normalizeImportDate(source.createdDate);
      row.eventLocation = String(source.eventLocation || '').trim();
      if (!row.eventName) row.errors.push('Event name is required');
      if (row.eventName.length > 100) row.errors.push('Event name must be 100 characters or fewer');
      if (!validImportDate(row.eventDate)) row.errors.push('Event Date is required and must be a valid date');
      if (source.startTime && !row.startTime) row.errors.push('Start Time has an invalid time format');
      if (source.endTime && !row.endTime) row.errors.push('End Time has an invalid time format');
      if (!row.startTime && validImportDate(row.eventDate)) row.warnings.push('Start Time is blank; the existing database stores date-only events at 00:00');
      if (!row.eventStatus) row.errors.push('Event Status must be Scheduled, Completed, or Cancelled');
      if (source.createdDate && !validImportDate(row.createdDate)) row.errors.push('Created Date must be a valid date');
      if (row.eventEnd && row.eventStart && row.eventEnd < row.eventStart) {
        row.errors.push('Event end time must be after the start time');
      }
      if (row.eventDescription.length > 500) row.errors.push('Event description must be 500 characters or fewer');
      if (row.eventLocation.length > 100) row.errors.push('Event location must be 100 characters or fewer');
      row.eventType = String(source.eventType || '').trim();
      row.educationGroup = String(source.educationGroup || '').trim();
      if (row.eventType) row.warnings.push('Activity Type is not stored because the current database has no activity type field');
      if (row.educationGroup) row.warnings.push('Education Group is not stored because the current database has no event group field');
      const eventKey = `${row.eventName.toLocaleLowerCase()}|${row.eventStart || ''}`;
      if (seenAttendance.has(eventKey)) row.errors.push('Duplicate event in this file');
      seenAttendance.add(eventKey);
      if (row.eventId && existingEventIds.has(row.eventId)) {
        row.warnings.push('Activity/Event ID already exists');
        row.duplicate = true;
      } else if (row.eventName && row.eventStart && existingEventKeys.has(eventKey)) {
        row.warnings.push('An event with the same name and start time already exists');
        row.duplicate = true;
      }
      row.operation = row.errors.length ? 'error' : row.duplicate ? 'review' : 'create';
    } else {
      const participant = resolveParticipant(source, row);
      if (!String(source.participantId || '').trim()) row.errors.push('Sponsored Child ID is required');
      if (!participant) row.errors.push('Sponsored Child ID does not match an existing sponsored child');
      else row.participantId = Number(participant.id);
      row.attendanceRecordId = source.attendanceRecordId ? importParticipantId(source.attendanceRecordId) : null;
      if (source.attendanceRecordId && (!row.attendanceRecordId || row.attendanceRecordId > 4294967295)) row.errors.push('Attendance Record ID must be a positive numeric ID within the database limit');
      if (row.attendanceRecordId && seenAttendanceRecordIds.has(row.attendanceRecordId)) {
        row.errors.push('Duplicate Attendance Record ID in this file');
      }
      if (row.attendanceRecordId) seenAttendanceRecordIds.add(row.attendanceRecordId);
      row.eventName = String(source.eventName || '').trim();
      row.eventDate = normalizeImportDate(source.eventDate);
      row.attendanceStatus = importAttendanceStatus(source.attendanceStatus);
      if (!row.attendanceStatus) row.errors.push('Attendance Status must be Present or Absent');
      row.eventId = source.eventId ? importParticipantId(source.eventId) : null;
      if (source.eventId && (!row.eventId || row.eventId > 4294967295)) row.errors.push('Activity/Event ID must be a positive numeric ID within the database limit');
      row.checkedInAt = source.checkedInAt ? normalizeImportDateTime(source.checkedInAt) : null;
      row.checkedOutAt = source.checkedOutAt ? normalizeImportDateTime(source.checkedOutAt) : null;
      if (source.checkedInAt && !row.checkedInAt) row.errors.push('Check-in Date and Time has an invalid date or time format');
      if (source.checkedOutAt && !row.checkedOutAt) row.errors.push('Check-out Date and Time has an invalid date or time format');
      row.recordedBy = String(source.recordedBy || '').trim();
      row.attendanceRemarks = String(source.attendanceRemarks || '').trim();
      if (row.recordedBy.length > 150) row.errors.push('Recorded By must be 150 characters or fewer');
      const event = row.eventId
        ? eventsById.get(row.eventId)
        : (validImportDate(row.eventDate) && row.eventName
          ? eventsByOccurrence.get(`${row.eventName.toLowerCase()}|${row.eventDate}`)?.[0]
          : null);
      if (row.eventId && !event) row.errors.push('Activity/Event ID cannot be matched to an existing activity');
      if (!row.eventId) {
        if (!row.eventName || !validImportDate(row.eventDate)) {
          row.errors.push('Provide Activity/Event ID, or both Activity Name and a valid Event Date');
        } else {
          const matches = eventsByOccurrence.get(`${row.eventName.toLowerCase()}|${row.eventDate}`) || [];
          if (matches.length !== 1) row.errors.push(matches.length ? 'Activity Name and Event Date match more than one activity' : 'Activity/Event ID cannot be matched to an existing activity');
          else row.event = matches[0];
        }
      }
      row.event = row.event || event;
      if (row.event) {
        const suppliedEventName = String(source.eventName || '').trim();
        if (row.eventId && suppliedEventName
          && suppliedEventName.toLowerCase() !== String(row.event.name).trim().toLowerCase()) {
          row.warnings.push('Activity Name differs from the event matched by Activity/Event ID; the existing event name is used');
        }
        row.eventId = Number(row.event.id);
        row.eventName = row.event.name;
        const eventDate = String(row.event.event_date || '').slice(0, 10);
        if (row.eventDate && row.eventDate !== eventDate) row.errors.push('Event Date does not match the selected activity');
        row.eventDate = eventDate;
        row.eventLocation = row.event.location || null;
        if (String(row.event.status).toLowerCase() === 'cancelled') row.errors.push('Attendance cannot be imported for a cancelled activity');
        const eventStartsAt = row.event.starts_at instanceof Date
          ? row.event.starts_at
          : new Date(String(row.event.starts_at || '').replace(' ', 'T'));
        if (eventDate > new Date().toISOString().slice(0, 10)
          || (!Number.isNaN(eventStartsAt.getTime()) && eventStartsAt > new Date())) {
          row.errors.push('Attendance cannot be imported for a future activity');
        }
        if (row.attendanceStatus === 'Absent' && String(row.event.status).toLowerCase() !== 'completed') {
          row.errors.push('Absent status can only be recorded for a completed activity');
        }
      }
      if (participant && row.event) {
        const participantDetails = participantView(participant);
        const suppliedParticipantName = String(source.participantName || '').trim();
        const rawSuppliedGender = String(source.gender || '').trim().toLowerCase();
        const suppliedGender = ['m', 'male'].includes(rawSuppliedGender) ? 'male'
          : ['f', 'female'].includes(rawSuppliedGender) ? 'female' : rawSuppliedGender;
        const suppliedEducationLevel = String(source.educationLevel || '').trim();
        if (suppliedParticipantName
          && normalizeParticipantName(suppliedParticipantName) !== normalizeParticipantName(participantDetails.fullName || '')) {
          row.warnings.push('Sponsored Child Full Name differs from the existing record; Sponsored Child ID is used');
        }
        if (suppliedGender && suppliedGender !== String(participant.gender || '').toLowerCase()) {
          row.warnings.push('Gender differs from the existing record and is not changed by attendance import');
        }
        if (suppliedEducationLevel
          && suppliedEducationLevel.toLowerCase() !== String(participant.education_level || '').toLowerCase()) {
          row.warnings.push('Education Level differs from the existing record and is not changed by attendance import');
        }
        const registrationDate = importDateOnly(
          participant.sponsorship_registered_at || participant.sponsorship_start_date || participant.created_at,
        );
        if (validImportDate(registrationDate) && row.eventDate < registrationDate) {
          row.errors.push('Event Date is earlier than the Sponsored Child registration date');
        }
        for (const [label, value] of [['Check-in', row.checkedInAt], ['Check-out', row.checkedOutAt]]) {
          if (value) {
            const valueDate = value.slice(0, 10);
            if (validImportDate(registrationDate) && valueDate < registrationDate) {
              row.errors.push(`${label} Date is earlier than the Sponsored Child registration date`);
            }
            if (valueDate !== row.eventDate) row.errors.push(`${label} Date must match the Event Date`);
            if (value > new Date().toISOString().replace('T', ' ').slice(0, 19)) {
              row.errors.push(`${label} Date and Time cannot be in the future`);
            }
          }
        }
        if (row.checkedInAt && row.checkedOutAt && row.checkedOutAt < row.checkedInAt) {
          row.errors.push('Check-out Date and Time cannot be earlier than Check-in Date and Time');
        }
        if (row.attendanceStatus === 'Absent' && (row.checkedInAt || row.checkedOutAt)) {
          row.errors.push('Absent records must not include check-in or check-out timestamps');
        }
      }
      const occurrenceKey = row.eventId ? `event:${row.eventId}` : `${row.eventName.toLowerCase()}|${row.eventDate}`;
      const duplicateKey = `${row.participantId || ''}|${occurrenceKey}`;
      if (seenAttendance.has(duplicateKey)) row.errors.push('Duplicate attendance record in this file');
      seenAttendance.add(duplicateKey);
      if (row.attendanceRecordId && existingAttendanceKeys.has(`record:${row.attendanceRecordId}`)) {
        row.warnings.push('Attendance Record ID already exists');
        row.duplicate = true;
      }
      if (row.event && participant && row.eventDate) {
        const keyById = `${participant.id}|event:${row.eventId}`;
        const keyByName = `${participant.id}|${row.eventName.toLowerCase()}|${row.eventDate}`;
        if (existingAttendanceKeys.has(keyById) || existingAttendanceKeys.has(keyByName)) {
          row.warnings.push('Attendance record already exists');
          row.duplicate = true;
        }
      }
      row.operation = row.errors.length ? 'error' : row.duplicate ? 'review' : 'create';
    }
    normalized.push(row);
  }
  return { errors, normalized };
}

app.post('/api/participants/import/preview', authenticate, checkImportPermission, async (req, res, next) => {
  try {
    await Promise.all([
      participantProfileColumnsReady,
      educationHistoryReady,
      eventsTableReady,
      attendanceImportColumnsReady,
      historicalAttendanceSummaryReady,
    ]);
    const fileName = safeImportFileName(req.body.fileName || 'import.csv');
    const result = await validateParticipantImport(
      req.body.importType, req.body.rows, req.body.headers, req.body.mapping,
    );
    if (result.errors.length) return res.status(400).json({ error: result.errors[0] });
    const rows = result.normalized.map(({ errors, warnings, ...row }) => ({
      ...row,
      errors,
      warnings,
      valid: errors.length === 0,
    }));
    res.json({
      fileName,
      importType: req.body.importType,
      totalRows: rows.length,
      validRows: rows.filter((row) => row.valid).length,
      warningCount: rows.filter((row) => row.warnings.length).length,
      duplicateRows: rows.filter((row) => row.duplicate).length,
      errorCount: rows.filter((row) => !row.valid).length,
      rows,
    });
  } catch (error) { next(error); }
});

app.post('/api/participants/import/commit', authenticate, checkImportPermission, async (req, res, next) => {
  let connection;
  let transactionActive = false;
  let duplicateLockName = null;
  try {
    await Promise.all([
      participantProfileColumnsReady,
      educationHistoryReady,
      participantImportHistoryReady,
      eventsTableReady,
      attendanceImportColumnsReady,
      historicalAttendanceSummaryReady,
      participationTrackingReady,
    ]);
    const fileName = safeImportFileName(req.body.fileName || 'import.csv');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    duplicateLockName = `participant-import-${req.body.importType}`;
    const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [duplicateLockName]);
    if (Number(lock?.acquired) !== 1) {
      duplicateLockName = null;
      return res.status(503).json({ error: 'Import duplicate checks are temporarily unavailable. Please try again.' });
    }

    const validation = await validateParticipantImport(
      req.body.importType, req.body.rows, req.body.headers, req.body.mapping,
    );
    if (validation.errors.length) return res.status(400).json({ error: validation.errors[0] });
    const decisions = req.body.decisions && typeof req.body.decisions === 'object' ? req.body.decisions : {};
    const validRows = validation.normalized.filter((row) => row.errors.length === 0);
    const operationFor = (row) => String(
      decisions[String(row.rowNumber)] || (row.operation === 'review' ? 'skip' : row.operation || 'create'),
    );
    for (const row of validRows) {
      const decision = operationFor(row);
      const allowed = row.duplicate ? ['skip']
        : req.body.importType === 'participants'
          ? row.matchingParticipantId ? ['skip', 'update', 'create'] : ['skip', 'create']
          : ['skip', 'create'];
      if (!allowed.includes(decision)) {
        return res.status(400).json({ error: `Invalid import decision for row ${row.rowNumber}` });
      }
    }
    const invalidCount = validation.normalized.length - validRows.length;
    const participantCredentials = new Map();
    if (req.body.importType === 'participants') {
      const createRows = validRows.filter((row) => operationFor(row) === 'create');
      for (let offset = 0; offset < createRows.length; offset += 4) {
        await Promise.all(createRows.slice(offset, offset + 4).map(async (row) => {
          const passcode = createParticipantPasscode();
          participantCredentials.set(row.rowNumber, {
            passcodeHash: await bcrypt.hash(passcode, 12),
            encryptedPasscode: encrypt(passcode),
          });
        }));
      }
    }

    const counts = {
      participantsImported: 0,
      participantsUpdated: 0,
      attendanceImported: 0,
      attendanceSummariesImported: 0,
      educationImported: 0,
      eventsImported: 0,
      skipped: 0,
      failed: invalidCount,
    };
    const rowResults = new Map();
    const markSkipped = (row, reason) => {
      counts.skipped += 1;
      rowResults.set(row.rowNumber, {
        rowNumber: row.rowNumber,
        result: 'Skipped',
        errors: row.errors,
        warnings: [...row.warnings, ...(reason ? [reason] : [])],
      });
    };

    for (const row of validation.normalized) {
      if (row.errors.length) {
        rowResults.set(row.rowNumber, {
          rowNumber: row.rowNumber, result: 'Failed', errors: row.errors, warnings: row.warnings,
        });
      }
    }
    for (const row of validRows) {
      const operation = operationFor(row);
      if (operation === 'skip') {
        markSkipped(row);
        continue;
      }

      if (req.body.importType === 'participants') {
        if (row.matchingParticipantId && operation === 'update') {
          const name = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ');
          const participationStatus = row.currentStatus;
          const [[existingParticipant]] = await connection.execute(
            `SELECT middle_name_encrypted, participation_status, status
             FROM participants WHERE id = ? LIMIT 1`,
            [row.matchingParticipantId],
          );
          const middleName = row.middleName || decrypt(existingParticipant?.middle_name_encrypted) || '';
          const updatedName = [row.firstName, middleName, row.lastName].filter(Boolean).join(' ');
          const fields = {
            full_name_encrypted: encrypt(updatedName),
            first_name_encrypted: encrypt(row.firstName),
            last_name_encrypted: encrypt(row.lastName),
            date_of_birth_encrypted: encrypt(row.dateOfBirth),
            gender: row.gender,
            sponsorship_registered_at: row.registrationDate,
            status: row.currentStatus === 'INACTIVE' ? 'inactive' : 'active',
            participation_status: participationStatus,
          };
          if (row.middleName) fields.middle_name_encrypted = encrypt(row.middleName);
          if (row.address) fields.address_encrypted = encrypt(row.address);
          if (row.phone) fields.phone_encrypted = encrypt(row.phone);
          if (row.guardianName) fields.emergency_contact_name_encrypted = encrypt(row.guardianName);
          if (row.guardianContact) fields.emergency_contact_phone_encrypted = encrypt(row.guardianContact);
          await connection.execute(
            `UPDATE participants SET ${Object.keys(fields).map((field) => `${field} = ?`).join(', ')},
             updated_at = NOW() WHERE id = ? AND participant_type = 'sponsored_child'`,
            [...Object.values(fields), row.matchingParticipantId],
          );
          const previousStatus = String(existingParticipant?.status || '').toLowerCase() === 'inactive'
            || String(existingParticipant?.participation_status || '').toUpperCase() === 'INACTIVE'
            ? 'INACTIVE'
            : String(existingParticipant?.participation_status || 'ACTIVE').toUpperCase();
          if (previousStatus !== row.currentStatus) {
            await connection.execute(
              `INSERT INTO sponsored_child_participation_history
                 (participant_id, action_type, previous_status, current_status, reason, created_by)
               VALUES (?, 'status_imported', ?, ?, ?, ?)`,
              [
                row.matchingParticipantId, previousStatus, row.currentStatus,
                `Status updated by import of ${fileName}`, req.user.id,
              ],
            );
          }
          counts.participantsUpdated += 1;
          rowResults.set(row.rowNumber, { rowNumber: row.rowNumber, result: 'Updated', errors: [], warnings: row.warnings });
          continue;
        }

        const name = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ');
        const generatedCode = row.participantCode
          || `FMC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const credentials = participantCredentials.get(row.rowNumber);
        if (!credentials) throw new Error(`Sponsored child import credentials were not prepared for row ${row.rowNumber}`);
        const participationStatus = row.currentStatus;
        const [result] = await connection.execute(
          `INSERT INTO participants
             (id, participant_type, full_name_encrypted, first_name_encrypted, middle_name_encrypted,
              last_name_encrypted, date_of_birth_encrypted, gender, phone_encrypted, address_encrypted,
              passcode_hash, passcode_encrypted, emergency_contact_name_encrypted,
              emergency_contact_phone_encrypted, sponsorship_registered_at, status,
              participation_status, participant_code,
              created_at, updated_at)
           VALUES (?, 'sponsored_child', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.participantId || null, encrypt(name), encrypt(row.firstName), encrypt(row.middleName || null),
            encrypt(row.lastName), encrypt(row.dateOfBirth), row.gender,
            encrypt(row.phone || null), encrypt(row.address || null),
            credentials.passcodeHash, credentials.encryptedPasscode,
            encrypt(row.guardianName || null), encrypt(row.guardianContact || null),
            row.registrationDate, row.currentStatus === 'INACTIVE' ? 'inactive' : 'active',
            participationStatus, generatedCode, row.registrationDate, row.registrationDate,
          ],
        );
        const qrUid = encrypt(crypto.randomUUID());
        const qrFile = `qr_${result.insertId}_${Date.now()}.png`;
        await QRCode.toFile(path.join(uploadsDir, qrFile), qrUid);
        await connection.execute(
          `INSERT INTO qr_codes
             (participant_id, qr_uid, qr_code_image, status, assigned_at, created_by, created_at)
           VALUES (?, ?, ?, 'active', NOW(), ?, NOW())`,
          [result.insertId, qrUid, `uploads/qr_codes/${qrFile}`, req.user.id],
        );
        counts.participantsImported += 1;
        rowResults.set(row.rowNumber, { rowNumber: row.rowNumber, result: 'Imported', errors: [], warnings: row.warnings });
      } else if (req.body.importType === 'education') {
        await connection.execute(
          `INSERT INTO participant_education_history
             (id, participant_id, education_level, school_name_encrypted, school_address_encrypted,
              start_year, end_year, status, course_strand_encrypted, notes_encrypted,
              record_fingerprint, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.educationHistoryId || null, row.participantId, row.educationLevel,
            encrypt(row.schoolName), encrypt(row.schoolAddress || null),
            Number(row.startYear), row.endYear === null ? null : Number(row.endYear),
            row.status, null, encrypt(row.notes || null), educationFingerprint(row), req.user.id,
          ],
        );
        counts.educationImported += 1;
        rowResults.set(row.rowNumber, { rowNumber: row.rowNumber, result: 'Imported', errors: [], warnings: row.warnings });
      } else if (req.body.importType === 'attendanceSummary') {
        await connection.execute(
          `INSERT INTO participant_attendance_summaries
             (participant_id, attendance_year, required_count, attended_count, absent_count, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [row.participantId, row.year, row.required, row.attended, row.absent, req.user.id],
        );
        counts.attendanceSummariesImported += 1;
        rowResults.set(row.rowNumber, { rowNumber: row.rowNumber, result: 'Imported', errors: [], warnings: row.warnings });
      } else if (req.body.importType === 'events') {
        await connection.execute(
          `INSERT INTO events
             (id, name, description, starts_at, ends_at, location, status, is_sample, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?)`,
          [
            row.eventId || null, row.eventName, row.eventDescription || null,
            row.eventStart, row.eventEnd || null, row.eventLocation || null,
            row.eventStatus, req.user.id, row.createdDate ? `${row.createdDate} 00:00:00` : new Date(),
          ],
        );
        counts.eventsImported += 1;
        rowResults.set(row.rowNumber, { rowNumber: row.rowNumber, result: 'Imported', errors: [], warnings: row.warnings });
      } else {
        await connection.execute(
          `INSERT INTO check_in_logs
             (id, participant_id, event_id, event_name, checked_in_at, checked_out_at,
              location, status, attendance_status, recorded_by_encrypted, remarks_encrypted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            row.attendanceRecordId || null, row.participantId, row.eventId, row.eventName,
            row.checkedInAt || null, row.checkedOutAt || null, row.eventLocation || null,
            row.attendanceStatus === 'Present' ? 'checked_in' : 'absent',
            row.attendanceStatus.toLowerCase(), encrypt(row.recordedBy || null),
            encrypt(row.attendanceRemarks || null),
          ],
        );
        counts.attendanceImported += 1;
        rowResults.set(row.rowNumber, { rowNumber: row.rowNumber, result: 'Imported', errors: [], warnings: row.warnings });
      }
    }

    const summary = { fileName, importType: req.body.importType, ...counts };
    const details = {
      summary,
      rows: validation.normalized.map((row) => rowResults.get(row.rowNumber) || {
        rowNumber: row.rowNumber, result: 'Skipped', errors: row.errors, warnings: row.warnings,
      }),
    };
    await connection.execute(
      `INSERT INTO participant_import_history
         (file_name, import_type, imported_by, imported_by_name, participants_imported,
          participants_updated, attendance_imported, attendance_summaries_imported,
          education_imported, events_imported, skipped, failed, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fileName, req.body.importType, req.user.id, req.user.username || req.user.role,
        counts.participantsImported, counts.participantsUpdated, counts.attendanceImported,
        counts.attendanceSummariesImported, counts.educationImported, counts.eventsImported,
        counts.skipped, counts.failed, JSON.stringify(details),
      ],
    );
    await writeAuditLog(
      req.user,
      req.body.importType === 'events' ? 'event.data.imported' : 'participant.data.imported',
      req.body.importType === 'events' ? 'event' : 'participant',
      null,
      summary,
      connection,
    );
    await connection.commit();
    transactionActive = false;
    res.json({ success: true, ...summary });
  } catch (error) {
    if (connection && transactionActive) {
      await connection.rollback();
      transactionActive = false;
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An imported record conflicts with an existing record, event, or education record. Review the file and preview again.' });
    }
    next(error);
  } finally {
    try {
      if (connection && transactionActive) await connection.rollback();
    } finally {
      try {
        if (connection && duplicateLockName) {
          await connection.execute('SELECT RELEASE_LOCK(?)', [duplicateLockName]);
        }
      } finally {
        connection?.release();
      }
    }
  }
});

app.get('/api/participants/import/history', authenticate, checkRole([...staffRoles, 'Church Staff']), async (req, res, next) => {
  try {
    await participantImportHistoryReady;
    const canViewAll = ['system administrator', 'church administrator']
      .includes(String(req.user.role || '').toLowerCase());
    const [rows] = await pool.execute(
      `SELECT id, file_name, import_type, imported_by_name, participants_imported,
              participants_updated, attendance_imported, education_imported,
              attendance_summaries_imported, events_imported, skipped, failed, created_at
       FROM participant_import_history
       WHERE (? = 1 OR imported_by = ?)
       ORDER BY created_at DESC, id DESC LIMIT 50`,
      [canViewAll ? 1 : 0, req.user.id],
    );
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/participants/import/history/:id', authenticate, checkRole([...staffRoles, 'Church Staff']), async (req, res, next) => {
  try {
    await participantImportHistoryReady;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Select a valid import history record' });
    const canViewAll = ['system administrator', 'church administrator']
      .includes(String(req.user.role || '').toLowerCase());
    const [[record]] = await pool.execute(
      `SELECT id, file_name, import_type, participants_imported, participants_updated,
              attendance_imported, attendance_summaries_imported, education_imported,
              events_imported, skipped, failed, details_json, created_at
       FROM participant_import_history WHERE id = ? AND (? = 1 OR imported_by = ?) LIMIT 1`,
      [id, canViewAll ? 1 : 0, req.user.id],
    );
    if (!record) return res.status(404).json({ error: 'Import history record not found' });
    let details = record.details_json;
    if (typeof details === 'string') {
      try {
        details = JSON.parse(details);
      } catch (error) {
        return next(error);
      }
    }
    res.json({ ...record, details_json: undefined, ...(details || {}) });
  } catch (error) { next(error); }
});

app.get('/api/participants/:id/history', authenticate, checkPermission('participants:view'), async (req, res, next) => {
  const participantId = Number(req.params.id);
  try {
    const includeCareHistory = canViewParticipantCare(req.user);
    await Promise.all([
      participantProfileColumnsReady,
      educationHistoryReady,
      historicalAttendanceSummaryReady,
      participationTrackingReady,
      sponsorshipTablesReady,
      eventsTableReady,
      ...(includeCareHistory ? [sponsoredChildUpdatesReady] : []),
    ]);
    if (!Number.isSafeInteger(participantId) || participantId < 1) {
      return res.status(400).json({ error: 'Select a valid record' });
    }
    if (!await hasParticipantScope(req.user, participantId)) {
      return res.status(404).json({ error: 'Record not found or not assigned to your group.' });
    }
    let attendancePagination;
    let timelinePagination;
    try {
      attendancePagination = parsePage(req.query, 'page', 'pageSize');
      timelinePagination = parsePage(req.query, 'historyPage', 'historyPageSize');
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const year = /^\d{4}$/.test(String(req.query.year || ''))
      ? Number(req.query.year)
      : null;
    const trendYear = /^\d{4}$/.test(String(req.query.trendYear || ''))
      ? Number(req.query.trendYear)
      : null;
    const month = /^\d{1,2}$/.test(String(req.query.month || ''))
      ? Number(req.query.month)
      : null;
    const event = String(req.query.event || '').trim().slice(0, 100);
    const status = ['attended', 'missed'].includes(String(req.query.status || '').toLowerCase())
      ? String(req.query.status).toLowerCase()
      : '';
    const history = await loadParticipantDetailHistory(participantId, {
      page: attendancePagination.page,
      pageSize: attendancePagination.pageSize,
      historyPage: timelinePagination.page,
      historyPageSize: timelinePagination.pageSize,
      year: year && year >= 1900 && year <= 9999 ? year : null,
      trendYear: trendYear && trendYear >= 1900 && trendYear <= 9999 ? trendYear : null,
      month: month && month >= 1 && month <= 12 ? month : null,
      event,
      status,
      includeCareHistory,
    });
    if (!history) return res.status(404).json({ error: 'Record not found' });
    if (history.participant.participantType === 'sponsored_child' && includeCareHistory) {
      [history.participation] = await getSponsoredParticipationSummaries(participantId, {
        includeAllCsvAttendance: true,
      });
      history.participant.status = history.participation?.status || 'ACTIVE';
    }
    res.json(history);
  } catch (error) {
    console.error('Participant history retrieval failed', {
      participantId,
      code: error.code || 'UNKNOWN',
      message: error.message,
      stack: error.stack,
    });
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Unable to retrieve this child history right now. Please try again.' });
  }
});

app.get(
  '/api/participants/:id/passcode',
  authenticate,
  checkRole(['Church Administrator', 'System Administrator']),
  checkPermission('participants:view'),
  async (req, res, next) => {
    try {
      await participantProfileColumnsReady;
      const [[participant]] = await pool.execute(
        `SELECT participant_type, passcode_encrypted
         FROM participants WHERE id = ? LIMIT 1`,
        [req.params.id],
      );
      if (!participant) return res.status(404).json({ error: 'Sponsored child not found' });
      if (participant.participant_type !== 'sponsored_child') {
        return res.status(400).json({ error: 'Passcodes are only available for sponsored children' });
      }
      const passcode = participant.passcode_encrypted
        ? decrypt(participant.passcode_encrypted)
        : null;
      await writeAuditLog(req.user, 'participant.passcode.viewed', 'participant', req.params.id);
      res.json({ passcode });
    } catch (error) { next(error); }
  },
);

app.post('/api/auth/login', loginRateLimit, async (req, res, next) => {
  try {
    await authSessionsReady;
    await legacyRolesReady;
    await staffPermissionsReady;
    const email = String(req.body.email || '').trim().toLowerCase();
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    if (!user || user.status !== 'active' || !(await bcrypt.compare(req.body.password || '', user.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
    const lastActivityAt = await createAuthSession(user.id, res, req.headers.cookie);
    await pool.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    res.json({ user: accountView(user), lastActivityAt });
  } catch (error) { next(error); }
});

app.get('/api/auth/session', (req, res, next) => {
  const cookieHeader = String(req.headers.cookie || '');
  const hasSessionCookie = cookieHeader.split(';').some(
    (part) => part.trim().startsWith(`${AUTH_SESSION_COOKIE}=`),
  );
  if (!readAuthSessionToken(cookieHeader)) {
    if (hasSessionCookie) clearAuthSessionCookie(res);
    return res.json({ authenticated: false });
  }
  return authenticate(req, res, (error) => {
    if (error) return next(error);
    res.json({
      authenticated: true,
      user: req.authenticatedUser,
      lastActivityAt: req.authSessionLastActivityAt,
    });
  });
});

app.post('/api/auth/refresh', authenticate, (req, res) => {
  res.json({
    user: req.authenticatedUser,
    lastActivityAt: req.authSessionLastActivityAt,
  });
});

app.post('/api/auth/activity', authenticate, async (req, res, next) => {
  try {
    await pool.execute(
      `UPDATE auth_sessions
       SET last_activity_at = NOW(3),
           expires_at = LEAST(
             DATE_ADD(NOW(3), INTERVAL ${AUTH_SESSION_IDLE_SECONDS} SECOND),
             absolute_expires_at
           )
       WHERE token_hash = ?
         AND last_activity_at > DATE_SUB(NOW(3), INTERVAL ${AUTH_SESSION_IDLE_SECONDS} SECOND)
         AND expires_at > NOW(3)
         AND absolute_expires_at > NOW(3)`,
      [req.authSessionHash],
    );
    const [[session]] = await pool.execute(
      `SELECT CAST(UNIX_TIMESTAMP(last_activity_at) * 1000 AS UNSIGNED) AS last_activity_at,
              CEIL(TIMESTAMPDIFF(MICROSECOND, NOW(3), expires_at) / 1000000) AS idle_seconds,
              CEIL(TIMESTAMPDIFF(MICROSECOND, NOW(3), absolute_expires_at) / 1000000) AS absolute_seconds
       FROM auth_sessions
       WHERE token_hash = ?
         AND last_activity_at > DATE_SUB(NOW(3), INTERVAL ${AUTH_SESSION_IDLE_SECONDS} SECOND)
         AND expires_at > NOW(3)
         AND absolute_expires_at > NOW(3)
       LIMIT 1`,
      [req.authSessionHash],
    );
    if (!session) {
      await pool.execute('DELETE FROM auth_sessions WHERE token_hash = ?', [req.authSessionHash]);
      clearAuthSessionCookie(res);
      return res.status(401).json({
        error: 'Session expired due to inactivity',
        code: 'SESSION_INACTIVE',
      });
    }
    res.setHeader('Set-Cookie', serializeAuthSessionCookie(
      readAuthSessionToken(req.headers.cookie),
      {
        secure: authCookieSecure,
        sameSite: authCookieSameSite,
        maxAgeSeconds: Math.min(
          AUTH_SESSION_IDLE_SECONDS,
          Math.max(1, Number(session.idle_seconds) || 1),
          Math.max(1, Number(session.absolute_seconds) || 1),
        ),
      },
    ));
    res.json({ lastActivityAt: Number(session.last_activity_at) });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    await authSessionsReady;
    const token = readAuthSessionToken(req.headers.cookie);
    if (token) {
      await pool.execute('DELETE FROM auth_sessions WHERE token_hash = ?', [
        hashAuthSessionToken(token),
      ]);
    }
    clearAuthSessionCookie(res);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/goers', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    await staffPermissionsReady;
    const [goers] = await pool.execute(
      `SELECT id, username, first_name, middle_name, last_name, email, role, status, access_permissions,
              goer_education_level, created_at, last_login_at
       FROM users WHERE LOWER(role) = 'goer'
       ORDER BY first_name, last_name, email`,
    );
    res.json({
      educationLevels: GOER_EDUCATION_LEVELS,
      goers: goers.map((user) => ({
        ...accountView(user),
        username: user.username,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      })),
    });
  } catch (error) { next(error); }
});

app.post('/api/goers', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    const names = staffNameFields(req.body);
    if (names.error) return res.status(400).json({ error: names.error });
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const educationLevel = String(req.body.educationLevel || '');
    if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ error: 'Password must be between 8 and 72 bytes' });
    }
    if (!GOER_EDUCATION_LEVELS.includes(educationLevel)) {
      return res.status(400).json({ error: 'Select a valid education group' });
    }
    await staffPermissionsReady;
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    if (existing.length) return res.status(409).json({ error: 'Email is already in use' });
    const username = `account-${crypto.randomUUID()}`;
    const [result] = await pool.execute(
      `INSERT INTO users
         (username, first_name, middle_name, last_name, email, password_hash, role, status, access_permissions,
          goer_education_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Goer', 'active', NULL, ?, NOW(), NOW())`,
      [
        username,
        names.firstName,
        names.middleName || null,
        names.lastName,
        email,
        await bcrypt.hash(password, 12),
        educationLevel,
      ],
    );
    await writeAuditLog(req.user, 'goer.created', 'user', result.insertId, {
      fullName: names.fullName,
      educationLevel,
    });
    res.status(201).json({
      goer: {
        id: result.insertId,
        firstName: names.firstName,
        middleName: names.middleName,
        lastName: names.lastName,
        fullName: names.fullName,
        email,
        username,
        role: 'Goer',
        status: 'active',
        permissions: ['checkin:record'],
        goerEducationLevel: educationLevel,
        createdAt: new Date(),
        lastLoginAt: null,
      },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email is already in use' });
    next(error);
  }
});

app.put('/api/goers/:id/group', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    const educationLevel = String(req.body.educationLevel || '');
    if (!GOER_EDUCATION_LEVELS.includes(educationLevel)) {
      return res.status(400).json({ error: 'Select a valid education group' });
    }
    const [accounts] = await pool.execute(
      `SELECT id FROM users WHERE id = ? AND LOWER(role) = 'goer' LIMIT 1`,
      [req.params.id],
    );
    if (!accounts.length) return res.status(404).json({ error: 'Goer account not found' });
    const [result] = await pool.execute(
      `UPDATE users SET goer_education_level = ?, updated_at = NOW()
       WHERE id = ? AND LOWER(role) = 'goer'`,
      [educationLevel, req.params.id],
    );
    if (!result.affectedRows) {
      const [[account]] = await pool.execute(
        `SELECT id FROM users WHERE id = ? AND LOWER(role) = 'goer' LIMIT 1`,
        [req.params.id],
      );
      if (!account) return res.status(404).json({ error: 'Goer account not found' });
    }
    await writeAuditLog(req.user, 'goer.group.updated', 'user', req.params.id, { educationLevel });
    res.json({ educationLevel });
  } catch (error) { next(error); }
});

app.put('/api/goers/:id/status', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    const status = String(req.body.status || '').toLowerCase();
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Status must be active or inactive' });
    }
    const [accounts] = await pool.execute(
      `SELECT id FROM users WHERE id = ? AND LOWER(role) = 'goer' LIMIT 1`,
      [req.params.id],
    );
    if (!accounts.length) return res.status(404).json({ error: 'Goer account not found' });
    const [result] = await pool.execute(
      `UPDATE users SET status = ?, updated_at = NOW()
       WHERE id = ? AND LOWER(role) = 'goer'`,
      [status, req.params.id],
    );
    if (status === 'inactive') {
      await pool.execute('DELETE FROM auth_sessions WHERE user_id = ?', [req.params.id]);
    }
    if (!result.affectedRows) {
      const [[account]] = await pool.execute(
        `SELECT id FROM users WHERE id = ? AND LOWER(role) = 'goer' LIMIT 1`,
        [req.params.id],
      );
      if (!account) return res.status(404).json({ error: 'Goer account not found' });
    }
    await writeAuditLog(req.user, `goer.${status}`, 'user', req.params.id);
    res.json({ status });
  } catch (error) { next(error); }
});

app.get('/api/staff', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    await staffPermissionsReady;
    const [staff] = await pool.execute(
      `SELECT id, username, first_name, middle_name, last_name, email, role, status,
              access_permissions, created_at, last_login_at
       FROM users WHERE LOWER(role) = 'church administrator'
       ORDER BY first_name, last_name, email`,
    );
    res.json({
      staff: staff.map((user) => ({
        ...accountView(user),
        username: user.username,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      })),
    });
  } catch (error) { next(error); }
});

app.post('/api/staff', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    const names = staffNameFields(req.body);
    if (names.error) return res.status(400).json({ error: names.error });
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const permissions = req.body.permissions;
    if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ error: 'Password must be between 8 and 72 bytes' });
    }
    if (!Array.isArray(permissions) || permissions.some((permission) => !STAFF_PERMISSION_KEYS.includes(permission))) {
      return res.status(400).json({ error: 'Select valid staff permissions' });
    }
    await staffPermissionsReady;
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    if (existing.length) return res.status(409).json({ error: 'Email is already in use' });
    const username = `account-${crypto.randomUUID()}`;
    const [result] = await pool.execute(
      `INSERT INTO users
         (username, first_name, middle_name, last_name, email, password_hash, role,
          status, access_permissions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Church Administrator', 'active', ?, NOW(), NOW())`,
      [
        username,
        names.firstName,
        names.middleName || null,
        names.lastName,
        email,
        await bcrypt.hash(password, 12),
        JSON.stringify([...new Set(permissions)]),
      ],
    );
    await writeAuditLog(req.user, 'staff.created', 'user', result.insertId, {
      fullName: names.fullName,
      permissions: [...new Set(permissions)],
    });
    res.status(201).json({
      staff: {
        id: result.insertId,
        firstName: names.firstName,
        middleName: names.middleName,
        lastName: names.lastName,
        fullName: names.fullName,
        email,
        username,
        role: 'Church Administrator',
        status: 'active',
        permissions: [...new Set(permissions)],
        createdAt: new Date(),
      },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email is already in use' });
    next(error);
  }
});

app.put('/api/staff/:id/permissions', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    const permissions = req.body.permissions;
    if (!Array.isArray(permissions) || permissions.some((permission) => !STAFF_PERMISSION_KEYS.includes(permission))) {
      return res.status(400).json({ error: 'Select valid staff permissions' });
    }
    const [accounts] = await pool.execute(
      `SELECT id FROM users WHERE id = ? AND LOWER(role) = 'church administrator' LIMIT 1`,
      [req.params.id],
    );
    if (!accounts.length) return res.status(404).json({ error: 'Staff account not found' });
    await pool.execute(
      `UPDATE users SET access_permissions = ?, updated_at = NOW()
       WHERE id = ? AND LOWER(role) = 'church administrator'`,
      [JSON.stringify([...new Set(permissions)]), req.params.id],
    );
    await writeAuditLog(req.user, 'staff.permissions.updated', 'user', req.params.id, {
      permissions: [...new Set(permissions)],
    });
    res.json({ permissions: [...new Set(permissions)] });
  } catch (error) { next(error); }
});

app.put('/api/staff/:id/status', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    const status = String(req.body.status || '').toLowerCase();
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Status must be active or inactive' });
    }
    if (status === 'inactive' && String(req.user.id) === String(req.params.id)) {
      return res.status(403).json({ error: 'You cannot deactivate the account you are currently using.' });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [accounts] = await connection.execute(
        `SELECT id, status FROM users
         WHERE LOWER(role) = 'church administrator'
         ORDER BY id FOR UPDATE`,
      );
      const account = accounts.find((item) => String(item.id) === String(req.params.id));
      if (!account) {
        await connection.rollback();
        return res.status(404).json({ error: 'Staff account not found' });
      }
      if (account.status === 'active' && status === 'inactive' &&
          accounts.filter((item) => item.status === 'active').length <= 1) {
        await connection.rollback();
        return res.status(409).json({ error: 'At least one active Church Administrator account must remain.' });
      }
      await connection.execute(
        `UPDATE users SET status = ?, updated_at = NOW()
         WHERE id = ? AND LOWER(role) = 'church administrator'`,
        [status, req.params.id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (status === 'inactive') {
      await pool.execute('DELETE FROM auth_sessions WHERE user_id = ?', [req.params.id]);
    }
    await writeAuditLog(req.user, `staff.${status}`, 'user', req.params.id);
    res.json({ status });
  } catch (error) { next(error); }
});

app.get('/api/account', authenticate, checkRole(accountRoles), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, first_name, middle_name, last_name, email, role,
              access_permissions, goer_education_level
       FROM users WHERE id = ? AND status = ? LIMIT 1`,
      [req.user.id, 'active'],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
    res.json({ user: accountView(rows[0]) });
  } catch (error) { next(error); }
});

app.put('/api/account', authenticate, checkRole(accountRoles), async (req, res, next) => {
  try {
    const names = staffNameFields(req.body);
    if (names.error) return res.status(400).json({ error: names.error });
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword && (Buffer.byteLength(newPassword, 'utf8') < 8 || Buffer.byteLength(newPassword, 'utf8') > 72)) {
      return res.status(400).json({ error: 'New password must be between 8 and 72 bytes' });
    }
    if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });

    const [rows] = await pool.execute(
      `SELECT id, username, first_name, middle_name, last_name, email, role,
              password_hash, access_permissions, goer_education_level
       FROM users WHERE id = ? AND status = ? LIMIT 1`,
      [req.user.id, 'active'],
    );
    const account = rows[0];
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!(await bcrypt.compare(currentPassword, account.password_hash))) {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }
    const updates = [];
    const values = [];
    updates.push('first_name = ?', 'middle_name = ?', 'last_name = ?');
    values.push(names.firstName, names.middleName || null, names.lastName);
    if (newPassword) {
      updates.push('password_hash = ?');
      values.push(await bcrypt.hash(newPassword, 12));
    }
    updates.push('updated_at = NOW()');
    values.push(account.id);
    const connection = await pool.getConnection();
    const replacementToken = createAuthSessionToken();
    let replacementLastActivityAt;
    try {
      await connection.beginTransaction();
      await connection.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
      await connection.execute('DELETE FROM auth_sessions WHERE user_id = ?', [account.id]);
      replacementLastActivityAt = await insertAuthSession(connection, account.id, replacementToken);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.setHeader('Set-Cookie', serializeAuthSessionCookie(replacementToken, {
      secure: authCookieSecure,
      sameSite: authCookieSameSite,
      maxAgeSeconds: AUTH_SESSION_IDLE_SECONDS,
    }));
    await writeAuditLog(
      req.user,
      'account.credentials.updated',
      'user',
      account.id,
      { changedFields: ['first_name', 'middle_name', 'last_name', ...(newPassword ? ['password'] : [])] },
    );

    const updatedUser = {
      ...account,
      first_name: names.firstName,
      middle_name: names.middleName || null,
      last_name: names.lastName,
    };
    res.json({ user: accountView(updatedUser), lastActivityAt: replacementLastActivityAt });
  } catch (error) {
    next(error);
  }
});

app.post('/api/account/email/request', authenticate, checkRole(accountRoles), async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const currentPassword = String(req.body.currentPassword || '');
    if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });

    const [rows] = await pool.execute(
      'SELECT id, email, password_hash FROM users WHERE id = ? AND status = ? LIMIT 1',
      [req.user.id, 'active'],
    );
    const account = rows[0];
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!(await bcrypt.compare(currentPassword, account.password_hash))) {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }
    if (email === String(account.email).toLowerCase()) {
      return res.status(400).json({ error: 'That is already your account email' });
    }
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) return res.status(409).json({ error: 'Email address is already in use' });

    const emailProvider = String(
      process.env.EMAIL_PROVIDER || (isProduction ? 'gmail-api' : 'smtp'),
    ).toLowerCase();
    const gmailFrom = process.env.GMAIL_FROM;
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT);
    const smtpFrom = process.env.SMTP_FROM;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    if (emailProvider === 'gmail-api') {
      if (
        !process.env.GMAIL_CLIENT_ID ||
        !process.env.GMAIL_CLIENT_SECRET ||
        !process.env.GMAIL_REFRESH_TOKEN ||
        !gmailFrom
      ) {
        return res.status(503).json({
          error: 'Email verification is not configured. Set the Gmail API OAuth credentials and sender address.',
        });
      }
    } else if (emailProvider === 'smtp') {
      if (!smtpHost || !Number.isInteger(smtpPort) || !smtpFrom || Boolean(smtpUser) !== Boolean(smtpPassword)) {
        return res.status(503).json({ error: 'Email verification is not configured. Set the SMTP environment variables and try again.' });
      }
    } else {
      return res.status(503).json({ error: 'Email verification provider is invalid. Set EMAIL_PROVIDER to gmail-api or smtp.' });
    }

    const previous = emailChallenges.get(Number(account.id));
    if (previous && Date.now() - previous.requestedAt < 60_000) {
      return res.status(429).json({ error: 'Please wait before requesting another verification code' });
    }
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const userId = Number(account.id);
    const challenge = {
      email,
      codeHash: crypto.createHmac('sha256', process.env.JWT_SECRET).update(code).digest('hex'),
      expiresAt: Date.now() + 10 * 60_000,
      requestedAt: Date.now(),
      attempts: 0,
    };
    emailChallenges.set(userId, challenge);
    try {
      const message = {
        to: email,
        subject: 'Verify your FMC Field Care email address',
        text: `Your email verification code is ${code}. It expires in 10 minutes.`,
      };
      if (emailProvider === 'gmail-api') {
        await sendEmailWithGmailApi({
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
          from: gmailFrom,
          ...message,
        });
      } else {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
          ...(smtpUser ? { auth: { user: smtpUser, pass: smtpPassword } } : {}),
        });
        await transporter.sendMail({ from: smtpFrom, ...message });
      }
    } catch (error) {
      emailChallenges.delete(userId);
      console.error('Failed to send account email verification code:', {
        provider: emailProvider,
        message: error.message,
      });
      return res.status(502).json({
        error: emailProvider === 'gmail-api'
          ? 'Could not send the verification email. Check the Gmail API OAuth credentials and sender address.'
          : 'Could not send the verification email. Check the SMTP settings and try again.',
      });
    }
    res.json({ message: 'Verification code sent to the new email address' });
  } catch (error) { next(error); }
});

app.post('/api/account/email/verify', authenticate, checkRole(accountRoles), async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const userId = Number(req.user.id);
    const challenge = emailChallenges.get(userId);
    if (!challenge || challenge.email !== email || challenge.expiresAt <= Date.now()) {
      emailChallenges.delete(userId);
      return res.status(400).json({ error: 'Verification code is invalid or expired. Request a new code.' });
    }
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit verification code' });

    const codeHash = crypto.createHmac('sha256', process.env.JWT_SECRET).update(code).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(codeHash), Buffer.from(challenge.codeHash))) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) emailChallenges.delete(userId);
      return res.status(400).json({
        error: challenge.attempts >= 5
          ? 'Too many incorrect codes. Request a new code.'
          : 'Verification code is incorrect',
      });
    }

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
      [email, userId],
    );
    if (existing.length) {
      emailChallenges.delete(userId);
      return res.status(409).json({ error: 'Email address is already in use' });
    }
    await pool.execute('UPDATE users SET email = ?, updated_at = NOW() WHERE id = ?', [email, userId]);
    await writeAuditLog(req.user, 'account.email.updated', 'user', userId);
    emailChallenges.delete(userId);
    const [rows] = await pool.execute(
      `SELECT id, username, first_name, middle_name, last_name, email, role,
              access_permissions, goer_education_level
       FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    res.json({ user: accountView(rows[0]) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email address is already in use' });
    next(error);
  }
});

app.post('/api/participants', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  const connection = await pool.getConnection();
  let duplicateLockName = null;
  try {
    await participantProfileColumnsReady;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    await connection.beginTransaction();
    const participantType = req.body.participantType || 'sponsored_child';
    if (participantType !== 'sponsored_child') {
      await connection.rollback();
      return res.status(400).json({ error: 'Sponsored Child registration is for sponsored children. Create Church Goer accounts under Manage Accounts.' });
    }
    const validationErrors = participantRegistrationErrors(
      req.body,
      educationLevels,
      gradeLevelsByEducation,
    );
    if (Object.keys(validationErrors).length) {
      await connection.rollback();
      return res.status(400).json({
        error: 'Please correct the highlighted registration fields.',
        errors: validationErrors,
      });
    }
    const firstName = req.body.firstName.trim();
    const middleName = req.body.middleName.trim();
    const lastName = req.body.lastName.trim();
    const guardianName = req.body.emergencyContactName.trim();
    const gender = req.body.gender.trim();
    const address = String(req.body.address || '').trim();
    const schoolAddress = req.body.schoolAddress.trim();
    const schoolName = req.body.schoolName.trim();
    const programCourse = String(req.body.programCourse || '').trim();
    const medicalConditions = String(req.body.medicalConditions || '').trim();
    const weight = String(req.body.weight || '').trim();
    const height = String(req.body.height || '').trim();
    const fullName = [firstName, middleName, lastName]
      .filter(Boolean)
      .join(' ');
    // Serialize checks because encrypted names and dates have no searchable index.
    duplicateLockName = 'participant-registration-duplicates';
    const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [duplicateLockName]);
    if (Number(lock?.acquired) !== 1) {
      duplicateLockName = null;
      await connection.rollback();
      return res.status(503).json({ error: 'Sponsored child duplicate check is temporarily unavailable. Please try again.' });
    }
    const [existingRows] = await connection.execute(
      `SELECT id, participant_code, full_name_encrypted, first_name_encrypted,
              middle_name_encrypted, last_name_encrypted, date_of_birth_encrypted
       FROM participants
       WHERE participant_type = 'sponsored_child' AND COALESCE(status, '') <> 'deleted'`,
    );
    const duplicates = findPotentialParticipantDuplicates(
      {
        fullName,
        firstName,
        lastName,
        dateOfBirth: req.body.dateOfBirth,
      },
      existingRows.map((row) => participantView(row)),
    );
    const exactDuplicates = duplicates.filter((match) => match.exact);
    const potentialDuplicates = duplicates.filter((match) => !match.exact);
    if (exactDuplicates.length || (potentialDuplicates.length && req.body.confirmPotentialDuplicate !== true)) {
      await connection.rollback();
      const blockedByExactMatch = exactDuplicates.length > 0;
      return res.status(409).json({
        code: blockedByExactMatch ? 'DUPLICATE_PARTICIPANT' : 'POTENTIAL_DUPLICATE_REVIEW_REQUIRED',
        error: blockedByExactMatch
          ? 'A sponsored child with the same full name and date of birth is already registered.'
          : 'Possible matching sponsored children were found. Review the records before confirming registration.',
        duplicates,
      });
    }
    const passcode = createParticipantPasscode();
    const participantCode = `FMC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const [result] = await connection.execute(
      `INSERT INTO participants
         (participant_type, full_name_encrypted, first_name_encrypted, middle_name_encrypted,
          last_name_encrypted, date_of_birth_encrypted, gender, phone_encrypted, address_encrypted,
          passcode_hash, passcode_encrypted, medical_conditions_encrypted, weight_encrypted,
          height_encrypted, emergency_contact_name_encrypted, emergency_contact_phone_encrypted,
          enrollment_date, education_level, grade_level, program_course_encrypted,
          school_name_encrypted, school_address_encrypted, status, participant_code,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        participantType, encrypt(fullName), encrypt(firstName), encrypt(middleName || null),
        encrypt(lastName), encrypt(req.body.dateOfBirth), gender, encrypt(req.body.phone),
        encrypt(address), await bcrypt.hash(passcode, 12), encrypt(passcode),
        encrypt(medicalConditions || null), encrypt(weight || null), encrypt(height || null),
        encrypt(guardianName), encrypt(req.body.emergencyContactPhone), req.body.enrollmentDate || null,
        req.body.educationLevel.trim(), req.body.gradeLevel.trim(), encrypt(programCourse || null),
        encrypt(schoolName), encrypt(schoolAddress), 'active', participantCode,
      ],
    );
    const uid = crypto.randomUUID();
    const qrPayload = encrypt(uid);
    const filename = `qr_${result.insertId}_${Date.now()}.png`;
    await QRCode.toFile(path.join(uploadsDir, filename), qrPayload);
    await connection.execute('INSERT INTO qr_codes (participant_id, qr_uid, qr_code_image, status, assigned_at, created_by, created_at) VALUES (?, ?, ?, ?, NOW(), ?, NOW())', [result.insertId, qrPayload, `uploads/qr_codes/${filename}`, 'active', req.user.id]);
    await connection.commit();
    await connection.execute('SELECT RELEASE_LOCK(?)', [duplicateLockName]);
    duplicateLockName = null;
    await writeAuditLog(req.user, 'participant.created', 'participant', result.insertId);
    res.status(201).json({
      id: result.insertId,
      participantCode,
      qrPayload,
      qrCodeImage: `/uploads/qr_codes/${filename}`,
      age: calculateAge(req.body.dateOfBirth),
      ...(passcode ? { passcode } : {}),
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    try {
      if (duplicateLockName) await connection.execute('SELECT RELEASE_LOCK(?)', [duplicateLockName]);
    } finally {
      connection.release();
    }
  }
});

app.put('/api/participants/:id', authenticate, checkPermission('participants:edit'), async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    await Promise.all([participantProfileColumnsReady, educationHistoryReady]);
    const [existingRows] = await pool.execute(
      `SELECT id, gender, participant_type, status, education_level, school_name_encrypted,
              school_address_encrypted, program_course_encrypted, enrollment_date, created_at
       FROM participants WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'Record not found' });
    const previousStatus = String(existingRows[0].status || 'active');
    const requestedStatus = String(req.body.status || previousStatus);
    if (!['active', 'inactive', 'deleted'].includes(requestedStatus)) {
      return res.status(400).json({ error: 'Select a valid record status' });
    }
    if (requestedStatus === 'deleted' && previousStatus !== 'deleted') {
      return res.status(400).json({ error: 'Use the record deactivation action to delete a record' });
    }
    if (requestedStatus !== previousStatus && !hasPermission(req.user, 'participants:delete')) {
      return res.status(403).json({ error: 'Record status changes require delete permission' });
    }
    const participantType = existingRows[0].participant_type;
    if (!['sponsored_child', 'goer'].includes(participantType)) {
      return res.status(400).json({ error: 'Record type cannot be edited' });
    }
    const gender = String(req.body.gender || '').trim();
    if (
      gender &&
      !genderOptions.has(gender) &&
      gender !== String(existingRows[0].gender || '')
    ) {
      return res.status(400).json({ error: 'Select a valid gender option' });
    }
    const nameError = participantNameError(req.body);
    if (nameError) return res.status(400).json({ error: nameError });
    const eligibilityError = sponsoredChildEligibilityError({
      ...req.body,
      participantType,
    });
    if (eligibilityError) return res.status(400).json({ error: eligibilityError });
    const schoolAddress = String(req.body.schoolAddress || '').trim();
    const schoolName = String(req.body.schoolName || '').trim();
    if (schoolName.length > 200) {
      return res.status(400).json({ error: 'School name must be 200 characters or fewer' });
    }
    if (schoolAddress.length > 500) {
      return res.status(400).json({ error: 'School address must be 500 characters or fewer' });
    }
    const hasSponsorshipRegistrationDate = Object.prototype.hasOwnProperty.call(
      req.body,
      'sponsorshipRegistrationDate',
    );
    const registrationDateInput = req.body.sponsorshipRegistrationDate;
    const sponsorshipRegistrationDate = registrationDateInput == null || registrationDateInput === ''
      ? null
      : normalizePhilippineDateOnly(registrationDateInput);
    if (hasSponsorshipRegistrationDate &&
        registrationDateInput !== null &&
        registrationDateInput !== undefined &&
        registrationDateInput !== '' &&
        !sponsorshipRegistrationDate) {
      return res.status(400).json({ error: 'Enter a valid sponsorship registration date' });
    }
    if (
      Object.prototype.hasOwnProperty.call(req.body, 'passcode') &&
      req.body.passcode !== '' &&
      !isValidParticipantPasscode(req.body.passcode)
    ) {
      return res.status(400).json({ error: 'Sponsored Child passcode must be exactly 6 digits' });
    }
    const firstName = String(req.body.firstName).trim();
    const middleName = String(req.body.middleName || '').trim();
    const lastName = String(req.body.lastName).trim();
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
    const fields = {
      participant_type: participantType,
      full_name_encrypted: encrypt(fullName),
      first_name_encrypted: encrypt(firstName),
      middle_name_encrypted: encrypt(middleName || null),
      last_name_encrypted: encrypt(lastName),
      date_of_birth_encrypted: encrypt(req.body.dateOfBirth),
      gender: gender || null,
      phone_encrypted: encrypt(req.body.phone),
      address_encrypted: encrypt(req.body.address),
      medical_conditions_encrypted: encrypt(req.body.medicalConditions),
      weight_encrypted: encrypt(req.body.weight),
      height_encrypted: encrypt(req.body.height),
      guardian_name_encrypted: encrypt(req.body.guardianName),
      parent_contact_encrypted: encrypt(req.body.parentContact),
      emergency_contact_name_encrypted: encrypt(req.body.emergencyContactName),
      emergency_contact_phone_encrypted: encrypt(req.body.emergencyContactPhone),
      enrollment_date: req.body.enrollmentDate || null,
      education_level: participantType === 'sponsored_child' ? req.body.educationLevel : null,
      grade_level: participantType === 'sponsored_child' ? req.body.gradeLevel : null,
      program_course_encrypted: participantType === 'sponsored_child' ? encrypt(req.body.programCourse) : null,
      school_name_encrypted: participantType === 'sponsored_child' ? encrypt(schoolName || null) : null,
      school_address_encrypted: participantType === 'sponsored_child' ? encrypt(schoolAddress || null) : null,
      status: requestedStatus,
    };
    if (hasSponsorshipRegistrationDate) {
      fields.sponsorship_registered_at = sponsorshipRegistrationDate;
    }
    if (isValidParticipantPasscode(req.body.passcode)) {
      fields.passcode_hash = await bcrypt.hash(req.body.passcode, 12);
      fields.passcode_encrypted = encrypt(req.body.passcode);
    }

    const updates = Object.keys(fields).map((field) => `${field} = ?`).join(', ');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    await preservePreviousCurrentSchool(connection, existingRows[0], schoolName, req.user.id);
    const [result] = await connection.execute(
      `UPDATE participants SET ${updates}, updated_at = NOW() WHERE id = ?`,
      [...Object.values(fields), req.params.id],
    );
    if (String(existingRows[0].status || '') !== String(fields.status || '')) {
      await connection.execute(
        `INSERT INTO participant_status_history
           (participant_id, status_type, previous_status, current_status, changed_by, changed_at)
         VALUES (?, 'participant', ?, ?, ?, NOW())`,
        [req.params.id, existingRows[0].status || 'unknown', fields.status || 'active', req.user.id],
      );
    }
    const [rows] = await connection.execute('SELECT * FROM participants WHERE id = ? LIMIT 1', [req.params.id]);
    await connection.commit();
    transactionActive = false;
    await writeAuditLog(req.user, 'participant.updated', 'participant', req.params.id, {
      changedFields: Object.keys(req.body),
    });
    const participant = participantView(rows[0]);
    res.json({ participant });
  } catch (error) {
    if (connection && transactionActive) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

app.delete('/api/participants/:id', authenticate, checkPermission('participants:delete'), async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    await sponsorshipTablesReady;
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const [result] = await connection.execute('UPDATE participants SET status = ?, updated_at = NOW() WHERE id = ?', ['deleted', req.params.id]);
    if (!result.affectedRows) {
      await connection.rollback();
      transactionActive = false;
      return res.status(404).json({ error: 'Record not found' });
    }
    // Revoke any active QR codes for the participant
    await connection.execute("UPDATE qr_codes SET status = 'revoked', revoked_at = NOW() WHERE participant_id = ?", [req.params.id]);
    await writeAuditLog(req.user, 'participant.deleted', 'participant', req.params.id, {
      deletionType: 'soft',
      historyPreserved: true,
    }, connection);
    await connection.commit();
    transactionActive = false;
    res.json({ deleted: true });
  } catch (error) {
    if (connection && transactionActive) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
});

app.post('/api/checkin', authenticate, checkPermission('checkin:record'), async (req, res, next) => {
  let connection;
  try {
    await Promise.all([participantProfileColumnsReady, goerQrRevocationReady]);
    const payload = String(req.body.qrPayload || '');
    try {
      decrypt(payload);
    } catch {
      return res.status(400).json({ error: 'Invalid QR payload' });
    }
    const action = req.body.action || 'check_in';
    if (!['check_in', 'check_out'].includes(action)) {
      return res.status(400).json({ error: 'Select check-in or check-out' });
    }
    const eventName = String(req.body.eventName || 'General event');
    const location = req.body.location || null;
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [qrRows] = await connection.execute(
      `SELECT id, participant_id FROM qr_codes
       WHERE qr_uid = ? AND status = 'active'
       LIMIT 1 FOR UPDATE`,
      [payload],
    );
    if (!qrRows[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Invalid or revoked QR code' });
    }
    const qr = qrRows[0];
    const [participants] = await connection.execute(
      `SELECT id, participant_type, education_level, status
       FROM participants WHERE id = ? FOR UPDATE`,
      [qr.participant_id],
    );
    if (!participants[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Record not found for this QR code' });
    }
    if (!canGoerAccessParticipant(req.user, participants[0])) {
      await connection.rollback();
      return res.status(403).json({ error: 'This Goer account can only record attendance for active sponsored children in its assigned group' });
    }
    const [attendanceRows] = await connection.execute(
      `SELECT id, checked_out_at
       FROM check_in_logs
       WHERE participant_id = ? AND event_name = ? AND DATE(checked_in_at) = CURDATE()
         AND status = 'checked_in'
       ORDER BY checked_in_at DESC, id DESC
       LIMIT 1 FOR UPDATE`,
      [qr.participant_id, eventName],
    );
    const transition = getAttendanceTransition(action, attendanceRows[0] || null);
    if (transition === 'no_active_checkin') {
      await connection.rollback();
      return res.status(409).json({ error: 'No active check-in found for this event today' });
    }
    if (transition === 'duplicate') {
      await connection.execute(
        'UPDATE qr_codes SET last_scanned_at = NOW(), scan_count = scan_count + 1 WHERE id = ?',
        [qr.id],
      );
      await connection.commit();
      return res.json({
        status: 'duplicate',
        ignored: true,
        participantId: qr.participant_id,
        timestamp: new Date().toISOString(),
      });
    }
    let attendanceId;
    if (transition === 'check_out') {
      attendanceId = attendanceRows[0].id;
      const [result] = await connection.execute(
        'UPDATE check_in_logs SET checked_out_at = NOW() WHERE id = ? AND checked_out_at IS NULL',
        [attendanceId],
      );
      if (result.affectedRows !== 1) throw new Error('Attendance check-out could not be recorded');
    } else {
      const [result] = await connection.execute(
        `INSERT INTO check_in_logs
           (participant_id, qr_code_id, event_name, checked_in_at, location, status, created_at)
         VALUES (?, ?, ?, NOW(), ?, 'checked_in', NOW())`,
        [qr.participant_id, qr.id, eventName, location],
      );
      attendanceId = result.insertId;
    }
    await connection.execute(
      'UPDATE qr_codes SET last_scanned_at = NOW(), scan_count = scan_count + 1 WHERE id = ?',
      [qr.id],
    );
    await connection.commit();
    await writeAuditLog(
      req.user,
      transition === 'check_out' ? 'checkout.recorded' : 'checkin.recorded',
      'participant',
      qr.participant_id,
      { eventName, attendanceId },
    );
    res.json({
      status: transition === 'check_out' ? 'checked_out' : 'checked_in',
      participantId: qr.participant_id,
      attendanceId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/portal/profile', authenticate, checkPermission('portal:view'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute("SELECT p.* FROM participants p JOIN qr_codes q ON q.participant_id = p.id WHERE q.qr_uid = ? AND q.status = 'active' LIMIT 1", [req.body.qrPayload]);
    const participant = rows[0];
    if (!participant) return res.status(404).json({ error: 'Invalid or revoked QR code' });
    if (participant.participant_type === 'sponsored_child' && (!participant.passcode_hash || !(await bcrypt.compare(req.body.passcode || '', participant.passcode_hash)))) {
      return res.status(403).json({ error: 'Sponsored Child passcode required', requiresPasscode: true });
    }
    const [attendance] = await pool.execute("SELECT event_name, location, checked_in_at, checked_out_at, status FROM check_in_logs WHERE participant_id = ? ORDER BY checked_in_at DESC LIMIT 20", [participant.id]);
    res.json({ participant: participantView(participant), attendance });
  } catch (error) { next(error); }
});

const receiptMimeTypes = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const receiptMaxBytes = 4 * 1024 * 1024;
const eventPhotoMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const eventPhotoMaxBytes = 4 * 1024 * 1024;
const eventPhotosMaxCount = 5;
const eventPhotosMaxTotalBytes = 15 * 1024 * 1024;

function validDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function parseReceipt(value) {
  if (!value) return { data: null, mime: null };
  const match = /^data:(image\/(?:jpeg|png)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value));
  if (!match || !receiptMimeTypes.has(match[1])) {
    return { error: 'Upload a JPG, PNG, or PDF receipt' };
  }
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > receiptMaxBytes || data.toString('base64') !== match[2]) {
    return { error: 'Receipt must be a valid file no larger than 4 MB' };
  }
  const hasSignature = match[1] === 'image/jpeg'
    ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : match[1] === 'image/png'
      ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : data.subarray(0, 5).toString('ascii') === '%PDF-';
  if (!hasSignature) return { error: 'The selected file does not match its JPG, PNG, or PDF type' };
  return { data, mime: match[1] };
}

function parseEventPhotos(value) {
  if (value === undefined) return { photos: [] };
  if (!Array.isArray(value) || value.length > eventPhotosMaxCount) {
    return { error: `Upload no more than ${eventPhotosMaxCount} event photos at a time` };
  }
  let totalBytes = 0;
  const photos = [];
  for (const photo of value) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(photo?.data || ''));
    if (!match || !eventPhotoMimeTypes.has(match[1])) {
      return { error: 'Event photos must be JPG, PNG, or WebP images' };
    }
    const data = Buffer.from(match[2], 'base64');
    if (!data.length || data.length > eventPhotoMaxBytes || data.toString('base64') !== match[2]) {
      return { error: 'Each event photo must be no larger than 4 MB' };
    }
    const hasSignature = match[1] === 'image/jpeg'
      ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
      : match[1] === 'image/png'
        ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : data.subarray(0, 4).toString('ascii') === 'RIFF' &&
          data.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!hasSignature) return { error: 'An event photo does not match its JPG, PNG, or WebP type' };
    totalBytes += data.length;
    if (totalBytes > eventPhotosMaxTotalBytes) {
      return { error: 'Event photos must total no more than 15 MB' };
    }
    const fileName = String(photo.fileName || 'event-photo').replace(/[^\w.-]/g, '_').slice(0, 255);
    photos.push({ data, mime: match[1], fileName });
  }
  return { photos };
}

async function verifyPublicSponsoredChild(qrPayload, passcode) {
  if (!isValidParticipantPasscode(passcode)) {
    return { error: 'Passcode must be exactly 6 digits', status: 400 };
  }
  await participantProfileColumnsReady;
  const lookupKey = crypto.createHmac('sha256', process.env.JWT_SECRET).update(qrPayload).digest('hex');
  await sponsorLookupAttemptsReady;
  const [rows] = await pool.execute(
    `SELECT p.id, p.full_name_encrypted, p.date_of_birth_encrypted, p.gender,
            p.participant_code, p.education_level, p.grade_level, p.school_name_encrypted,
            p.status, p.passcode_hash
     FROM participants p
     JOIN qr_codes q ON q.participant_id = p.id
     WHERE q.qr_uid = ? AND q.status = 'active' AND p.participant_type = 'sponsored_child'
     LIMIT 1`,
    [qrPayload],
  );
  const child = rows[0];
  if (!child || child.status === 'deleted') {
    return { error: 'QR code or passcode is incorrect', status: 403 };
  }
  const [[attemptRecord]] = await pool.execute(
    'SELECT locked_until IS NOT NULL AND locked_until > NOW() AS is_locked FROM public_sponsor_lookup_attempts WHERE qr_key = ? LIMIT 1',
    [lookupKey],
  );
  if (attemptRecord?.is_locked) {
    return { error: 'Too many attempts. Please wait 15 minutes before trying again.', status: 429 };
  }
  if (!child.passcode_hash || !(await bcrypt.compare(passcode, child.passcode_hash))) {
    await pool.execute(
      `INSERT INTO public_sponsor_lookup_attempts (qr_key, attempts, window_started_at, locked_until)
       VALUES (?, 1, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         locked_until = CASE
           WHEN window_started_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE) THEN NULL
           WHEN attempts >= 4 THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE)
           ELSE locked_until
         END,
         attempts = CASE
           WHEN window_started_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE) THEN 1
           ELSE attempts + 1
         END,
         window_started_at = CASE
           WHEN window_started_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE) THEN NOW()
           ELSE window_started_at
         END`,
      [lookupKey],
    );
    return { error: 'QR code or passcode is incorrect', status: 403 };
  }
  await pool.execute('DELETE FROM public_sponsor_lookup_attempts WHERE qr_key = ?', [lookupKey]);
  return { child };
}

async function getAccessibleSponsorshipChild(user, participantId) {
  const [[child]] = await pool.execute(
    `SELECT id, participant_type, education_level, emergency_contact_phone_encrypted, status
     FROM participants
     WHERE id = ? AND participant_type = 'sponsored_child' AND status <> 'deleted'
     LIMIT 1`,
    [participantId],
  );
  if (!child || !canGoerAccessParticipant(user, child)) return null;
  return child;
}

const retiredSponsorshipFeature = (_req, res) =>
  res.status(410).json({ error: 'This sponsorship feature is no longer available' });
app.use('/api/sponsorship/sponsors', retiredSponsorshipFeature);
app.use('/api/sponsorship/letters', retiredSponsorshipFeature);
app.use('/api/sponsorship/disbursements', retiredSponsorshipFeature);
app.use('/api/sponsorship/children/:id/sponsor-assignment', retiredSponsorshipFeature);
app.use('/api/sponsorship/children/:id/allowance-transactions', retiredSponsorshipFeature);
app.use('/api/sponsorship/children/:id/disbursements', retiredSponsorshipFeature);
app.use('/api/sponsorship/children/:id/gifts', retiredSponsorshipFeature);
app.use('/api/sponsorship/children/:id/letters', retiredSponsorshipFeature);
app.put('/api/sponsorship/children/:id', retiredSponsorshipFeature);

async function getSponsoredParticipationSummaries(participantId = null, options = {}) {
  await Promise.all([
    participantProfileColumnsReady, eventsTableReady, attendanceImportColumnsReady, participationTrackingReady,
  ]);
  const childFilter = participantId ? 'AND p.id = ?' : '';
  const educationFilter = options.educationLevel ? 'AND p.education_level = ?' : '';
  const activeFilter = options.activeOnly
    ? `AND p.status = 'active'
       AND p.participation_status <> 'INACTIVE'`
    : '';
  const childParams = [
    ...(participantId ? [participantId] : []),
    ...(options.educationLevel ? [options.educationLevel] : []),
  ];
  const [participants] = await pool.execute(
    `SELECT p.id, p.participant_code, p.full_name_encrypted, p.date_of_birth_encrypted,
            p.gender, p.created_at,
            COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at) AS participation_start_date,
            p.education_level, p.grade_level, p.participation_status,
            p.status AS participant_status
     FROM participants p
     WHERE p.participant_type = 'sponsored_child'
       AND p.status <> 'deleted' ${childFilter} ${educationFilter} ${activeFilter}
     ORDER BY p.created_at DESC, p.id DESC`,
    childParams,
  );
  if (!participants.length) return [];

  const participantIds = participants.map((row) => row.id);
  const placeholders = participantIds.map(() => '?').join(', ');
  const eventSampleFilter = options.includeAllCsvAttendance
    ? `(is_sample = FALSE OR description = 'Synthetic monthly attendance record.')`
    : `(is_sample = FALSE OR starts_at >= '2013-01-01')`;
  const [events] = await pool.query(
    `SELECT id, name, starts_at, location FROM events
     WHERE ${eventSampleFilter}
       AND status = 'completed' AND starts_at < NOW()
     ORDER BY starts_at ASC, id ASC`,
  );
  const [checkIns] = await pool.execute(
    `SELECT c.participant_id, c.event_name, c.location, c.checked_in_at,
            DATE_FORMAT(e.starts_at, '%Y-%m-%d') AS event_date,
            c.attendance_status
     FROM check_in_logs c
     LEFT JOIN events e ON e.id = c.event_id
     WHERE c.participant_id IN (${placeholders})
       AND ((c.status = 'checked_in' AND c.checked_in_at IS NOT NULL)
         OR (c.attendance_status = 'present' AND c.event_id IS NOT NULL))
     ORDER BY COALESCE(c.checked_in_at, e.starts_at), c.id`,
    participantIds,
  );
  const [actions] = await pool.execute(
    `SELECT h.id, h.participant_id, h.action_type, h.evaluation_year, h.previous_status,
            h.current_status, h.reason, h.notes, h.absence_count, h.created_by, h.created_at,
            u.username AS administrator_username,
            CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name) AS administrator_name
     FROM sponsored_child_participation_history h
     LEFT JOIN users u ON u.id = h.created_by
     WHERE h.participant_id IN (${placeholders})
     ORDER BY h.created_at ASC, h.id ASC`,
    participantIds,
  );
  const eventRows = events.map((event) => ({
    id: event.id,
    name: event.name,
    date: event.starts_at,
    location: event.location,
  }));
  const checkInsByChild = new Map();
  for (const row of checkIns) {
    const childRows = checkInsByChild.get(Number(row.participant_id)) || [];
    childRows.push({
      eventName: row.event_name,
      location: row.location,
      checkedInAt: row.checked_in_at,
      eventDate: row.event_date,
      attendanceStatus: row.attendance_status,
    });
    checkInsByChild.set(Number(row.participant_id), childRows);
  }
  const actionsByChild = new Map();
  for (const row of actions) {
    const childRows = actionsByChild.get(Number(row.participant_id)) || [];
    childRows.push({
      id: row.id,
      type: row.action_type,
      evaluationYear: row.evaluation_year === null ? null : Number(row.evaluation_year),
      previousStatus: row.previous_status,
      currentStatus: row.current_status,
      reason: row.reason || '',
      notes: row.notes || '',
      absenceCount: Number(row.absence_count) || 0,
      administrator: row.administrator_name || row.administrator_username || 'System',
      createdAt: row.created_at,
    });
    actionsByChild.set(Number(row.participant_id), childRows);
  }

  return Promise.all(participants.map(async (row) => {
    const tracking = summarizeParticipation({
      registrationDate: row.participation_start_date,
      events: eventRows,
      checkIns: checkInsByChild.get(Number(row.id)) || [],
    });
    const childActions = actionsByChild.get(Number(row.id)) || [];
    if (
      tracking.currentYear.absent >= GROUNDS_FOR_DEPARTURE_ABSENCES
      && !childActions.some((action) =>
        action.type === 'grounds_for_departure' &&
        action.evaluationYear === tracking.currentYear.year)
      && options.recordThresholdHistory !== false
    ) {
      const [result] = await pool.execute(
        `INSERT IGNORE INTO sponsored_child_participation_history
         (participant_id, action_type, evaluation_year, previous_status, current_status, reason, absence_count)
         VALUES (?, 'grounds_for_departure', ?, 'WARNING', 'GROUNDS_FOR_DEPARTURE',
                 'Six or more absences in the current calendar year', ?)`,
        [row.id, tracking.currentYear.year, tracking.currentYear.absent],
      );
      if (result.affectedRows === 1) {
        childActions.push({
          id: result.insertId,
          type: 'grounds_for_departure',
          evaluationYear: tracking.currentYear.year,
          previousStatus: 'WARNING',
          currentStatus: 'GROUNDS_FOR_DEPARTURE',
          reason: 'Six or more absences in the current calendar year',
          absenceCount: tracking.currentYear.absent,
          administrator: 'System',
          createdAt: new Date(),
        });
      }
    }
    const secondChance = childActions.slice().reverse().find((action) => action.type === 'second_chance') || null;
    const secondChanceIsCurrentYear = secondChance
      && secondChance.evaluationYear === tracking.currentYear.year;
    const inactiveAction = childActions.slice().reverse().find((action) => action.type === 'set_inactive') || null;
    const removed = String(row.participant_status || '').toLowerCase() === 'inactive'
      || row.participation_status === 'INACTIVE';
    const postSecondChanceAbsences = secondChanceIsCurrentYear
      ? Math.max(0, tracking.currentYear.absent - secondChance.absenceCount)
      : 0;
    const currentStatus = getParticipationStatus({
      currentYearAbsences: tracking.currentYear.absent,
      secondChanceAbsenceCount: secondChanceIsCurrentYear ? secondChance.absenceCount : null,
      removed,
    });
    return {
      id: row.id,
      name: decrypt(row.full_name_encrypted) || 'Unnamed child',
      participantCode: row.participant_code,
      age: calculateAge(decrypt(row.date_of_birth_encrypted)),
      gender: row.gender || '',
      registrationDate: row.participation_start_date,
      educationLevel: row.education_level || '',
      gradeLevel: row.grade_level || '',
      status: currentStatus,
      monthly: tracking.currentMonth,
      lifetime: tracking.lifetime,
      currentYear: tracking.currentYear,
      years: tracking.years,
      months: tracking.months,
      secondChance,
      postSecondChanceAbsences,
      removalEligible: isRemovalEligible({
        secondChanceGranted: Boolean(secondChance),
        postSecondChanceAbsences,
        removed,
      }),
      inactiveReason: inactiveAction?.reason || '',
      inactiveNotes: inactiveAction?.notes || '',
      inactiveAt: inactiveAction?.createdAt || null,
      inactiveAdministrator: inactiveAction?.administrator || '',
      history: childActions,
    };
  }));
}

app.get('/api/sponsorship/children', authenticate, checkSponsorshipChildrenView, async (req, res, next) => {
  try {
    const isGoer = isGoerRole(req.user.role);
    const children = await getSponsoredParticipationSummaries(null, isGoer
      ? { educationLevel: req.user.goerEducationLevel, activeOnly: true }
      : {});
    res.json(children);
  } catch (error) { next(error); }
});

app.get('/api/sponsorship/children/:id/history', authenticate, checkSponsorshipView, async (req, res, next) => {
  try {
    const participantId = Number(req.params.id);
    if (!Number.isSafeInteger(participantId) || participantId < 1) {
      return res.status(400).json({ error: 'Select a valid sponsored child' });
    }
    const isGoer = isGoerRole(req.user.role);
    const [child] = await getSponsoredParticipationSummaries(participantId, isGoer
      ? { educationLevel: req.user.goerEducationLevel, activeOnly: true }
      : {});
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    await educationHistoryReady;
    const [educationRows] = await pool.execute(
      `SELECT id, education_level, school_name_encrypted, school_address_encrypted,
              start_year, end_year, status, course_strand_encrypted, notes_encrypted
       FROM participant_education_history
       WHERE participant_id = ? ORDER BY start_year DESC, id DESC`,
      [participantId],
    );
    res.json({ ...child, educationHistory: educationRows.map(educationHistoryView) });
  } catch (error) { next(error); }
});

app.post('/api/sponsorship/children/:id/second-chance', authenticate, checkRole(staffRoles), checkPermission('sponsorship:manage'), async (req, res, next) => {
  let connection;
  try {
    const participantId = Number(req.params.id);
    if (!Number.isSafeInteger(participantId) || participantId < 1) {
      return res.status(400).json({ error: 'Select a valid sponsored child' });
    }
    const [child] = await getSponsoredParticipationSummaries(participantId);
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    if (child.status !== 'GROUNDS_FOR_DEPARTURE') {
      return res.status(409).json({ error: 'A second chance is available only after six or more absences in the current calendar year' });
    }
    const reason = String(req.body.reason || '').trim().slice(0, 1000);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.execute(
      `SELECT id FROM sponsored_child_participation_history
       WHERE participant_id = ? AND (
         action_type = 'removed'
         OR (action_type = 'second_chance' AND (evaluation_year = ? OR evaluation_year IS NULL))
       )
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [participantId, child.currentYear.year],
    );
    if (existing[0]) {
      await connection.rollback();
      return res.status(409).json({ error: 'This child already has a second-chance or removal record' });
    }
    await connection.execute(
      `UPDATE participants SET participation_status = 'ACTIVE'
       WHERE id = ? AND participant_type = 'sponsored_child' AND status <> 'deleted'`,
      [participantId],
    );
    await connection.execute(
      `INSERT INTO sponsored_child_participation_history
       (participant_id, action_type, evaluation_year, previous_status, current_status, reason, absence_count, created_by)
       VALUES (?, 'second_chance', ?, 'GROUNDS_FOR_DEPARTURE', 'ACTIVE', ?, ?, ?)`,
      [participantId, child.currentYear.year, reason || null, child.currentYear.absent, req.user.id],
    );
    await connection.commit();
    await writeAuditLog(req.user, 'sponsorship.second_chance.granted', 'participant', participantId, {
      previousStatus: 'GROUNDS_FOR_DEPARTURE',
      newStatus: 'ACTIVE',
      evaluationYear: child.currentYear.year,
      absenceCount: child.currentYear.absent,
      reason: reason || null,
    });
    const [updatedChild] = await getSponsoredParticipationSummaries(participantId, {
      recordThresholdHistory: false,
    });
    res.json({ ...updatedChild, status: 'ACTIVE' });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

const INACTIVE_REASONS = new Set([
  "Graduated",
  "Left",
  "Removed",
  "Deceased",
]);

app.post('/api/sponsorship/children/:id/set-inactive', authenticate, checkRole(staffRoles), checkPermission('sponsorship:manage'), async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    const participantId = Number(req.params.id);
    if (!Number.isSafeInteger(participantId) || participantId < 1) {
      return res.status(400).json({ error: 'Select a valid sponsored child' });
    }
    const reason = String(req.body.reason || '').trim();
    if (!INACTIVE_REASONS.has(reason)) {
      return res.status(400).json({ error: 'Select a valid inactive reason' });
    }
    const notes = String(req.body.notes || '').trim();
    if (notes.length > 2000) {
      return res.status(400).json({ error: 'Notes must be 2000 characters or fewer' });
    }

    await participationTrackingReady;
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const [[participant]] = await connection.execute(
      `SELECT id, status, participant_type
       FROM participants WHERE id = ? FOR UPDATE`,
      [participantId],
    );
    if (!participant || participant.participant_type !== 'sponsored_child' || participant.status === 'deleted') {
      await connection.rollback();
      transactionActive = false;
      return res.status(404).json({ error: 'Sponsored child not found' });
    }
    if (String(participant.status).toLowerCase() === 'inactive') {
      await connection.rollback();
      transactionActive = false;
      return res.status(409).json({ error: 'This sponsored child is already inactive' });
    }

    const [child] = await getSponsoredParticipationSummaries(participantId, { recordThresholdHistory: false });
    if (!child || child.status !== 'GROUNDS_FOR_DEPARTURE') {
      await connection.rollback();
      transactionActive = false;
      return res.status(409).json({ error: 'Only sponsored children at Ground for Departure can be set to inactive' });
    }
    await connection.execute(
      `INSERT IGNORE INTO sponsored_child_participation_history
       (participant_id, action_type, evaluation_year, previous_status, current_status, reason, absence_count)
       VALUES (?, 'grounds_for_departure', ?, 'WARNING', 'GROUNDS_FOR_DEPARTURE',
               'Six or more absences in the current calendar year', ?)`,
      [participantId, child.currentYear.year, child.currentYear.absent],
    );
    const [existingInactiveAction] = await connection.execute(
      `SELECT id FROM sponsored_child_participation_history
       WHERE participant_id = ? AND action_type = 'set_inactive'
       LIMIT 1 FOR UPDATE`,
      [participantId],
    );
    if (existingInactiveAction.length) {
      await connection.rollback();
      transactionActive = false;
      return res.status(409).json({ error: 'This sponsored child already has an inactive decision' });
    }
    const [updated] = await connection.execute(
      `UPDATE participants SET status = 'inactive', participation_status = 'INACTIVE'
       WHERE id = ? AND participant_type = 'sponsored_child' AND status = 'active'`,
      [participantId],
    );
    if (updated.affectedRows !== 1) {
      await connection.rollback();
      transactionActive = false;
      return res.status(409).json({ error: 'The sponsored child status changed before the decision could be saved' });
    }
    await connection.execute(
      `INSERT INTO sponsored_child_participation_history
       (participant_id, action_type, evaluation_year, previous_status, current_status, reason, notes, absence_count, created_by)
       VALUES (?, 'set_inactive', ?, 'GROUNDS_FOR_DEPARTURE', 'INACTIVE', ?, ?, ?, ?)`,
      [participantId, child.currentYear.year, reason, notes || null, child.currentYear.absent, req.user.id],
    );
    await writeAuditLog(req.user, 'sponsorship.child.set_inactive', 'participant', participantId, {
      previousStatus: 'GROUNDS_FOR_DEPARTURE',
      newStatus: 'INACTIVE',
      reason,
      notes: notes || null,
      evaluationYear: child.currentYear.year,
      totalAbsences: child.currentYear.absent,
      attendanceRate: child.currentYear.attendanceRate,
    }, connection);
    await connection.commit();
    transactionActive = false;
    const [updatedChild] = await getSponsoredParticipationSummaries(participantId, { recordThresholdHistory: false });
    res.json(updatedChild);
  } catch (error) {
    if (connection && transactionActive) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/sponsorship/children/:id/remove', authenticate, checkRole(['Church Administrator']), checkPermission('sponsorship:manage'), async (req, res, next) => {
  return res.status(410).json({ error: 'Use the authorized Inactive status action. Second Chance is not a separate status.' });
});

app.get('/api/sponsorship/children/:id/updates', authenticate, checkSponsorshipView, async (req, res, next) => {
  try {
    await sponsoredChildUpdatesReady;
    const child = await getAccessibleSponsorshipChild(req.user, req.params.id);
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    const [rows] = await pool.execute(
      `SELECT id, update_type, recorded_on, activity_encrypted, height_encrypted,
              weight_encrypted, note_encrypted, created_at
       FROM sponsored_child_updates
       WHERE participant_id = ?
       ORDER BY recorded_on DESC, id DESC
       LIMIT 100`,
      [child.id],
    );
    res.json(rows.map((row) => ({
      id: row.id,
      type: row.update_type,
      recordedOn: row.recorded_on instanceof Date
        ? row.recorded_on.toISOString().slice(0, 10)
        : String(row.recorded_on).slice(0, 10),
      activity: decrypt(row.activity_encrypted),
      heightCm: decrypt(row.height_encrypted),
      weightKg: decrypt(row.weight_encrypted),
      note: decrypt(row.note_encrypted),
      createdAt: row.created_at,
    })));
  } catch (error) { next(error); }
});

app.post('/api/sponsorship/children/:id/updates', authenticate, checkSponsorshipRecord, async (req, res, next) => {
  try {
    await sponsoredChildUpdatesReady;
    const type = String(req.body.type || '');
    const recordedOn = String(req.body.recordedOn || '');
    const activity = String(req.body.activity || '').trim();
    const note = String(req.body.note || '').trim();
    if (!['growth', 'activity', 'note'].includes(type)) {
      return res.status(400).json({ error: 'Select a valid child update type' });
    }
    if (!validDate(recordedOn) || recordedOn > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'Enter a valid update date that is not in the future' });
    }
    if (activity.length > 120) return res.status(400).json({ error: 'Activity name must be 120 characters or fewer' });
    if (note.length > 2000) return res.status(400).json({ error: 'Update notes must be 2,000 characters or fewer' });
    let height = null;
    let weight = null;
    if (type === 'growth') {
      height = req.body.heightCm === '' || req.body.heightCm === null || req.body.heightCm === undefined
        ? null
        : Number(req.body.heightCm);
      weight = req.body.weightKg === '' || req.body.weightKg === null || req.body.weightKg === undefined
        ? null
        : Number(req.body.weightKg);
      if (height === null && weight === null) {
        return res.status(400).json({ error: 'Enter a height, weight, or both for a growth update' });
      }
      if (height !== null && (!Number.isFinite(height) || height < 30 || height > 260)) {
        return res.status(400).json({ error: 'Height must be between 30 and 260 cm' });
      }
      if (weight !== null && (!Number.isFinite(weight) || weight < 1 || weight > 300)) {
        return res.status(400).json({ error: 'Weight must be between 1 and 300 kg' });
      }
    }
    if (type === 'activity' && !activity) {
      return res.status(400).json({ error: 'Enter an activity name' });
    }
    if (type === 'note' && !note) {
      return res.status(400).json({ error: 'Enter a note for this update' });
    }
    const child = await getAccessibleSponsorshipChild(req.user, req.params.id);
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    const [result] = await pool.execute(
      `INSERT INTO sponsored_child_updates
         (participant_id, update_type, recorded_on, activity_encrypted, height_encrypted,
          weight_encrypted, note_encrypted, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        child.id,
        type,
        recordedOn,
        encrypt(activity || null),
        encrypt(height === null ? null : height.toFixed(1)),
        encrypt(weight === null ? null : weight.toFixed(1)),
        encrypt(note || null),
        req.user.id,
      ],
    );
    await writeAuditLog(req.user, 'sponsorship.child.update.created', 'participant', child.id, {
      updateId: result.insertId,
      updateType: type,
      recordedOn,
    });
    res.status(201).json({ id: result.insertId, type, recordedOn });
  } catch (error) { next(error); }
});

app.post('/api/sponsorship/children/:id/gifts', authenticate, checkPermission('sponsorship:manage'), async (req, res, next) => {
  try {
    const giftFrom = String(req.body?.giftsFrom || '').trim();
    const amountCents = parsePositiveAmountCents(req.body?.amount);
    const description = String(req.body?.description || '').trim();
    if (!giftFrom || giftFrom.length > 100) {
      return res.status(400).json({ error: 'Enter who the gift is from (100 characters or fewer)' });
    }
    if (amountCents === null) {
      return res.status(400).json({ error: 'Enter a positive gift amount up to 1,000,000.00 with no more than two decimal places' });
    }
    if (description.length > 255) {
      return res.status(400).json({ error: 'Description must be 255 characters or fewer' });
    }
    await sponsorshipTablesReady;
    const child = await getAccessibleSponsorshipChild(req.user, req.params.id);
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    const amount = (amountCents / 100).toFixed(2);
    const [result] = await pool.execute(
      `INSERT INTO sponsored_child_care_records
         (participant_id, care_type, amount, recorded_on, description, gift_from_encrypted, receipt_mime, receipt_data, created_by)
       VALUES (?, 'gift', ?, CURDATE(), ?, ?, NULL, NULL, ?)`,
      [child.id, amount, description || null, encrypt(giftFrom), req.user.id],
    );
    await writeAuditLog(req.user, 'sponsorship.gift.recorded', 'participant', child.id, {
      giftRecordId: result.insertId,
      amount,
      giftsFrom: giftFrom,
      hasDescription: Boolean(description),
    });
    res.status(201).json({
      id: `received-${result.insertId}`,
      amount: Number(amount),
      giftsFrom: giftFrom,
      description: description || null,
    });
  } catch (error) { next(error); }
});

app.post('/api/sponsorship/children/:id/care-records', authenticate, checkSponsorshipRecord, async (req, res, next) => {
  try {
    const careType = String(req.body.careType || '');
    const amount = Number(req.body.amount);
    const recordedOn = String(req.body.recordedOn || '');
    const description = String(req.body.description || '').trim();
    const receipt = parseReceipt(req.body.receiptData);
    if (careType !== 'gift') {
      return res.status(400).json({ error: 'Only received gifts can be recorded' });
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ error: 'Enter an amount above 0 and no more than 1,000,000' });
    }
    if (!validDate(recordedOn)) return res.status(400).json({ error: 'Enter a valid record date' });
    if (description.length > 255) return res.status(400).json({ error: 'Description must be 255 characters or fewer' });
    if (receipt.error) return res.status(400).json({ error: receipt.error });
    if (!receipt.data) return res.status(400).json({ error: 'Receipt proof is required for each received gift record' });
    await sponsorshipTablesReady;
    const child = await getAccessibleSponsorshipChild(req.user, req.params.id);
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    const [result] = await pool.execute(
      `INSERT INTO sponsored_child_care_records
         (participant_id, care_type, amount, recorded_on, description, receipt_mime, receipt_data, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        child.id,
        careType,
        amount.toFixed(2),
        recordedOn,
        description || null,
        receipt.mime,
        encryptBytes(receipt.data),
        req.user.id,
      ],
    );
    await writeAuditLog(req.user, 'sponsorship.care-record.received', 'participant', child.id, {
      careType,
      amount: amount.toFixed(2),
      recordedOn,
      hasReceipt: Boolean(receipt.data),
    });
    res.status(201).json({
      id: `received-${result.insertId}`,
      amount: Number(amount.toFixed(2)),
      recordedOn,
      careType,
      hasReceipt: Boolean(receipt.data),
    });
  } catch (error) { next(error); }
});

app.post('/api/public/sponsor-status', guardianRateLimit, async (req, res, next) => {
  try {
    const qrPayload = String(req.body.qrPayload || '');
    const passcode = String(req.body.passcode || '');
    if (!qrPayload || qrPayload.length > 4096 || !passcode) {
      return res.status(400).json({ error: 'Scan the child QR code and enter the passcode' });
    }
    const verification = await verifyPublicSponsoredChild(qrPayload, passcode);
    if (verification.error) return res.status(verification.status).json({ error: verification.error });
    const child = verification.child;
    const [participation] = await getSponsoredParticipationSummaries(Number(child.id), {
      recordThresholdHistory: false,
    });
    await educationHistoryReady;
    const [educationRows] = await pool.execute(
      `SELECT id, education_level, school_name_encrypted, start_year, end_year, status,
              course_strand_encrypted
       FROM participant_education_history
       WHERE participant_id = ? ORDER BY start_year DESC, id DESC`,
      [child.id],
    );
    res.json({
      child: {
        name: decrypt(child.full_name_encrypted) || 'Unnamed child',
        participantCode: child.participant_code,
        age: calculateAge(decrypt(child.date_of_birth_encrypted)),
        gender: child.gender || '',
        educationLevel: child.education_level || '',
        gradeLevel: child.grade_level || '',
        schoolName: decrypt(child.school_name_encrypted) || '',
        educationHistory: educationRows.map((row) => ({
          educationLevel: row.education_level,
          schoolName: decrypt(row.school_name_encrypted) || '',
          startYear: Number(row.start_year),
          endYear: row.end_year === null ? null : Number(row.end_year),
          status: row.status,
          courseStrand: decrypt(row.course_strand_encrypted) || '',
        })),
        participation: participation ? {
          status: participation.status,
          monthly: participation.monthly,
          currentYear: participation.currentYear,
          lifetime: participation.lifetime,
          years: participation.years,
          months: participation.months,
          secondChance: participation.secondChance
            ? {
                createdAt: participation.secondChance.createdAt,
                reason: participation.secondChance.reason,
                absenceCount: participation.secondChance.absenceCount,
              }
            : null,
          history: participation.history.map((entry) => ({
            type: entry.type,
            previousStatus: entry.previousStatus,
            currentStatus: entry.currentStatus,
            reason: entry.reason,
            absenceCount: entry.absenceCount,
            createdAt: entry.createdAt,
          })),
        } : null,
      },
    });
  } catch (error) { next(error); }
});

app.use('/api/public/sponsor-letters', retiredSponsorshipFeature);
app.use('/api/public/sponsor-receipt', retiredSponsorshipFeature);

app.post('/api/public/sponsor-updates', guardianRateLimit, async (req, res, next) => {
  try {
    const qrPayload = String(req.body.qrPayload || '');
    const passcode = String(req.body.passcode || '');
    if (!qrPayload || qrPayload.length > 4096 || !passcode) {
      return res.status(400).json({ error: 'Scan the child QR code and enter the passcode' });
    }
    const verification = await verifyPublicSponsoredChild(qrPayload, passcode);
    if (verification.error) return res.status(verification.status).json({ error: verification.error });
    await sponsoredChildUpdatesReady;
    const [rows] = await pool.execute(
      `SELECT id, update_type, recorded_on, activity_encrypted, height_encrypted,
              weight_encrypted, note_encrypted, created_at
       FROM sponsored_child_updates
       WHERE participant_id = ?
       ORDER BY recorded_on DESC, id DESC
       LIMIT 100`,
      [verification.child.id],
    );
    res.json({
      updates: rows.map((row) => ({
        id: row.id,
        type: row.update_type,
        recordedOn: row.recorded_on instanceof Date
          ? row.recorded_on.toISOString().slice(0, 10)
          : String(row.recorded_on).slice(0, 10),
        activity: decrypt(row.activity_encrypted),
        heightCm: decrypt(row.height_encrypted),
        weightKg: decrypt(row.weight_encrypted),
        note: decrypt(row.note_encrypted),
        createdAt: row.created_at,
      })),
    });
  } catch (error) { next(error); }
});

app.post('/api/participants/:id/profile', authenticate, checkPermission('portal:view'), async (req, res, next) => {
  try {
    await goerQrRevocationReady;
    const [[participantType]] = await pool.execute(
      'SELECT participant_type FROM participants WHERE id = ? LIMIT 1',
      [req.params.id],
    );
    if (participantType?.participant_type !== 'sponsored_child') {
      return res.status(404).json({ error: 'Sponsored child not found' });
    }
    const [qrRows] = await pool.execute('SELECT id FROM qr_codes WHERE participant_id = ? AND qr_uid = ? AND status = \'active\' LIMIT 1', [req.params.id, req.body.qrPayload]);
    const [rows] = await pool.execute('SELECT * FROM participants WHERE id = ? LIMIT 1', [req.params.id]);
    if (!qrRows[0] || !rows[0] || !rows[0].passcode_hash || !(await bcrypt.compare(req.body.passcode || '', rows[0].passcode_hash))) return res.status(403).json({ error: 'QR code and passcode verification failed' });
    res.json({ participant: participantView(rows[0]) });
  } catch (error) { next(error); }
});

const REPORT_EXPORT_PAGE_SIZE = 500;
const REPORT_STATUS_LABELS = {
  ACTIVE: 'Active',
  WARNING: 'Warning',
  GROUNDS_FOR_DEPARTURE: 'Ground for Departure',
  INACTIVE: 'Inactive',
};

function exportStatusSql(alias = 'p') {
  return `CASE
    WHEN LOWER(COALESCE(${alias}.status, '')) = 'inactive'
      OR UPPER(COALESCE(${alias}.participation_status, '')) = 'INACTIVE'
      THEN 'INACTIVE'
    WHEN UPPER(COALESCE(${alias}.participation_status, '')) IN ('WARNING', 'GROUNDS_FOR_DEPARTURE')
      THEN UPPER(${alias}.participation_status)
    ELSE 'ACTIVE'
  END`;
}

function parseExportYear(value) {
  const raw = String(value || '').trim();
  return !raw || /^\d{4}$/.test(raw) ? raw : null;
}

function parseExportMonth(value) {
  const raw = String(value || '').trim();
  return !raw || /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null;
}

function parseExportStatus(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw || raw === 'ALL') return '';
  return ['ACTIVE', 'WARNING', 'GROUNDS_FOR_DEPARTURE', 'INACTIVE'].includes(raw)
    ? raw
    : null;
}

function participantExportFilters(req, alias = 'p') {
  const filters = {
    educationLevel: String(req.query.educationLevel || '').trim(),
    gender: String(req.query.gender || '').trim(),
    status: parseExportStatus(req.query.status),
    registrationYear: parseExportYear(req.query.registrationYear),
  };
  if (filters.status === null) return { error: 'Select a supported sponsored child status' };
  if (filters.registrationYear === null) return { error: 'Registration year must use YYYY format' };
  if (filters.educationLevel.length > 50 || filters.gender.length > 20) {
    return { error: 'One or more report filters are too long' };
  }
  const clauses = [];
  const params = [];
  if (filters.educationLevel) {
    clauses.push(`${alias}.education_level = ?`);
    params.push(filters.educationLevel);
  }
  if (filters.gender) {
    clauses.push(`${alias}.gender = ?`);
    params.push(filters.gender);
  }
  if (filters.registrationYear) {
    clauses.push(`YEAR(COALESCE(${alias}.sponsorship_registered_at, ${alias}.sponsorship_start_date, ${alias}.created_at)) = ?`);
    params.push(Number(filters.registrationYear));
  }
  return { filters, clauses, params };
}

async function reportParticipationStatuses() {
  const children = await getSponsoredParticipationSummaries(null, { recordThresholdHistory: false });
  return new Map(children.map((child) => [Number(child.id), child.status]));
}

function csvDate(value) {
  if (!value) return '';
  if (!(value instanceof Date)) return String(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

async function streamReportCsv(req, res, {
  filename,
  headers,
  sql,
  params,
  mapRow = (row) => row,
  filterRow = () => true,
  reportType,
  filters,
}) {
  await writeAuditLog(req.user, 'report.downloaded', 'report', reportType, {
    reportType,
    filters,
  });
  try {
    res.status(200);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(filename);
    res.write(`\uFEFF${csvRecord(headers)}\r\n`);
    let offset = 0;
    while (!res.destroyed) {
      const [rows] = await pool.execute(`${sql} LIMIT ? OFFSET ?`, [
        ...params,
        REPORT_EXPORT_PAGE_SIZE,
        offset,
      ]);
      if (!rows.length) break;
      const body = rows
        .filter(filterRow)
        .map((row) => mapRow(row))
        .filter((row) => row !== null)
        .map(csvRecord)
        .join('\r\n');
      offset += rows.length;
      if (body && !res.write(`${body}\r\n`)) {
        await new Promise((resolve, reject) => {
          const onDrain = () => {
            res.removeListener('close', onClose);
            resolve();
          };
          const onClose = () => {
            res.removeListener('drain', onDrain);
            reject(new Error('Report export connection closed'));
          };
          res.once('drain', onDrain);
          res.once('close', onClose);
        });
      }
      if (rows.length < REPORT_EXPORT_PAGE_SIZE) break;
    }
    if (!res.destroyed) res.end();
  } catch (error) {
    if (!res.headersSent) throw error;
    console.error('Report CSV streaming failed', error);
    res.destroy(error);
  }
}

const ATTENDANCE_EXPORT_CTE = `
  WITH event_occurrences AS (
    SELECT MIN(e.id) AS id, LOWER(TRIM(e.name)) AS event_key,
           DATE(e.starts_at) AS event_date, MIN(e.name) AS name,
           MIN(e.starts_at) AS starts_at, MAX(e.ends_at) AS ends_at,
           MIN(e.location) AS location
    FROM events e
    WHERE (e.is_sample = FALSE OR e.starts_at >= '2013-01-01')
      AND LOWER(e.status) = 'completed' AND e.starts_at < NOW()
    GROUP BY LOWER(TRIM(e.name)), DATE(e.starts_at)
  ), checkin_occurrences AS (
    SELECT c.participant_id, LOWER(TRIM(COALESCE(linked_event.name, c.event_name))) AS event_key,
           COALESCE(DATE(c.checked_in_at), DATE(linked_event.starts_at)) AS event_date,
           MIN(c.event_id) AS event_id,
           MIN(c.id) AS id,
           MIN(c.checked_in_at) AS checked_in_at,
           MAX(c.checked_out_at) AS checked_out_at,
           MIN(COALESCE(linked_event.name, c.event_name)) AS event_name,
           CASE
             WHEN MAX(c.attendance_status = 'present') = 1 OR MAX(c.status = 'checked_in') = 1 THEN 'Present'
             WHEN MAX(c.attendance_status = 'absent') = 1 THEN 'Absent'
             ELSE 'Absent'
           END AS attendance_status,
           MAX(c.recorded_by_encrypted) AS recorded_by_encrypted,
           MAX(c.remarks_encrypted) AS remarks_encrypted
    FROM check_in_logs c
    LEFT JOIN events linked_event ON linked_event.id = c.event_id
    WHERE (c.status = 'checked_in' AND c.checked_in_at IS NOT NULL AND c.checked_in_at < NOW())
       OR (c.attendance_status IN ('present', 'absent')
           AND COALESCE(DATE(c.checked_in_at), DATE(linked_event.starts_at)) <= CURDATE())
    GROUP BY c.participant_id, LOWER(TRIM(COALESCE(linked_event.name, c.event_name))),
             COALESCE(DATE(c.checked_in_at), DATE(linked_event.starts_at))
  ), attendance_export AS (
    SELECT c.id AS attendance_record_id, p.id AS participant_id,
           p.full_name_encrypted, p.first_name_encrypted, p.middle_name_encrypted,
           p.last_name_encrypted, p.date_of_birth_encrypted, p.gender,
           p.education_level, ${exportStatusSql('p')} AS current_status,
           e.id AS activity_id, e.name AS activity_name, e.starts_at AS event_date,
           IF(c.id IS NULL, 'Absent', c.attendance_status) AS attendance_status,
           c.checked_in_at, c.checked_out_at, c.recorded_by_encrypted, c.remarks_encrypted
    FROM participants p
    JOIN event_occurrences e
      ON e.event_date >= DATE(COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at))
     AND e.event_date <= CURDATE()
    LEFT JOIN checkin_occurrences c
      ON c.participant_id = p.id AND c.event_key = e.event_key AND c.event_date = e.event_date
    WHERE p.participant_type = 'sponsored_child' AND p.status <> 'deleted'
    UNION ALL
    SELECT c.id, p.id, p.full_name_encrypted, p.first_name_encrypted,
           p.middle_name_encrypted, p.last_name_encrypted, p.date_of_birth_encrypted,
           p.gender, p.education_level, ${exportStatusSql('p')},
           c.event_id, c.event_name, COALESCE(c.event_date, c.checked_in_at),
           c.attendance_status, c.checked_in_at, c.checked_out_at,
           c.recorded_by_encrypted, c.remarks_encrypted
    FROM participants p
    JOIN checkin_occurrences c ON c.participant_id = p.id
    WHERE p.participant_type = 'sponsored_child' AND p.status <> 'deleted'
      AND c.event_date >= DATE(COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at))
      AND NOT EXISTS (
        SELECT 1 FROM event_occurrences e
        WHERE e.event_key = c.event_key AND e.event_date = c.event_date
      )
  )
`;

function buildAttendanceExportQuery(req) {
  const childId = String(req.query.participantId || '').trim();
  const educationLevel = String(req.query.educationLevel || '').trim();
  const status = parseExportStatus(req.query.status);
  const attendanceStatus = String(req.query.attendanceStatus || '').trim().toLowerCase();
  const year = parseExportYear(req.query.year);
  const month = parseExportMonth(req.query.month);
  if (childId && (!/^[1-9]\d*$/.test(childId) || !Number.isSafeInteger(Number(childId)))) {
    return { error: 'Select a valid sponsored child' };
  }
  if (educationLevel.length > 50) return { error: 'Education level filter is too long' };
  if (status === null) return { error: 'Select a supported sponsored child status' };
  if (attendanceStatus && !['present', 'absent'].includes(attendanceStatus)) {
    return { error: 'Attendance status must be Present or Absent' };
  }
  if (year === null) return { error: 'Year must use YYYY format' };
  if (month === null) return { error: 'Month must use YYYY-MM format' };
  const clauses = [];
  const params = [];
  if (childId) {
    clauses.push('participant_id = ?');
    params.push(Number(childId));
  }
  if (educationLevel) {
    clauses.push('education_level = ?');
    params.push(educationLevel);
  }
  if (attendanceStatus) {
    clauses.push('LOWER(attendance_status) = ?');
    params.push(attendanceStatus);
  }
  if (year) {
    clauses.push('YEAR(event_date) = ?');
    params.push(Number(year));
  }
  if (month) {
    clauses.push("DATE_FORMAT(event_date, '%Y-%m') = ?");
    params.push(month);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return {
    filters: { participantId: childId || '', educationLevel, status, attendanceStatus, year, month },
    params,
    sql: `${ATTENDANCE_EXPORT_CTE}
      SELECT * FROM attendance_export ${where}
      ORDER BY event_date ASC, participant_id ASC, activity_name ASC`,
  };
}

async function reportRows(range) {
  const dateFilter = range === 'monthly'
    ? `c.checked_in_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       AND c.checked_in_at < DATE_ADD(LAST_DAY(CURDATE()), INTERVAL 1 DAY)`
    : `c.checked_in_at < DATE_ADD(MAKEDATE(YEAR(CURDATE()), 1), INTERVAL 1 YEAR)`;
  const [rows] = await pool.query(
    `SELECT c.event_name, c.status, c.location, c.checked_in_at, c.checked_out_at, c.participant_id
     FROM check_in_logs c
     WHERE ${dateFilter}
       AND NOT EXISTS (
         SELECT 1 FROM events e
         WHERE e.is_sample = TRUE
           AND LOWER(e.name) = LOWER(c.event_name)
           AND DATE(e.starts_at) = DATE(c.checked_in_at)
       )
     ORDER BY c.checked_in_at DESC`,
  );
  return rows;
}

app.get('/api/reports/attendance', authenticate, checkPermission('reports:view'), async (req, res, next) => {
  try {
    const range = String(req.query.range || 'yearly');
    if (!['yearly', 'monthly'].includes(range)) {
      return res.status(400).json({ error: 'Select a yearly or monthly reporting range' });
    }
    await eventsTableReady;
    const rows = await reportRows(range);
    if (req.query.format === 'csv') {
      return res.type('text/csv').send(new Parser({
        fields: [
          'event_name',
          'status',
          'location',
          'checked_in_at',
          'checked_out_at',
          { label: 'Record ID', value: 'participant_id' },
        ],
      }).parse(rows));
    }
    if (req.query.format === 'pdf') { const doc = new PDFDocument(); res.type('application/pdf'); doc.pipe(res); doc.fontSize(18).text(`${range === 'yearly' ? 'Yearly' : 'Monthly'} Attendance Report`); rows.forEach((row) => doc.fontSize(10).text(`${row.checked_in_at || ''} | ${row.checked_out_at || 'Not checked out'} | record ${row.participant_id} | ${row.event_name} | ${row.status}`)); return doc.end(); }
    res.json({ range, records: rows });
  } catch (error) { next(error); }
});

app.get('/api/reports/export-counts', authenticate, checkPermission('reports:view'), async (req, res, next) => {
  try {
    const counts = {
      sponsoredChildren: null,
      educationHistory: null,
      churchActivities: null,
      attendanceRecords: null,
    };
    const countTasks = [];
    if (hasReportCategoryPermission(req.user, 'sponsorship:view')) {
      await Promise.all([
        participantProfileColumnsReady, educationHistoryReady, eventsTableReady, attendanceImportColumnsReady,
      ]);
      countTasks.push(
        pool.execute(
          `SELECT COUNT(*) AS count FROM participants
           WHERE participant_type = 'sponsored_child' AND status <> 'deleted'`,
        ).then(([[row]]) => { counts.sponsoredChildren = Number(row.count); }),
        pool.execute(
          `SELECT COUNT(*) AS count FROM participant_education_history h
           JOIN participants p ON p.id = h.participant_id
           WHERE p.participant_type = 'sponsored_child' AND p.status <> 'deleted'`,
        ).then(([[row]]) => { counts.educationHistory = Number(row.count); }),
        pool.query(`${ATTENDANCE_EXPORT_CTE} SELECT COUNT(*) AS count FROM attendance_export`)
          .then(([[row]]) => { counts.attendanceRecords = Number(row.count); }),
      );
    }
    if (hasReportCategoryPermission(req.user, 'events:view')) {
      await eventsTableReady;
      countTasks.push(
        pool.execute('SELECT COUNT(*) AS count FROM events')
          .then(([[row]]) => { counts.churchActivities = Number(row.count); }),
      );
    }
    await Promise.all(countTasks);
    res.json(counts);
  } catch (error) { next(error); }
});

app.get(
  '/api/reports/exports/sponsored-children',
  authenticate,
  checkPermission('reports:view'),
  checkReportCategoryPermission('sponsorship:view'),
  async (req, res, next) => {
    try {
      await participantProfileColumnsReady;
      const filters = participantExportFilters(req);
      if (filters.error) return res.status(400).json({ error: filters.error });
      const currentStatuses = await reportParticipationStatuses();
      const clauses = [
        "p.participant_type = 'sponsored_child'",
        "p.status <> 'deleted'",
        ...filters.clauses,
      ];
      const sql = `SELECT p.*,
          COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at) AS registration_date
        FROM participants p
        WHERE ${clauses.join(' AND ')}
        ORDER BY p.id ASC`;
      const stamp = new Date().toISOString().slice(0, 10);
      await streamReportCsv(req, res, {
        filename: `FMC_Sponsored_Children_${stamp}.csv`,
        headers: [
          'Sponsored Child ID', 'Sponsored Child Code', 'First Name', 'Middle Name',
          'Last Name', 'Suffix', 'Gender', 'Date of Birth', 'Age',
          'Contact Information', 'Address or Location', 'Registration Date',
          'Participation Status', 'Guardian Name', 'Guardian Relationship',
          'Guardian Contact Number', 'Guardian Email',
        ],
        sql,
        params: filters.params,
        reportType: 'sponsored_children',
        filters: filters.filters,
        filterRow: (row) => !filters.filters.status
          || currentStatuses.get(Number(row.id)) === filters.filters.status,
        mapRow: (row) => {
          const child = participantView(row);
          const currentStatus = currentStatuses.get(Number(row.id)) || 'ACTIVE';
          return [
            row.id,
            row.participant_code,
            child.firstName,
            child.middleName,
            child.lastName,
            '',
            row.gender,
            child.dateOfBirth,
            child.age,
            child.phone,
            child.address,
            row.registration_date ? csvDate(row.registration_date).slice(0, 10) : '',
            REPORT_STATUS_LABELS[currentStatus] || currentStatus,
            child.guardianName,
            '',
            child.parentContact,
            '',
          ];
        },
      });
    } catch (error) { next(error); }
  },
);

app.get(
  '/api/reports/exports/education-history',
  authenticate,
  checkPermission('reports:view'),
  checkReportCategoryPermission('sponsorship:view'),
  async (req, res, next) => {
    try {
      await Promise.all([participantProfileColumnsReady, educationHistoryReady]);
      const filters = participantExportFilters(req);
      if (filters.error) return res.status(400).json({ error: filters.error });
      const currentStatuses = await reportParticipationStatuses();
      const clauses = [
        "p.participant_type = 'sponsored_child'",
        "p.status <> 'deleted'",
        ...filters.clauses,
      ];
      const sql = `SELECT h.*, p.id AS sponsored_child_id, p.participant_code,
          p.full_name_encrypted, p.first_name_encrypted, p.middle_name_encrypted,
          p.last_name_encrypted, p.date_of_birth_encrypted, p.gender,
          p.education_level AS current_education_level
        FROM participant_education_history h
        JOIN participants p ON p.id = h.participant_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY h.id ASC`;
      const stamp = new Date().toISOString().slice(0, 10);
      await streamReportCsv(req, res, {
        filename: `FMC_Sponsored_Child_Education_History_${stamp}.csv`,
        headers: [
          'Education History ID', 'Sponsored Child ID', 'Sponsored Child Code',
          'Sponsored Child Name', 'School Name', 'School Address', 'Grade or Year Level',
          'Education Level', 'School Year', 'Start Date', 'End Date',
          'Current Education Status', 'Graduation or Completion Information',
        ],
        sql,
        params: filters.params,
        reportType: 'sponsored_child_education_history',
        filters: filters.filters,
        filterRow: (row) => !filters.filters.status
          || currentStatuses.get(Number(row.sponsored_child_id)) === filters.filters.status,
        mapRow: (row) => {
          const child = participantView(row);
          return [
            row.id,
            row.sponsored_child_id,
            row.participant_code,
            child.fullName,
            decrypt(row.school_name_encrypted) || '',
            decrypt(row.school_address_encrypted) || '',
            '',
            row.education_level,
            [row.start_year, row.end_year || ''].filter(Boolean).join('-'),
            '',
            '',
            row.status,
            decrypt(row.notes_encrypted) || '',
          ];
        },
      });
    } catch (error) { next(error); }
  },
);

app.get(
  '/api/reports/exports/church-activities',
  authenticate,
  checkPermission('reports:view'),
  checkReportCategoryPermission('events:view'),
  async (req, res, next) => {
    try {
      await eventsTableReady;
      const status = String(req.query.status || '').trim();
      const year = parseExportYear(req.query.year);
      if (status.length > 30) return res.status(400).json({ error: 'Event status filter is too long' });
      if (year === null) return res.status(400).json({ error: 'Year must use YYYY format' });
      const clauses = [];
      const params = [];
      if (status) {
        clauses.push('e.status = ?');
        params.push(status);
      }
      if (year) {
        clauses.push('YEAR(e.starts_at) = ?');
        params.push(Number(year));
      }
      const filters = { status, year };
      const sql = `SELECT e.id, e.name, e.description, e.starts_at, e.ends_at,
          e.location, e.status, e.created_at
        FROM events e
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY e.id ASC`;
      const stamp = new Date().toISOString().slice(0, 10);
      await streamReportCsv(req, res, {
        filename: `FMC_Church_Activities_${stamp}.csv`,
        headers: [
          'Activity/Event ID', 'Activity Name', 'Activity Type', 'Description',
          'Education Group', 'Event Date', 'Start Time', 'End Time', 'Venue or Location',
          'Event Status', 'Created Date',
        ],
        sql,
        params,
        reportType: 'church_activities',
        filters,
        mapRow: (row) => [
          row.id,
          row.name,
          '',
          row.description,
          '',
          csvDate(row.starts_at).slice(0, 10),
          csvDate(row.starts_at).slice(11, 19),
          csvDate(row.ends_at).slice(11, 19),
          row.location,
          row.status,
          csvDate(row.created_at),
        ],
      });
    } catch (error) { next(error); }
  },
);

app.get(
  '/api/reports/exports/attendance',
  authenticate,
  checkPermission('reports:view'),
  checkReportCategoryPermission('sponsorship:view'),
  async (req, res, next) => {
    try {
      await Promise.all([participantProfileColumnsReady, eventsTableReady, attendanceImportColumnsReady]);
      const report = buildAttendanceExportQuery(req);
      if (report.error) return res.status(400).json({ error: report.error });
      const currentStatuses = report.filters.status
        ? await reportParticipationStatuses()
        : null;
      const stamp = new Date().toISOString().slice(0, 10);
      await streamReportCsv(req, res, {
        filename: `FMC_Sponsored_Child_Attendance_${stamp}.csv`,
        headers: [
          'Attendance Record ID', 'Sponsored Child ID', 'Sponsored Child Full Name',
          'Gender', 'Education Level', 'Activity/Event ID', 'Activity Name',
          'Event Date', 'Attendance Status', 'Check-in Date and Time',
          'Check-out Date and Time', 'Recorded By', 'Attendance Remarks',
        ],
        sql: report.sql,
        params: report.params,
        reportType: 'sponsored_child_attendance',
        filters: report.filters,
        filterRow: (row) => !report.filters.status
          || currentStatuses.get(Number(row.participant_id)) === report.filters.status,
        mapRow: (row) => [
          row.attendance_record_id,
          row.participant_id,
          participantView(row).fullName,
          row.gender,
          row.education_level,
          row.activity_id,
          row.activity_name,
          csvDate(row.event_date),
          row.attendance_status,
          csvDate(row.checked_in_at),
          csvDate(row.checked_out_at),
          decrypt(row.recorded_by_encrypted) || '',
          decrypt(row.remarks_encrypted) || '',
        ],
      });
    } catch (error) { next(error); }
  },
);

app.get(
  '/api/reports/sponsored-child-updates',
  authenticate,
  checkPermission('reports:view'),
  checkPermission('sponsorship:view'),
  async (req, res, next) => {
    try {
      const participantId = Number(req.query.participantId);
      if (!Number.isSafeInteger(participantId) || participantId < 1) {
        return res.status(400).json({ error: 'Select a sponsored child for the report' });
      }
      await sponsoredChildUpdatesReady;
      const [[child]] = await pool.execute(
        `SELECT id, full_name_encrypted, participant_code
         FROM participants
         WHERE id = ? AND participant_type = 'sponsored_child' AND status <> 'deleted'
         LIMIT 1`,
        [participantId],
      );
      if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
      const [updates] = await pool.execute(
        `SELECT update_type, recorded_on, activity_encrypted, height_encrypted,
                weight_encrypted, note_encrypted
         FROM sponsored_child_updates
         WHERE participant_id = ?
         ORDER BY recorded_on DESC, id DESC`,
        [child.id],
      );
      const rows = updates.map((update) => ({
        sponsoredChildCode: child.participant_code,
        childName: decrypt(child.full_name_encrypted) || 'Unnamed sponsored child',
        recordedOn: update.recorded_on instanceof Date
          ? update.recorded_on.toISOString().slice(0, 10)
          : String(update.recorded_on).slice(0, 10),
        type: update.update_type,
        activity: decrypt(update.activity_encrypted),
        heightCm: decrypt(update.height_encrypted),
        weightKg: decrypt(update.weight_encrypted),
        note: decrypt(update.note_encrypted),
      }));
      const filenameCode = String(child.participant_code || participantId).replace(/[^\w-]/g, '_');
      res.type('text/csv').attachment(`sponsored-child-updates-${filenameCode}.csv`)
        .send(new Parser({
          fields: ['sponsoredChildCode', 'childName', 'recordedOn', 'type', 'activity', 'heightCm', 'weightKg', 'note'],
        }).parse(rows));
    } catch (error) { next(error); }
  },
);

async function loadAttendanceRiskSettings() {
  await attendanceRiskSettingsReady;
  const [[row]] = await pool.execute(
    `SELECT frequency_weight, regularity_weight, recency_weight,
            medium_threshold, high_threshold, updated_at
     FROM attendance_risk_settings WHERE setting_id = 1`,
  );
  return {
    ...normalizeAttendanceRiskSettings({
      frequencyWeight: Number(row.frequency_weight),
      regularityWeight: Number(row.regularity_weight),
      recencyWeight: Number(row.recency_weight),
      mediumThreshold: Number(row.medium_threshold),
      highThreshold: Number(row.high_threshold),
    }),
    updatedAt: row.updated_at,
  };
}

app.get('/api/analytics/risk-settings', authenticate, checkRole(['System Administrator', 'Church Administrator']), async (req, res, next) => {
  try {
    res.json(await loadAttendanceRiskSettings());
  } catch (error) { next(error); }
});

app.put('/api/analytics/risk-settings', authenticate, checkRole(['System Administrator', 'Church Administrator']), async (req, res, next) => {
  try {
    const config = normalizeAttendanceRiskSettings(req.body || {});
    await attendanceRiskSettingsReady;
    await pool.execute(
      `UPDATE attendance_risk_settings
       SET frequency_weight = ?, regularity_weight = ?, recency_weight = ?,
           medium_threshold = ?, high_threshold = ?, updated_by = ?
       WHERE setting_id = 1`,
      [
        config.frequencyWeight,
        config.regularityWeight,
        config.recencyWeight,
        config.mediumThreshold,
        config.highThreshold,
        req.user.id,
      ],
    );
    await writeAuditLog(req.user, 'attendance.prediction.settings.updated', 'attendance_prediction', 1, config);
    res.json(await loadAttendanceRiskSettings());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Weights must be')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

const ANALYTICS_INTERVALS = new Set(['day', 'week', 'month', 'year']);
const RISK_LEVEL_FILTERS = new Set(['all', 'high', 'medium', 'low']);
const ENCRYPTED_EXPORT_FORMAT = 'church-analytics-encrypted-export';

function parseAnalyticsDate(value) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function analyticsDateRange(req) {
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 89);
  const start = parseAnalyticsDate(req.query.from) || defaultFrom;
  const end = parseAnalyticsDate(req.query.to) || new Date();
  if (end.getTime() < start.getTime()) return null;
  return { start, end, endExclusive: new Date(end.getTime() + 24 * 60 * 60 * 1000) };
}

function normalizeInterval(value) {
  return ANALYTICS_INTERVALS.has(value) ? value : 'week';
}

function normalizeEducationLevel(value) {
  const raw = String(value || '').trim();
  return raw === 'all' ? '' : raw;
}

function normalizeRiskFilter(value) {
  return RISK_LEVEL_FILTERS.has(value) ? value : 'all';
}

function roundRate(value) {
  return Math.round(value * 10) / 10;
}

function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function weekStart(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function bucketLabel(key, interval) {
  const parts = key.split('-').map(Number);
  if (interval === 'year') return key;
  if (interval === 'month') {
    return new Date(parts[0], parts[1] - 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  const label = new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return interval === 'week' ? `Week of ${label}` : label;
}

function normalizeAnalyticsEducation(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'all') return '';
  if (raw === 'high school') return 'High School';
  return [...EDUCATION_LEVELS].find((level) => level.toLowerCase() === raw) || '';
}

function normalizeAnalyticsStatus(value) {
  const raw = String(value || '').trim();
  return raw.toLowerCase() === 'all' ? '' : raw.toUpperCase();
}

function matchesAnalyticsStatus(participant, status) {
  if (!status || status === 'all') return true;
  if (status === 'WARNING') return participant.participationStatus === 'WARNING';
  return participant.participationStatus === status;
}

async function loadSponsoredAttendanceData({ range, educationLevel = '', status = '', eventId = '', interval = 'month', participantId = null }) {
  await Promise.all([
    participantProfileColumnsReady, eventsTableReady, attendanceImportColumnsReady, participationTrackingReady,
  ]);
  const education = normalizeAnalyticsEducation(educationLevel);
  const participantConditions = [
    "p.participant_type = 'sponsored_child'",
    "p.status <> 'deleted'",
    'COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at) < ?',
  ];
  const participantParams = [range.endExclusive];
  if (education === 'High School') {
    participantConditions.push("p.education_level IN ('Junior High School', 'Senior High School', 'High School')");
  } else if (education) {
    participantConditions.push('p.education_level = ?');
    participantParams.push(education);
  }
  if (participantId) {
    participantConditions.push('p.id = ?');
    participantParams.push(participantId);
  }
  if (eventId) {
    participantConditions.push(
      `COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at) <= (
         SELECT selected.starts_at
         FROM events selected
         WHERE selected.id = ?
           AND (selected.is_sample = FALSE OR selected.starts_at >= '2013-01-01')
           AND selected.status = 'completed'
           AND selected.starts_at < NOW()
           AND selected.starts_at >= ? AND selected.starts_at < ?
       )`,
    );
    participantParams.push(Number(eventId), range.start, range.endExclusive);
  }
  const [participantRows, summaries] = await Promise.all([
    pool.execute(
      `SELECT p.id, p.participant_code, p.full_name_encrypted, p.education_level, p.grade_level,
              COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at) AS registration_date,
              p.participation_status, p.status AS participant_status
       FROM participants p
       WHERE ${participantConditions.join(' AND ')}
       ORDER BY p.id`,
      participantParams,
    ).then(([rows]) => rows),
    getSponsoredParticipationSummaries(null, { recordThresholdHistory: false }),
  ]);
  const summaryById = new Map(summaries.map((child) => [Number(child.id), child]));
  const participants = participantRows
    .map((row) => {
      const summary = summaryById.get(Number(row.id));
      const participationStatus = String(row.participant_status || '').toLowerCase() === 'inactive'
        || row.participation_status === 'INACTIVE'
        ? 'INACTIVE'
        : summary?.status || row.participation_status || 'ACTIVE';
      const removal = summary?.history?.find((action) => action.type === 'removed');
      return {
        id: Number(row.id),
        participantCode: row.participant_code || '',
        name: summary?.name || decrypt(row.full_name_encrypted) || 'Unnamed child',
        educationLevel: row.education_level || '',
        gradeLevel: row.grade_level || '',
        registrationDate: row.registration_date,
        participationStatus,
        secondChance: Boolean(summary?.secondChance),
        inactiveReason: summary?.inactiveReason || removal?.reason || '',
        lifetime: summary?.lifetime || null,
      };
    })
    .filter((participant) => matchesAnalyticsStatus(participant, status));
  const eventOptions = await pool.execute(
    `SELECT id, name, starts_at
     FROM events
     WHERE (is_sample = FALSE OR starts_at >= '2013-01-01')
       AND status = 'completed' AND starts_at < NOW()
       AND starts_at >= ? AND starts_at < ?
     ORDER BY starts_at, id`,
    [range.start, range.endExclusive],
  ).then(([rows]) => rows);
  if (!participants.length) {
    return {
      participants: [],
      occurrences: [],
      analytics: buildAttendanceAnalytics([], [], interval, range),
      events: eventOptions,
    };
  }
  const participantIds = participants.map((participant) => participant.id);
  const placeholders = participantIds.map(() => '?').join(', ');
  const eventCondition = eventId ? ' AND e.id = ?' : '';
  const [occurrences] = await pool.execute(
    `SELECT p.id AS participantId, e.id AS eventId, e.name AS eventName,
            e.starts_at AS startsAt,
            EXISTS (
              SELECT 1
              FROM check_in_logs c
              WHERE c.participant_id = p.id
                AND (
                  (c.status = 'checked_in'
                   AND c.checked_in_at >= DATE(e.starts_at)
                   AND c.checked_in_at < DATE_ADD(DATE(e.starts_at), INTERVAL 1 DAY)
                   AND LOWER(TRIM(c.event_name)) = LOWER(TRIM(e.name)))
                  OR (c.attendance_status = 'present' AND c.event_id = e.id)
                )
            ) AS present
     FROM participants p
     JOIN events e
       ON (e.is_sample = FALSE OR e.starts_at >= '2013-01-01')
      AND e.status = 'completed'
      AND e.starts_at < NOW()
      AND e.starts_at >= COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at)
      AND e.starts_at >= ? AND e.starts_at < ?${eventCondition}
     WHERE p.id IN (${placeholders})
     ORDER BY e.starts_at, e.id, p.id`,
    eventId
      ? [range.start, range.endExclusive, Number(eventId), ...participantIds]
      : [range.start, range.endExclusive, ...participantIds],
  );
  const analytics = buildAttendanceAnalytics(participants, occurrences, interval, range);
  return { participants, occurrences, analytics, events: eventOptions };
}

async function loadPredictionAttendanceData({ educationLevel = '', status = '', participantId = null } = {}) {
  await Promise.all([
    participantProfileColumnsReady,
    eventsTableReady,
    attendanceImportColumnsReady,
    participationTrackingReady,
  ]);
  const conditions = [
    "p.participant_type = 'sponsored_child'",
    "p.status <> 'deleted'",
  ];
  const params = [];
  const education = normalizeAnalyticsEducation(educationLevel);
  if (education === 'High School') {
    conditions.push("p.education_level IN ('Junior High School', 'Senior High School', 'High School')");
  } else if (education) {
    conditions.push('p.education_level = ?');
    params.push(education);
  }
  if (participantId) {
    conditions.push('p.id = ?');
    params.push(Number(participantId));
  }
  const [[rows], summaries] = await Promise.all([
    pool.execute(
    `SELECT p.id, p.participant_code, p.full_name_encrypted, p.education_level,
            COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at) AS registration_date,
            p.participation_status, p.status AS participant_status,
            e.id AS event_id, e.name AS event_name, e.starts_at,
            CASE
              WHEN MAX(CASE WHEN c.status IN ('checked_in', 'checked_out')
                              OR LOWER(COALESCE(c.attendance_status, '')) = 'present'
                            THEN 1 ELSE 0 END) = 1 THEN 'present'
              WHEN MAX(CASE WHEN c.status = 'absent'
                              OR LOWER(COALESCE(c.attendance_status, '')) = 'absent'
                            THEN 1 ELSE 0 END) = 1 THEN 'absent'
              ELSE NULL
            END AS attendance_status
     FROM participants p
     LEFT JOIN events e
       ON e.is_sample = FALSE
      AND e.status = 'completed'
      AND e.starts_at < NOW()
      AND e.starts_at >= COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at)
     LEFT JOIN check_in_logs c
       ON c.participant_id = p.id
      AND (
        c.event_id = e.id
        OR (
          c.event_id IS NULL
          AND LOWER(TRIM(c.event_name)) = LOWER(TRIM(e.name))
          AND c.checked_in_at >= DATE(e.starts_at)
          AND c.checked_in_at < DATE_ADD(DATE(e.starts_at), INTERVAL 1 DAY)
        )
      )
     WHERE ${conditions.join(' AND ')}
     GROUP BY p.id, e.id
     ORDER BY p.id, e.starts_at, e.id`,
    params,
    ),
    getSponsoredParticipationSummaries(null, { recordThresholdHistory: false }),
  ]);
  const summariesById = new Map(summaries.map((summary) => [Number(summary.id), summary]));
  const childrenById = new Map();
  for (const row of rows) {
    const participantKey = Number(row.id);
    if (!childrenById.has(participantKey)) {
      const summary = summariesById.get(participantKey);
      const inactive = String(row.participant_status || '').toLowerCase() === 'inactive'
        || row.participation_status === 'INACTIVE';
      childrenById.set(participantKey, {
        participantId: participantKey,
        participantCode: row.participant_code || '',
        participantName: summary?.name || decrypt(row.full_name_encrypted) || 'Unnamed child',
        educationLevel: row.education_level || '',
        registrationDate: row.registration_date,
        participationStatus: inactive
          ? 'INACTIVE'
          : summary?.status || String(row.participation_status || 'ACTIVE').toUpperCase(),
        events: [],
      });
    }
    if (row.event_id !== null) {
      childrenById.get(participantKey).events.push({
        eventId: row.event_id,
        eventName: row.event_name,
        startsAt: row.starts_at,
        attendanceStatus: row.attendance_status,
      });
    }
  }
  return [...childrenById.values()].filter((child) =>
    matchesAnalyticsStatus({ participationStatus: child.participationStatus }, status));
}

function buildRuleBasedRiskRows(children, settings, riskFilter = 'all', referenceTime = Date.now()) {
  return children.map((child) => {
    const { events, ...identity } = child;
    const assessment = buildAttendanceRiskAssessment(events, settings, referenceTime);
    const { history, ...summary } = assessment;
    return {
      ...identity,
      ...summary,
      recentAttendancePattern: assessment.pattern,
      recommendedAction: assessment.recommendedActions.join(' '),
      assessmentMethod: 'rule_based',
    };
  }).filter((row) => riskFilter === 'all' || row.riskLevel === riskFilter);
}

async function computeRiskRecords(riskFilter, filters = {}) {
  const [children, settings] = await Promise.all([
    loadPredictionAttendanceData({
      educationLevel: filters.educationLevel,
      status: filters.status,
    }),
    loadAttendanceRiskSettings(),
  ]);
  return buildRuleBasedRiskRows(children, settings, riskFilter);
}

async function computeAttendanceTrends(range, interval, eventId, filters = {}) {
  const data = await loadSponsoredAttendanceData({
    range,
    educationLevel: filters.educationLevel,
    status: filters.status,
    eventId,
    interval,
  });
  return {
    interval,
    eventId: eventId || null,
    events: data.events.map((event) => ({
      id: event.id,
      name: event.name,
      startsAt: event.starts_at,
    })),
    records: data.analytics.records,
  };
}

async function computeSponsoredChildren(filters) {
  const range = filters.range || analyticsDateRange({ query: {} });
  const data = await loadSponsoredAttendanceData({
    range,
    educationLevel: filters.educationLevel,
    status: filters.participationStatus,
    eventId: filters.eventId,
    interval: 'month',
  });
  const riskRows = await computeRiskRecords('all', {
    educationLevel: filters.educationLevel,
    status: normalizeAnalyticsStatus(filters.participationStatus),
  });
  const riskById = new Map(riskRows.map((row) => [Number(row.participantId), row]));
  return data.analytics.participants
    .filter((participant) => (!filters.gradeLevel || participant.gradeLevel === filters.gradeLevel))
    .map((participant) => {
      const risk = riskById.get(participant.id);
      return {
        ...participant,
        riskScore: risk?.riskScore ?? null,
        riskLevel: risk?.riskLevel || 'insufficient_data',
        riskMethod: risk?.assessmentMethod || 'rule_based',
        computedAt: null,
      };
    })
    .filter((child) => filters.riskLevel === 'all' || child.riskLevel === filters.riskLevel);
}

function participantOccurrenceSubquery() {
  return `
    (
      SELECT occurrence.event_id, occurrence.event_name, occurrence.event_date,
             occurrence.is_scheduled, occurrence.is_csv_synthetic,
             EXISTS (
               SELECT 1
               FROM check_in_logs c
               LEFT JOIN events linked_event ON linked_event.id = c.event_id
               WHERE c.participant_id = ?
                 AND (
                   (c.status = 'checked_in' AND c.checked_in_at IS NOT NULL
                    AND (c.event_id = occurrence.event_id
                      OR (LOWER(TRIM(COALESCE(linked_event.name, c.event_name))) = LOWER(TRIM(occurrence.event_name))
                        AND COALESCE(DATE(linked_event.starts_at), DATE(c.checked_in_at)) = DATE(occurrence.event_date))))
                   OR (c.attendance_status = 'present'
                    AND (c.event_id = occurrence.event_id
                      OR (LOWER(TRIM(COALESCE(linked_event.name, c.event_name))) = LOWER(TRIM(occurrence.event_name))
                        AND COALESCE(DATE(linked_event.starts_at), DATE(c.checked_in_at)) = DATE(occurrence.event_date))))
                 )
             ) AS is_attended,
             COALESCE(
               (SELECT MIN(c.checked_in_at)
                FROM check_in_logs c
                LEFT JOIN events linked_event ON linked_event.id = c.event_id
                WHERE c.participant_id = ? AND c.status = 'checked_in'
                  AND c.checked_in_at IS NOT NULL
                  AND (c.event_id = occurrence.event_id
                    OR (LOWER(TRIM(COALESCE(linked_event.name, c.event_name))) = LOWER(TRIM(occurrence.event_name))
                      AND COALESCE(DATE(linked_event.starts_at), DATE(c.checked_in_at)) = DATE(occurrence.event_date)))),
               NULL
             ) AS attended_at,
             COALESCE(
               (SELECT MIN(c.location)
                FROM check_in_logs c
                LEFT JOIN events linked_event ON linked_event.id = c.event_id
                WHERE c.participant_id = ? AND c.status = 'checked_in'
                  AND (c.event_id = occurrence.event_id
                    OR (LOWER(TRIM(COALESCE(linked_event.name, c.event_name))) = LOWER(TRIM(occurrence.event_name))
                      AND COALESCE(DATE(linked_event.starts_at), DATE(c.checked_in_at)) = DATE(occurrence.event_date)))),
               occurrence.event_location
             ) AS location
      FROM (
               SELECT MIN(e.id) AS event_id,
                      CONVERT(MIN(TRIM(e.name)) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS event_name,
                      MIN(e.starts_at) AS event_date,
                      CONVERT(MIN(e.location) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS event_location,
                      MAX(CASE WHEN e.description = 'Synthetic monthly attendance record.' THEN 1 ELSE 0 END) AS is_csv_synthetic,
                      1 AS is_scheduled
               FROM events e
               JOIN participants p ON p.id = ?
               WHERE (
                   e.is_sample = FALSE
                   OR (p.participant_type = 'sponsored_child'
                     AND e.description = 'Synthetic monthly attendance record.')
                 )
                 AND e.status = 'completed'
                 AND DATE(e.starts_at) >= DATE(COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at))
                 AND e.starts_at < NOW()
               GROUP BY LOWER(TRIM(e.name)), DATE(e.starts_at)
      ) occurrence
    )
  `;
}

async function loadParticipantDetailHistory(participantId, options) {
  const [[participantRow]] = await pool.execute(
    `SELECT p.* FROM participants p
     WHERE p.id = ? AND p.status <> 'deleted'
     LIMIT 1`,
    [participantId],
  );
  if (!participantRow) return null;
  const participant = participantView(participantRow);
  const registrationDate = participant.participant_type === 'sponsored_child'
    ? participant.sponsorship_registered_at || participant.sponsorship_start_date || participant.created_at
    : participant.created_at;
  const [educationRows] = await pool.execute(
    `SELECT id, education_level, school_name_encrypted, school_address_encrypted,
            start_year, end_year, status, course_strand_encrypted, notes_encrypted
     FROM participant_education_history
     WHERE participant_id = ? ORDER BY start_year DESC, id DESC`,
    [participantId],
  );
  const educationHistory = educationRows.map(educationHistoryView);
  const [historicalAttendanceRows] = await pool.execute(
    `SELECT attendance_year, required_count, attended_count, absent_count
     FROM participant_attendance_summaries
     WHERE participant_id = ? ORDER BY attendance_year DESC`,
    [participantId],
  );
  const [statusRows] = await pool.execute(
    `SELECT status_type, previous_status, current_status, changed_at
     FROM participant_status_history
     WHERE participant_id = ? AND status_type = 'participant'
     ORDER BY changed_at ASC, id ASC`,
    [participantId],
  );
  const occurrenceSubquery = participantOccurrenceSubquery();
  await attendanceImportColumnsReady;
  const occurrenceParams = [participantId, participantId, participantId, participantId];
  const [attendanceGroups] = await pool.execute(
    `SELECT YEAR(event_date) AS year, MONTH(event_date) AS month,
            SUM(is_scheduled) AS total_events,
            SUM(is_scheduled = 1 AND is_attended = 1) AS total_attended,
            SUM(is_scheduled = 1 AND is_csv_synthetic = 1) AS csv_synthetic_events
     FROM ${occurrenceSubquery} event_rows
     GROUP BY YEAR(event_date), MONTH(event_date)
     ORDER BY year, month`,
    occurrenceParams,
  );
  const attendanceHistory = buildAttendanceHistory({
    registrationDate,
    asOf: new Date(),
    groupedRows: attendanceGroups,
    trendYear: options.trendYear || options.year,
  });
  const {
    attendanceByYear,
    attendanceByMonth,
    totalEvents,
    totalAttended,
    totalAbsences,
    attendanceRate,
    csvSyntheticEvents,
    source: attendanceSource,
  } = attendanceHistory;
  const attendanceWhere = [];
  const attendanceParams = [...occurrenceParams];
  if (options.year) {
    attendanceWhere.push('YEAR(event_date) = ?');
    attendanceParams.push(options.year);
  }
  if (options.month) {
    attendanceWhere.push('MONTH(event_date) = ?');
    attendanceParams.push(options.month);
  }
  if (options.event) {
    attendanceWhere.push('event_name = ?');
    attendanceParams.push(options.event);
  }
  if (options.status === 'attended') attendanceWhere.push('is_attended = 1');
  if (options.status === 'missed') attendanceWhere.push('is_attended = 0');
  const attendanceFilter = attendanceWhere.length ? `WHERE ${attendanceWhere.join(' AND ')}` : '';
  const [attendanceCountRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM ${occurrenceSubquery} event_rows ${attendanceFilter}`,
    attendanceParams,
  );
  const [attendanceRows] = await pool.execute(
    `SELECT event_name, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
            is_attended, attended_at, location, is_csv_synthetic
     FROM ${occurrenceSubquery} event_rows ${attendanceFilter}
     ORDER BY event_date DESC, event_name ASC
     LIMIT ? OFFSET ?`,
    [...attendanceParams, options.pageSize, (options.page - 1) * options.pageSize],
  );
  const [eventRows] = await pool.execute(
    `SELECT DISTINCT event_name
     FROM ${occurrenceSubquery} event_rows
     ORDER BY event_name`,
    occurrenceParams,
  );
  const [recentAttendanceRows] = await pool.execute(
    `SELECT event_name, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
            is_attended, attended_at, location, is_csv_synthetic
     FROM ${occurrenceSubquery} event_rows
     ORDER BY event_date DESC, event_name ASC
     LIMIT 5`,
    occurrenceParams,
  );
  const careTimelineRows = options.includeCareHistory
    ? `
      UNION ALL
      SELECT updates.recorded_on,
             CONVERT('care' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
             CONVERT(CONCAT('Sponsored Child update recorded: ', updates.update_type) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
             CONVERT(JSON_OBJECT(
               'activity', updates.activity_encrypted,
               'height', updates.height_encrypted,
               'weight', updates.weight_encrypted,
               'note', updates.note_encrypted
             ) USING utf8mb4) COLLATE utf8mb4_unicode_ci
      FROM sponsored_child_updates updates
      WHERE updates.participant_id = ?
      UNION ALL
      SELECT status_change.created_at,
             CONVERT('status' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
             CONVERT(CONCAT('Sponsorship status changed: ', status_change.current_status) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
             CONVERT(CONCAT(status_change.previous_status, ' → ', status_change.current_status,
               CASE WHEN status_change.reason IS NULL OR status_change.reason = ''
                 THEN '' ELSE CONCAT(' · ', status_change.reason) END) USING utf8mb4) COLLATE utf8mb4_unicode_ci
      FROM sponsored_child_participation_history status_change
      WHERE status_change.participant_id = ?
    `
    : '';
  const educationTimelineRows = `
    UNION ALL
    SELECT STR_TO_DATE(CONCAT(COALESCE(education.end_year, education.start_year), '-01-01'), '%Y-%m-%d'),
           CONVERT('education' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
           CONVERT(CONCAT(
             CASE WHEN education.status = 'Currently Attending' THEN 'Started' ELSE education.status END,
             ' ', education.education_level) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
           CONVERT(education.school_name_encrypted USING utf8mb4) COLLATE utf8mb4_unicode_ci
    FROM participant_education_history education
    WHERE education.participant_id = ?
  `;
  const timelineSubquery = `(
      SELECT p.created_at AS event_at,
             CONVERT('registration' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS event_type,
             CONVERT('Record registered' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
             CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS description
      FROM participants p WHERE p.id = ?
      UNION ALL
      SELECT changed.changed_at,
             CONVERT('status' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
             CONVERT('Record status changed' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
             CONVERT(CONCAT(changed.previous_status, ' → ', changed.current_status) USING utf8mb4) COLLATE utf8mb4_unicode_ci
      FROM participant_status_history changed
      WHERE changed.participant_id = ? AND changed.status_type = 'participant'
      ${careTimelineRows}
      ${educationTimelineRows}
      UNION ALL
      SELECT event_rows.event_date,
             CONVERT('attendance' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
             CONVERT(CASE WHEN event_rows.is_csv_synthetic = 1
               THEN CONCAT('[CSV synthetic] ', CASE WHEN event_rows.is_attended = 0
                 THEN CONCAT('Missed ', event_rows.event_name)
                 ELSE CONCAT('Attended ', event_rows.event_name) END)
               ELSE CASE WHEN event_rows.is_attended = 0
                 THEN CONCAT('Missed ', event_rows.event_name)
                 ELSE CONCAT('Attended ', event_rows.event_name) END END USING utf8mb4) COLLATE utf8mb4_unicode_ci,
             CONVERT(CASE WHEN event_rows.is_attended = 0
               THEN 'No check-in record'
               WHEN event_rows.attended_at IS NULL THEN 'Present; check-in time was not supplied'
               ELSE CONCAT('Checked in at ', DATE_FORMAT(event_rows.attended_at, '%h:%i %p')) END USING utf8mb4) COLLATE utf8mb4_unicode_ci
      FROM ${occurrenceSubquery} event_rows
    )`;
  const timelineParams = [
    participantId,
    participantId,
    ...(options.includeCareHistory ? [participantId] : []),
    ...(options.includeCareHistory ? [participantId] : []),
    participantId,
    ...occurrenceParams,
  ];
  const [timelineCountRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM ${timelineSubquery} timeline_rows`,
    timelineParams,
  );
  const [timelineRows] = await pool.execute(
    `SELECT event_at, event_type, title, description
     FROM ${timelineSubquery} timeline_rows
     ORDER BY event_at DESC, title ASC
     LIMIT ? OFFSET ?`,
    [...timelineParams, options.historyPageSize, (options.historyPage - 1) * options.historyPageSize],
  );
  const initialStatus = statusRows[0]?.previous_status
    || (participant.participant_type === 'sponsored_child'
      ? participant.participation_status
      : participant.status)
    || 'unknown';
  return {
    participant: {
      id: participant.id,
      participantCode: participant.participant_code || '',
      name: participant.fullName || (participant.participantType === 'sponsored_child'
        ? 'Unnamed sponsored child'
        : 'Unnamed Church Goer'),
      participantType: participant.participantType,
      status: participant.participant_type === 'sponsored_child'
        ? participant.participation_status || 'ACTIVE'
        : participant.status || 'unknown',
      age: Number.isFinite(participant.age) ? participant.age : null,
      dateOfBirth: participant.dateOfBirth || null,
      registrationDate: registrationDate || null,
      initialStatus,
      gender: participant.gender || '',
      educationLevel: participant.educationLevel || '',
      gradeLevel: participant.gradeLevel || '',
      programCourse: participant.programCourse || '',
      schoolName: participant.schoolName || '',
      schoolAddress: participant.schoolAddress || '',
      sponsorshipRegistrationDate: participant.sponsorship_registered_at || participant.sponsorship_start_date || null,
      educationHistory,
      phone: participant.phone || '',
      address: participant.address || '',
      guardianName: participant.emergencyContactName || '',
      emergencyContactPhone: participant.emergencyContactPhone || '',
      medicalConditions: participant.medicalConditions || '',
    },
    summary: {
      totalEvents,
      totalAttended,
      totalAbsences,
      attendanceRate,
      csvSyntheticEvents,
      attendanceSource,
      registrationDate: registrationDate || null,
      sponsorshipRegistrationDate: participant.sponsorship_registered_at || participant.sponsorship_start_date || null,
    },
    attendanceByYear,
    attendanceByMonth,
    historicalAttendanceSummary: historicalAttendanceRows.map((row) => ({
      year: Number(row.attendance_year),
      required: Number(row.required_count),
      attended: Number(row.attended_count),
      absent: Number(row.absent_count),
      attendanceRate: Number(row.required_count)
        ? Math.round((Number(row.attended_count) / Number(row.required_count)) * 1000) / 10
        : 0,
      absenceRate: Number(row.required_count)
        ? Math.round((Number(row.absent_count) / Number(row.required_count)) * 1000) / 10
        : 0,
    })),
    eventOptions: eventRows.map((row) => row.event_name),
    recentAttendance: recentAttendanceRows.map((row) => ({
      event: row.event_name,
      eventDate: row.event_date,
      checkedInAt: row.attended_at,
      location: row.location || '',
      status: row.is_attended ? 'attended' : 'missed',
      source: row.is_csv_synthetic ? 'csv-synthetic' : 'recorded',
    })),
    attendance: {
      records: attendanceRows.map((row) => ({
        event: row.event_name,
        eventDate: row.event_date,
        checkedInAt: row.attended_at,
        location: row.location || '',
        status: row.is_attended ? 'attended' : 'missed',
        source: row.is_csv_synthetic ? 'csv-synthetic' : 'recorded',
      })),
      page: options.page,
      pageSize: options.pageSize,
      total: Number(attendanceCountRows[0]?.total) || 0,
    },
    statusHistory: statusRows.map((row) => ({
      statusType: row.status_type,
      previousStatus: row.previous_status,
      currentStatus: row.current_status,
      changedAt: row.changed_at,
    })),
    history: {
      records: timelineRows.map((row) => ({
        eventAt: row.event_at,
        type: row.event_type,
        title: row.title,
        description: row.event_type === 'education'
          ? decrypt(row.description) || ''
          : row.event_type === 'care'
            ? (() => {
              const details = JSON.parse(row.description || '{}');
              return [
                decrypt(details.activity),
                details.height ? `Height: ${decrypt(details.height)} cm` : '',
                details.weight ? `Weight: ${decrypt(details.weight)} kg` : '',
                decrypt(details.note),
              ].filter(Boolean).join(' · ');
            })()
            : row.description || '',
      })),
      page: options.historyPage,
      pageSize: options.historyPageSize,
      total: Number(timelineCountRows[0]?.total) || 0,
    },
  };
}

async function computeParticipantHistory(participantId) {
  await Promise.all([participantProfileColumnsReady, eventsTableReady, participationTrackingReady]);
  const [[participant]] = await pool.execute(
    `SELECT id, participant_code, full_name_encrypted, participant_type, grade_level, education_level,
            COALESCE(sponsorship_registered_at, sponsorship_start_date, created_at) AS registration_date,
            status AS participant_status, participation_status
     FROM participants WHERE id = ? AND status <> 'deleted' LIMIT 1`,
    [participantId],
  );
  if (!participant || participant.participant_type !== 'sponsored_child') return null;
  const start = participant.registration_date
    ? new Date(participant.registration_date)
    : new Date('1900-01-01T00:00:00');
  const end = new Date();
  const range = {
    start,
    end,
    endExclusive: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1),
  };
  const data = await loadSponsoredAttendanceData({
    range,
    educationLevel: participant.education_level,
    participantId,
    interval: 'month',
  });
  const child = data.analytics.participants[0];
  if (!child) return null;
  const attendance = data.occurrences.map((row) => ({
    eventId: row.eventId,
    eventName: row.eventName,
    startsAt: row.startsAt,
    status: Number(row.present) ? 'present' : 'absent',
  }));
  const yearlyMap = new Map();
  for (const month of child.months) {
    const yearly = yearlyMap.get(month.year) || { year: month.year, scheduled: 0, present: 0, absent: 0 };
    yearly.scheduled += month.scheduled;
    yearly.present += month.present;
    yearly.absent += month.absent;
    yearlyMap.set(month.year, yearly);
  }
  const yearly = [...yearlyMap.values()]
    .sort((first, second) => second.year - first.year)
    .map((item) => ({
      ...item,
      attendanceRate: item.scheduled ? roundRate((item.present / item.scheduled) * 100) : null,
    }));
  const lastCheckIn = attendance
    .filter((row) => row.status === 'present')
    .reduce((latest, row) => !latest || row.startsAt > latest ? row.startsAt : latest, null);
  const firstCheckIn = attendance
    .filter((row) => row.status === 'present')
    .reduce((earliest, row) => !earliest || row.startsAt < earliest ? row.startsAt : earliest, null);
  const summaries = await getSponsoredParticipationSummaries(participantId, { recordThresholdHistory: false });
  const currentStatus = String(participant.participant_status || '').toUpperCase() === 'INACTIVE'
    || participant.participation_status === 'INACTIVE'
    ? 'INACTIVE'
    : summaries[0]?.status || participant.participation_status || 'ACTIVE';
  return {
    participant: {
      id: participant.id,
      participantCode: participant.participant_code,
      name: decrypt(participant.full_name_encrypted) || 'Unnamed sponsored child',
      participantType: 'sponsored_child',
      gradeLevel: participant.grade_level || '',
      educationLevel: participant.education_level || '',
      registrationDate: participant.registration_date,
      status: currentStatus,
    },
    summary: {
      totalScheduledEvents: child.scheduled,
      totalPresent: child.present,
      totalAbsent: child.absent,
      attendanceRate: child.attendanceRate,
      totalCheckIns: child.present,
      uniqueEvents: child.scheduled,
      lastCheckIn,
      firstCheckIn,
    },
    monthly: child.months,
    yearly,
    attendance,
  };
}

function encryptExportPayload(content, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(content), 'utf8'), cipher.final()]);
  return JSON.stringify({
    format: ENCRYPTED_EXPORT_FORMAT,
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'pbkdf2-sha256-100000',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }, null, 2);
}

function sendReport(res, filename, content, password) {
  if (password) {
    return res.type('application/json').attachment(`${filename}.enc`).send(encryptExportPayload(content, password));
  }
  if (filename.endsWith('.pdf')) {
    return res.type('application/pdf').attachment(filename).send(content);
  }
  return res.type('text/csv').attachment(filename).send(content);
}

function renderPdf(build) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument();
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function csvPayload(fields, rows) {
  return new Parser({ fields }).parse(rows);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

app.get('/api/analytics/overview', authenticate, checkPermission('analytics:view'), async (req, res, next) => {
  try {
    const range = analyticsDateRange(req);
    if (!range) return res.status(400).json({ error: 'Enter a valid date range' });
    const educationLevel = normalizeAnalyticsEducation(req.query.educationLevel);
    const status = normalizeAnalyticsStatus(req.query.status);
    const eventId = String(req.query.event || '').trim();
    const data = await loadSponsoredAttendanceData({
      range,
      educationLevel,
      status,
      eventId,
      interval: 'month',
    });
    const totalScheduledRecords = data.analytics.participants
      .reduce((sum, participant) => sum + participant.scheduled, 0);
    const totalPresentRecords = data.analytics.participants
      .reduce((sum, participant) => sum + participant.present, 0);
    const atRiskRecords = await computeRiskRecords('all', { range, educationLevel, status, eventId });
    const atRiskBreakdown = summarizeAtRiskParticipants(data.participants, atRiskRecords);
    const statusCounts = data.participants.reduce((counts, participant) => {
      const key = participant.participationStatus;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    res.json({
      from: localDayKey(range.start),
      to: localDayKey(range.end),
      educationLevel,
      status,
      totalParticipants: data.participants.length,
      totalScheduledRecords,
      totalPresentRecords,
      totalAbsentRecords: totalScheduledRecords - totalPresentRecords,
      totalCheckIns: totalPresentRecords,
      uniqueParticipants: data.analytics.participants.filter((participant) => participant.present > 0).length,
      attendanceRate: totalScheduledRecords
        ? roundRate((totalPresentRecords / totalScheduledRecords) * 100)
        : null,
      atRiskChildren: atRiskBreakdown.total,
      atRiskBreakdown,
      statusCounts,
      educationComparison: data.analytics.educationComparison,
    });
  } catch (error) { next(error); }
});

app.get('/api/analytics/data', authenticate, checkPermission('analytics:view'), async (req, res, next) => {
  try {
    const range = analyticsDateRange(req);
    if (!range) return res.status(400).json({ error: 'Enter a valid date range' });
    const interval = normalizeInterval(req.query.interval);
    const educationLevel = normalizeAnalyticsEducation(req.query.educationLevel);
    const status = normalizeAnalyticsStatus(req.query.status);
    const eventId = String(req.query.event || '').trim();
    const riskFilter = normalizeRiskFilter(req.query.riskLevel);
    const data = await loadSponsoredAttendanceData({
      range,
      educationLevel,
      status,
      eventId,
      interval,
    });
    const allRiskRecords = await computeRiskRecords('all', { educationLevel, status });
    const riskRecords = allRiskRecords.filter((row) => riskFilter === 'all' || row.riskLevel === riskFilter);
    const atRiskBreakdown = summarizeAtRiskParticipants(data.participants, allRiskRecords);
    const riskSummary = allRiskRecords.reduce((summary, row) => {
      summary.evaluated += 1;
      if (row.riskLevel === 'high') summary.high += 1;
      else if (row.riskLevel === 'medium') summary.medium += 1;
      else if (row.riskLevel === 'low') summary.low += 1;
      else summary.insufficient += 1;
      return summary;
    }, { evaluated: 0, high: 0, medium: 0, low: 0, insufficient: 0 });
    const totalScheduledRecords = data.analytics.participants
      .reduce((sum, participant) => sum + participant.scheduled, 0);
    const totalPresentRecords = data.analytics.participants
      .reduce((sum, participant) => sum + participant.present, 0);
    const statusCounts = data.participants.reduce((counts, participant) => {
      const key = participant.participationStatus;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    res.json({
      overview: {
        from: localDayKey(range.start),
        to: localDayKey(range.end),
        educationLevel,
        status,
        totalParticipants: data.participants.length,
        totalScheduledRecords,
        totalPresentRecords,
        totalAbsentRecords: totalScheduledRecords - totalPresentRecords,
        totalCheckIns: totalPresentRecords,
        uniqueParticipants: data.analytics.participants.filter((participant) => participant.present > 0).length,
        attendanceRate: totalScheduledRecords
          ? roundRate((totalPresentRecords / totalScheduledRecords) * 100)
          : null,
        atRiskChildren: atRiskBreakdown.total,
        atRiskBreakdown,
        statusCounts,
        educationComparison: data.analytics.educationComparison,
      },
      trends: {
        interval,
        eventId: eventId || null,
        events: data.events.map((event) => ({ id: event.id, name: event.name, startsAt: event.starts_at })),
        records: data.analytics.records,
      },
      participants: data.analytics.participants,
      riskRecords,
      riskSummary,
    });
  } catch (error) { next(error); }
});

app.get('/api/analytics/trends', authenticate, checkPermission('analytics:view'), async (req, res, next) => {
  try {
    const range = analyticsDateRange(req);
    if (!range) return res.status(400).json({ error: 'Enter a valid date range' });
    res.json(await computeAttendanceTrends(
      range,
      normalizeInterval(req.query.interval),
      String(req.query.event || '').trim(),
      {
        educationLevel: req.query.educationLevel,
        status: normalizeAnalyticsStatus(req.query.status),
      },
    ));
  } catch (error) { next(error); }
});

app.get('/api/analytics/risk', authenticate, checkPermission('analytics:view'), async (req, res, next) => {
  try {
    res.json({
      records: await computeRiskRecords(normalizeRiskFilter(req.query.riskLevel), {
        educationLevel: req.query.educationLevel,
        status: normalizeAnalyticsStatus(req.query.status),
      }),
    });
  } catch (error) { next(error); }
});

app.get('/api/analytics/risk/:participantId', authenticate, checkPermission('analytics:view'), async (req, res, next) => {
  try {
    const participantId = Number(req.params.participantId);
    if (!Number.isSafeInteger(participantId) || participantId <= 0) {
      return res.status(400).json({ error: 'Enter a valid sponsored child ID' });
    }
    const [children, settings] = await Promise.all([
      loadPredictionAttendanceData({ participantId }),
      loadAttendanceRiskSettings(),
    ]);
    const child = children[0];
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    const { events, ...identity } = child;
    res.json({
      ...identity,
      ...buildAttendanceRiskAssessment(events, settings),
      assessmentMethod: 'rule_based',
    });
  } catch (error) { next(error); }
});

app.get('/api/analytics/participants', authenticate, checkPermission('analytics:view'), async (req, res, next) => {
  try {
    const range = analyticsDateRange(req);
    if (!range) return res.status(400).json({ error: 'Enter a valid date range' });
    const data = await loadSponsoredAttendanceData({
      range,
      educationLevel: req.query.educationLevel,
      status: normalizeAnalyticsStatus(req.query.status),
      eventId: String(req.query.event || '').trim(),
      interval: 'month',
    });
    res.json({
      records: data.analytics.participants.map((participant) => ({
        ...participant,
        registrationDate: data.participants.find((row) => row.id === participant.id)?.registrationDate || null,
        participationStatus: data.participants.find((row) => row.id === participant.id)?.participationStatus || 'ACTIVE',
        secondChance: data.participants.find((row) => row.id === participant.id)?.secondChance || false,
        inactiveReason: data.participants.find((row) => row.id === participant.id)?.inactiveReason || '',
      })),
    });
  } catch (error) { next(error); }
});

app.get('/api/analytics/sponsored-children', authenticate, checkPermission('analytics:view'), checkPermission('sponsorship:view'), async (req, res, next) => {
  try {
    res.json({ records: await computeSponsoredChildren({
      range: analyticsDateRange(req),
      educationLevel: String(req.query.educationLevel || '').trim(),
      gradeLevel: String(req.query.gradeLevel || '').trim(),
      participationStatus: String(req.query.participationStatus || '').trim(),
      eventId: String(req.query.event || '').trim(),
      riskLevel: normalizeRiskFilter(req.query.riskLevel),
    }) });
  } catch (error) { next(error); }
});

app.get('/api/analytics/participants/:id/history', authenticate, checkPermission('analytics:view'), async (req, res, next) => {
  try {
    const participantId = Number(req.params.id);
    if (!Number.isSafeInteger(participantId) || participantId < 1) {
      return res.status(400).json({ error: 'Select a valid sponsored child' });
    }
    const history = await computeParticipantHistory(participantId);
    if (!history) return res.status(404).json({ error: 'Sponsored child not found' });
    res.json(history);
  } catch (error) { next(error); }
});

app.get('/api/reports/analytics-attendance', authenticate, checkPermission('reports:view'), async (req, res, next) => {
  try {
    const range = analyticsDateRange(req);
    if (!range) return res.status(400).json({ error: 'Enter a valid date range' });
    const interval = normalizeInterval(req.query.interval);
    const eventId = String(req.query.event || '').trim();
    const password = req.query.password ? String(req.query.password) : '';
    const trends = await computeAttendanceTrends(range, interval, eventId, {
      educationLevel: req.query.educationLevel,
      status: normalizeAnalyticsStatus(req.query.status),
    });
    const totals = trends.records.reduce((sum, row) => ({
      scheduled: sum.scheduled + row.scheduled,
      present: sum.present + row.present,
      absent: sum.absent + row.absent,
    }), { scheduled: 0, present: 0, absent: 0 });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `attendance-summary-${interval}-${stamp}`;
    if (req.query.format === 'pdf') {
      const pdf = await renderPdf((doc) => {
        doc.fontSize(18).text('Attendance Summary Report');
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`);
        doc.text(`Range: ${localDayKey(range.start)} to ${localDayKey(range.end)} · Interval: ${interval}${eventId ? ` · Event ID: ${eventId}` : ''}`);
        doc.moveDown();
        doc.fontSize(11).text('Period · Scheduled sponsored child events · Present · Absent · Attendance rate');
        trends.records.forEach((row) => {
          doc.fontSize(9).text(`${row.label} | ${row.scheduled} | ${row.present} | ${row.absent} | ${row.attendanceRate == null ? 'N/A' : `${row.attendanceRate}%`}`);
        });
        doc.moveDown();
        doc.fontSize(10).text(`Totals: ${totals.scheduled} scheduled · ${totals.present} present · ${totals.absent} absent · attendance rate ${totals.scheduled ? `${roundRate((totals.present / totals.scheduled) * 100)}%` : 'N/A'}`);
      });
      return sendReport(res, `${filename}.pdf`, pdf, password);
    }
    return sendReport(
      res,
      `${filename}.csv`,
      csvPayload(
        ['label', 'scheduled', 'present', 'absent', 'attendanceRate'],
        trends.records,
      ),
      password,
    );
  } catch (error) { next(error); }
});

app.get('/api/reports/at-risk', authenticate, checkPermission('reports:view'), checkPermission('analytics:view'), async (req, res, next) => {
  try {
    const riskLevel = normalizeRiskFilter(req.query.riskLevel);
    const password = req.query.password ? String(req.query.password) : '';
    const records = await computeRiskRecords(riskLevel, {
      educationLevel: req.query.educationLevel,
      status: normalizeAnalyticsStatus(req.query.status),
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `at-risk-sponsored-children-${riskLevel}-${stamp}`;
    if (req.query.format === 'pdf') {
      const pdf = await renderPdf((doc) => {
        doc.fontSize(18).text('At-Risk Sponsored Child Report');
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()} · Risk level filter: ${riskLevel}`);
        doc.moveDown();
        doc.fontSize(11).text('Sponsored Child · Education · Attendance rate · Rule-based score · Pattern · Risk level · Recommendation');
        records.forEach((row) => {
          doc.fontSize(9).text(`${row.participantName} (ID ${row.participantId}) | ${row.educationLevel || '—'} | ${row.attendanceRate == null ? 'N/A' : `${row.attendanceRate}%`} | ${row.riskScore == null ? 'Insufficient data' : `${row.riskScore}/100`} | ${row.pattern} | ${row.riskLevel} | ${row.recommendedAction}`);
        });
        doc.moveDown();
        doc.fontSize(10).text('Risk scores are decision-support information and require staff review. They are not a sole basis for decisions about a child.');
      });
      return sendReport(res, `${filename}.pdf`, pdf, password);
    }
    return sendReport(
      res,
      `${filename}.csv`,
      csvPayload(
        ['sponsoredChildId', 'sponsoredChildCode', 'name', 'educationLevel', 'registrationDate', 'participationStatus', 'scheduledEvents', 'recordedEvents', 'present', 'absent', 'unrecorded', 'attendanceRate', 'absenceRate', 'attendanceFrequency', 'recentAttendancePattern', 'riskScore', 'riskLevel', 'assessmentMethod', 'insufficientData', 'consecutiveAbsences', 'recencyDays', 'recommendedAction'],
        records.map((row) => ({
          sponsoredChildId: row.participantId,
          sponsoredChildCode: row.participantCode,
          name: row.participantName,
          educationLevel: row.educationLevel,
          registrationDate: row.registrationDate,
          participationStatus: row.participationStatus,
          scheduledEvents: row.scheduledEvents,
          recordedEvents: row.recordedEvents,
          present: row.present,
          absent: row.absent,
          unrecorded: row.unrecorded,
          attendanceRate: row.attendanceRate,
          absenceRate: row.absenceRate,
          attendanceFrequency: row.attendanceFrequency,
          recentAttendancePattern: row.pattern,
          riskScore: row.riskScore,
          riskLevel: row.riskLevel,
          assessmentMethod: row.assessmentMethod,
          insufficientData: row.insufficientData,
          consecutiveAbsences: row.consecutiveAbsences,
          recencyDays: row.recencyDays,
          recommendedAction: row.recommendedAction,
        })),
      ),
      password,
    );
  } catch (error) { next(error); }
});

app.get('/api/reports/participant-history', authenticate, checkPermission('reports:view'), checkPermission('analytics:view'), async (req, res, next) => {
  try {
    const participantId = Number(req.query.participantId);
    if (!Number.isSafeInteger(participantId) || participantId < 1) {
      return res.status(400).json({ error: 'Select a valid sponsored child' });
    }
    const password = req.query.password ? String(req.query.password) : '';
    const history = await computeParticipantHistory(participantId);
    if (!history) return res.status(404).json({ error: 'Sponsored child not found' });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `sponsored-child-history-${history.participant.participantCode}-${stamp}`;
    if (req.query.format === 'pdf') {
      const pdf = await renderPdf((doc) => {
        doc.fontSize(18).text('Sponsored Child Attendance History');
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`);
        doc.moveDown();
        doc.fontSize(11).text(`${history.participant.name} (${history.participant.participantCode})`);
        doc.fontSize(9).text(`ID: ${history.participant.id} · Education: ${history.participant.educationLevel || '—'} · Registered: ${formatDateTime(history.participant.registrationDate)} · Status: ${history.participant.status}`);
        doc.fontSize(9).text(`Scheduled: ${history.summary.totalScheduledEvents} · Present: ${history.summary.totalPresent} · Absent: ${history.summary.totalAbsent} · Rate: ${history.summary.attendanceRate == null ? 'N/A' : `${history.summary.attendanceRate}%`}`);
        doc.moveDown();
        doc.fontSize(11).text('Monthly summaries');
        history.monthly.forEach((row) => {
          doc.fontSize(9).text(`${row.key} | Scheduled ${row.scheduled} | Present ${row.present} | Absent ${row.absent} | Rate ${row.attendanceRate == null ? 'N/A' : `${row.attendanceRate}%`}`);
        });
        doc.moveDown();
        doc.fontSize(11).text('Yearly summaries');
        history.yearly.forEach((row) => {
          doc.fontSize(9).text(`${row.year} | Scheduled ${row.scheduled} | Present ${row.present} | Absent ${row.absent} | Rate ${row.attendanceRate == null ? 'N/A' : `${row.attendanceRate}%`}`);
        });
        doc.moveDown();
        doc.fontSize(11).text('Completed event · Present / Absent');
        history.attendance.forEach((row) => {
          doc.fontSize(9).text(`${formatDateTime(row.startsAt)} | ${row.eventName} | ${row.status}`);
        });
      });
      return sendReport(res, `${filename}.pdf`, pdf, password);
    }
    return sendReport(
      res,
      `${filename}.csv`,
      csvPayload(
        ['recordType', 'sponsoredChildId', 'sponsoredChildCode', 'name', 'educationLevel', 'registrationDate', 'period', 'scheduled', 'present', 'absent', 'attendanceRate', 'eventDate', 'eventName', 'attendanceStatus'],
        [
          {
            recordType: 'overall',
            sponsoredChildId: history.participant.id,
            sponsoredChildCode: history.participant.participantCode,
            name: history.participant.name,
            educationLevel: history.participant.educationLevel,
            registrationDate: history.participant.registrationDate,
            period: 'All history',
            scheduled: history.summary.totalScheduledEvents,
            present: history.summary.totalPresent,
            absent: history.summary.totalAbsent,
            attendanceRate: history.summary.attendanceRate ?? 'N/A',
            attendanceStatus: history.participant.status,
          },
          ...history.monthly.map((row) => ({
            recordType: 'monthly',
            sponsoredChildId: history.participant.id,
            sponsoredChildCode: history.participant.participantCode,
            name: history.participant.name,
            educationLevel: history.participant.educationLevel,
            registrationDate: history.participant.registrationDate,
            period: row.key,
            scheduled: row.scheduled,
            present: row.present,
            absent: row.absent,
            attendanceRate: row.attendanceRate ?? 'N/A',
            attendanceStatus: history.participant.status,
          })),
          ...history.yearly.map((row) => ({
            recordType: 'yearly',
            sponsoredChildId: history.participant.id,
            sponsoredChildCode: history.participant.participantCode,
            name: history.participant.name,
            educationLevel: history.participant.educationLevel,
            registrationDate: history.participant.registrationDate,
            period: row.year,
            scheduled: row.scheduled,
            present: row.present,
            absent: row.absent,
            attendanceRate: row.attendanceRate ?? 'N/A',
            attendanceStatus: history.participant.status,
          })),
          ...history.attendance.map((row) => ({
            recordType: 'event',
            sponsoredChildId: history.participant.id,
            sponsoredChildCode: history.participant.participantCode,
            name: history.participant.name,
            educationLevel: history.participant.educationLevel,
            registrationDate: history.participant.registrationDate,
            eventDate: row.startsAt,
            eventName: row.eventName,
            attendanceStatus: row.status,
          })),
        ],
      ),
      password,
    );
  } catch (error) { next(error); }
});

app.get('/api/reports/audit-trail', authenticate, checkPermission('reports:view'), checkRole(['System Administrator']), async (req, res, next) => {
  try {
    await auditTableReady;
    const from = parseAnalyticsDate(req.query.from);
    const to = parseAnalyticsDate(req.query.to);
    const clauses = [];
    const params = [];
    if (from) { clauses.push('created_at >= ?'); params.push(from); }
    if (to) { clauses.push('created_at < ?'); params.push(new Date(to.getTime() + 24 * 60 * 60 * 1000)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [entries] = await pool.execute(
      `SELECT id, user_id, username, role, action, entity_type, entity_id, details, created_at
       FROM audit_logs ${where}
       ORDER BY created_at DESC, id DESC LIMIT 5000`,
      params,
    );
    const password = req.query.password ? String(req.query.password) : '';
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `audit-trail-${stamp}`;
    const rows = entries.map((entry) => ({
      id: entry.id,
      timestamp: entry.created_at,
      username: entry.username,
      role: entry.role,
      action: entry.action,
      entityType: entry.entity_type,
      entityId: entry.entity_id,
      details: entry.details ? JSON.stringify(entry.details) : '',
    }));
    if (req.query.format === 'pdf') {
      const pdf = await renderPdf((doc) => {
        doc.fontSize(18).text('System Audit Trail');
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()} · Entries: ${rows.length}`);
        doc.moveDown();
        doc.fontSize(11).text('Timestamp · User · Role · Action · Entity');
        rows.forEach((row) => {
          doc.fontSize(8).text(`${formatDateTime(row.timestamp)} | ${row.username} | ${row.role} | ${row.action} | ${row.entityType} ${row.entityId || ''}`);
        });
      });
      return sendReport(res, `${filename}.pdf`, pdf, password);
    }
    return sendReport(res, `${filename}.csv`, csvPayload(['id', 'timestamp', 'username', 'role', 'action', 'entityType', 'entityId', 'details'], rows), password);
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'Internal server error' }); });

cron.schedule('23 * * * *', () => {
  pool.execute(
    'DELETE FROM security_rate_limits WHERE window_started_at < DATE_SUB(NOW(), INTERVAL 1 DAY)',
  ).catch((error) => console.error('Failed to clean expired security rate-limit records:', error));
  pool.execute(
    'DELETE FROM auth_sessions WHERE expires_at <= NOW() OR absolute_expires_at <= NOW()',
  ).catch((error) => console.error('Failed to clean expired authentication sessions:', error));
});

const port = Number(process.env.PORT || 3000);
const certPath = process.env.HTTPS_CERT_PATH;
const keyPath = process.env.HTTPS_KEY_PATH;
const server = certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)
  ? https.createServer({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      minVersion: isProduction ? 'TLSv1.3' : process.env.HTTPS_MIN_VERSION || 'TLSv1.2',
    }, app)
  : http.createServer(app);
server.listen(port, () => console.log(`${server instanceof https.Server ? 'HTTPS' : 'HTTP'} server listening on port ${port}`));

module.exports = { app, pool, checkRole };
