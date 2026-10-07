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
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');
const mysql = require('mysql2/promise');
const { encrypt, decrypt, decryptBytes, encryptBytes } = require('./utils/encryption');
const { decryptLetter, encryptLetter } = require('./utils/letter-encryption');
const { getAttendanceTransition } = require('./utils/attendance-transition');
const { createParticipantPasscode, isValidParticipantPasscode } = require('./utils/participant-passcode');
const { createPersistentRateLimiter } = require('./utils/persistent-rate-limit');
const { initializeSponsorshipTables } = require('./utils/sponsorship-tables');
const { sendEmailWithResend } = require('./utils/email-delivery');
const {
  GOER_EDUCATION_LEVELS,
  canGoerAccessParticipant,
  canGoerManageCare,
  canGoerUsePermission,
  isGoerRole,
} = require('./utils/goer-access');
const { getProductionSecurityErrors } = require('./utils/security-config');
const {
  BASELINE_VERSION,
  MODEL_VERSION,
  getCurrentAttendanceFeatures,
  predictInactivityProbability,
  scoreAttendanceBaseline,
  validateAttendanceModel,
} = require('./utils/attendance-prediction');

const required = ['JWT_SECRET', 'AES_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const productionSecurityErrors = getProductionSecurityErrors(process.env);
if (productionSecurityErrors.length) {
  throw new Error(`Invalid production security configuration: ${productionSecurityErrors.join('; ')}`);
}
const isProduction = process.env.NODE_ENV === 'production';
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
const eventsTableReady = pool.query(`
  CREATE TABLE IF NOT EXISTS events (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) DEFAULT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME DEFAULT NULL,
    location VARCHAR(100) DEFAULT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
    created_by INT UNSIGNED DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_events_starts_at (starts_at),
    UNIQUE KEY uq_events_name_starts_at (name, starts_at)
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
         'sponsorship_lifecycle', 'monthly_allowance', 'passcode_encrypted',
         'school_name_encrypted', 'school_address_encrypted'
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
    ['sponsorship_lifecycle', "VARCHAR(24) NOT NULL DEFAULT 'active'"],
    ['monthly_allowance', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['passcode_encrypted', 'TEXT DEFAULT NULL'],
    ['school_name_encrypted', 'TEXT DEFAULT NULL'],
    ['school_address_encrypted', 'TEXT DEFAULT NULL'],
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
const attendanceModelValidationReady = pool.query(`
  CREATE TABLE IF NOT EXISTS attendance_model_validation_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    evaluated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    details_json LONGTEXT NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_attendance_model_validation_evaluated (evaluated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
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
const sessions = new Map();
const revokedTokens = new Map();
const emailChallenges = new Map();
const uploadsDir = path.join(__dirname, 'uploads', 'qr_codes');
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(helmet(isProduction
  ? { hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false } }
  : {}));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use((req, res, next) => {
  const hasReceiptUpload = req.method === 'POST' &&
    /^\/api\/sponsorship\/children\/\d+\/disbursements$/.test(req.path);
  const hasEventPhotoUpload = req.method === 'POST' &&
    (/^\/api\/events$/.test(req.path) || /^\/api\/events\/\d+\/photos$/.test(req.path));
  express.json({ limit: hasEventPhotoUpload ? '22mb' : hasReceiptUpload ? '6mb' : '1mb' })(req, res, next);
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

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    await legacyRolesReady;
    await staffPermissionsReady;
    const now = Date.now();
    const revokedUntil = revokedTokens.get(token);
    if (revokedUntil) {
      if (revokedUntil > now) return res.status(401).json({ error: 'Session expired' });
      revokedTokens.delete(token);
    }
    const lastActivity = sessions.get(token) || now;
    if (now - lastActivity > 15 * 60 * 1000) {
      sessions.delete(token);
      return res.status(401).json({ error: 'Session expired' });
    }
    const [users] = await pool.execute(
      `SELECT username, email, role, status, access_permissions, goer_education_level,
              first_name, middle_name, last_name
       FROM users WHERE id = ? LIMIT 1`,
      [payload.id],
    );
    if (!users[0] || users[0].status !== 'active') {
      sessions.delete(token);
      return res.status(401).json({ error: 'Account is inactive or no longer exists' });
    }
    sessions.set(token, now);
    req.user = {
      ...payload,
      username: users[0].username,
      role: users[0].role,
      goerEducationLevel: users[0].goer_education_level,
      firstName: users[0].first_name,
      middleName: users[0].middle_name,
      lastName: users[0].last_name,
      permissions: permissionsForUser(users[0]),
    };
    req.user.username = [
      users[0].first_name,
      users[0].middle_name,
      users[0].last_name,
    ].filter(Boolean).join(' ') || users[0].username || users[0].email;
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
  'participants:manage',
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
  (permission) => !permission.startsWith('sponsorship:'),
);

function permissionsForUser(user) {
  if (String(user.role).toLowerCase() === 'system administrator') {
    return STAFF_PERMISSION_KEYS;
  }
  if (isGoerRole(user.role)) {
    return ['checkin:record', 'goer-care:view', 'goer-care:record'];
  }
  if (user.access_permissions === null || user.access_permissions === undefined) {
    return LEGACY_STAFF_PERMISSIONS;
  }
  try {
    const decoded = typeof user.access_permissions === 'string'
      ? JSON.parse(user.access_permissions)
      : user.access_permissions;
    if (!Array.isArray(decoded)) return [];
    return decoded.filter((permission) => STAFF_PERMISSION_KEYS.includes(permission));
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
    (permission === 'participants:view' && permissions.includes('participants:manage')) ||
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

function checkSponsorshipView(req, res, next) {
  const allowed = isGoerRole(req.user?.role)
    ? req.user.permissions?.includes('goer-care:view')
    : hasPermission(req.user, 'sponsorship:view');
  if (!allowed) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
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
const genderOptions = new Set(['Male', 'Female', 'Prefer not to say']);
const gradeLevelsByEducation = {
  Elementary: new Set(['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']),
  'Junior High School': new Set(['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10']),
  'Senior High School': new Set(['Grade 11', 'Grade 12']),
  College: new Set(['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6']),
};

function sponsoredChildEligibilityError(body) {
  if (body.participantType !== 'sponsored_child') return null;
  const dateOfBirth = String(body.dateOfBirth || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return 'A valid date of birth is required for sponsored children';
  }
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
  if (!educationLevels.has(body.educationLevel)) return 'Select an education level for the sponsored child';
  if (!gradeLevelsByEducation[body.educationLevel]?.has(body.gradeLevel)) {
    return 'Select a valid grade or year level for the education level';
  }
  if (body.educationLevel === 'College' && !String(body.programCourse || '').trim()) {
    return 'A college program or course is required';
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

function issueToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m', algorithm: 'HS256' },
  );
}

async function writeAuditLog(user, action, entityType, entityId = null, details = null) {
  await auditTableReady;
  await pool.execute(
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
  const safeDecrypt = (value) => {
    if (!value) return null;
    try {
      return decrypt(value);
    } catch {
      return null;
    }
  };
  for (const [field, encryptedField] of Object.entries({ fullName: 'full_name_encrypted', firstName: 'first_name_encrypted', middleName: 'middle_name_encrypted', lastName: 'last_name_encrypted', dateOfBirth: 'date_of_birth_encrypted', phone: 'phone_encrypted', address: 'address_encrypted', schoolName: 'school_name_encrypted', schoolAddress: 'school_address_encrypted', medicalNotes: 'medical_notes_encrypted', weight: 'weight_encrypted', height: 'height_encrypted', medicalConditions: 'medical_conditions_encrypted', emergencyContactName: 'emergency_contact_name_encrypted', emergencyContactPhone: 'emergency_contact_phone_encrypted', sponsorName: 'sponsor_name_encrypted', sponsorContact: 'sponsor_contact_encrypted', programAffiliation: 'program_affiliation_encrypted', programCourse: 'program_course_encrypted' })) {
    result[field] = safeDecrypt(result[encryptedField]);
    delete result[encryptedField];
  }
  if (!result.firstName || !result.lastName) {
    const legacyName = splitFullName(result.fullName);
    result.firstName ||= legacyName.firstName;
    result.middleName ||= legacyName.middleName;
    result.lastName ||= legacyName.lastName;
  }
  result.fullName = [result.firstName, result.middleName, result.lastName].filter(Boolean).join(' ')
    || result.fullName;
  result.participantType = result.participant_type;
  result.sponsorshipType = result.sponsorship_type;
  result.educationLevel = result.education_level;
  result.gradeLevel = result.grade_level;
  result.enrollmentDate = result.enrollment_date instanceof Date
    ? new Date(result.enrollment_date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : result.enrollment_date;
  return result;
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
    const [[counts]] = await pool.query("SELECT COUNT(*) AS participants, SUM(status = 'active') AS activeParticipants FROM participants");
    const [[checkins]] = await pool.query(
      "SELECT COUNT(*) AS totalCheckins, COALESCE(SUM(p.participant_type = 'goer'),0) AS goerCheckins, COALESCE(SUM(p.participant_type = 'sponsored_child'),0) AS sponsoredCheckins FROM check_in_logs c JOIN participants p ON p.id = c.participant_id WHERE c.checked_in_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND c.status = 'checked_in'"
    );
    const [recentCheckins] = await pool.query("SELECT c.participant_id, p.participant_type, c.event_name, c.location, c.checked_in_at, c.status FROM check_in_logs c JOIN participants p ON p.id = c.participant_id ORDER BY c.checked_in_at DESC LIMIT 8");
    const [atRisk] = await pool.query("SELECT p.id, p.participant_code, r.risk_score, r.risk_level, r.model_version, r.computed_at FROM predictive_risk_scores r JOIN participants p ON p.id = r.participant_id JOIN (SELECT participant_id, MAX(computed_at) AS latest FROM predictive_risk_scores GROUP BY participant_id) latest ON latest.participant_id = r.participant_id AND latest.latest = r.computed_at WHERE r.risk_level IN ('high', 'medium') ORDER BY r.risk_score DESC LIMIT 8");
    res.json({ counts: { ...counts, totalCheckins: checkins.totalCheckins, goerCheckins: checkins.goerCheckins, sponsoredCheckins: checkins.sponsoredCheckins }, recentCheckins, atRisk });
  } catch (error) { next(error); }
});

app.get('/api/participants', authenticate, checkPermission('participants:view'), async (req, res, next) => {
  try { const [rows] = await pool.query("SELECT p.id, p.participant_code, p.participant_type, p.gender, p.status, p.created_at, (SELECT q.qr_code_image FROM qr_codes q WHERE q.participant_id = p.id AND q.status = 'active' ORDER BY q.id DESC LIMIT 1) AS qr_code_image FROM participants p ORDER BY p.id DESC"); res.json(rows); } catch (error) { next(error); }
});

app.get('/api/events', authenticate, checkPermission('events:view'), async (req, res, next) => {
  try {
    await eventPhotosTableReady;
    const [rows] = await pool.query(
      `SELECT e.id, e.name, e.description, e.starts_at, e.ends_at, e.location, e.status, e.created_at,
              (SELECT COUNT(*) FROM event_photos p WHERE p.event_id = e.id) AS photo_count
       FROM events e ORDER BY e.starts_at DESC`,
    );
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/checkin/events', authenticate, checkPermission('checkin:record'), async (req, res, next) => {
  try {
    await eventsTableReady;
    const [rows] = await pool.query(
      'SELECT id, name, starts_at, location FROM events ORDER BY starts_at DESC',
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
        'INSERT INTO events (name, description, starts_at, ends_at, location, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [name, description, startsAt.replace('T', ' '), endsAt ? endsAt.replace('T', ' ') : null, location, req.user.id],
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
      `SELECT e.id, e.name, e.description, e.starts_at, e.ends_at, e.location, e.status, e.created_at,
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
    await eventsTableReady;
    const [[event]] = await pool.execute('SELECT id, name, description, starts_at, ends_at, location, status FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const [attendance] = await pool.execute(
      `SELECT c.id, c.participant_id, p.participant_code, p.participant_type,
              p.full_name_encrypted, p.first_name_encrypted, p.middle_name_encrypted, p.last_name_encrypted,
              c.event_name, c.location, c.checked_in_at, c.checked_out_at, c.status
       FROM check_in_logs c JOIN participants p ON p.id = c.participant_id
       WHERE c.event_name = ? AND c.status = 'checked_in'
       ORDER BY c.checked_in_at ASC`,
      [event.name],
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
    const [rows] = await pool.execute("SELECT p.*, q.qr_code_image, q.qr_uid FROM participants p LEFT JOIN qr_codes q ON q.id = (SELECT q2.id FROM qr_codes q2 WHERE q2.participant_id = p.id AND q2.status = 'active' ORDER BY q2.id DESC LIMIT 1) WHERE p.id = ? LIMIT 1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Participant not found' });
    if (rows[0].qr_code_image && rows[0].qr_uid) {
      const qrFile = path.join(__dirname, rows[0].qr_code_image);
      if (!fs.existsSync(qrFile)) await QRCode.toFile(qrFile, rows[0].qr_uid);
    }
    const participant = participantView(rows[0]);
    delete participant.qr_uid;
    res.json({ participant });
  } catch (error) { next(error); }
});

app.get(
  '/api/participants/:id/passcode',
  authenticate,
  checkRole(['Church Administrator', 'System Administrator']),
  async (req, res, next) => {
    try {
      await participantProfileColumnsReady;
      const [[participant]] = await pool.execute(
        `SELECT participant_type, passcode_encrypted
         FROM participants WHERE id = ? LIMIT 1`,
        [req.params.id],
      );
      if (!participant) return res.status(404).json({ error: 'Participant not found' });
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
    await legacyRolesReady;
    await staffPermissionsReady;
    const email = String(req.body.email || '').trim().toLowerCase();
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    if (!user || user.status !== 'active' || !(await bcrypt.compare(req.body.password || '', user.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
    const token = issueToken(user);
    sessions.set(token, Date.now());
    await pool.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    res.json({ token, user: accountView(user) });
  } catch (error) { next(error); }
});

app.get('/api/goers', authenticate, checkRole(['System Administrator']), async (req, res, next) => {
  try {
    await staffPermissionsReady;
    const [goers] = await pool.execute(
      `SELECT id, username, first_name, middle_name, last_name, email, role, status, access_permissions,
              goer_education_level, created_at
       FROM users WHERE LOWER(role) = 'goer'
       ORDER BY first_name, last_name, email`,
    );
    res.json({
      goers: goers.map((user) => ({
        ...accountView(user),
        status: user.status,
        createdAt: user.created_at,
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
    const [result] = await pool.execute(
      `INSERT INTO users
         (username, first_name, middle_name, last_name, email, password_hash, role, status, access_permissions,
          goer_education_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Goer', 'active', NULL, ?, NOW(), NOW())`,
      [
        `account-${crypto.randomUUID()}`,
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
        role: 'Goer',
        status: 'active',
        permissions: ['checkin:record'],
        goerEducationLevel: educationLevel,
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
              access_permissions, created_at
       FROM users WHERE LOWER(role) = 'church administrator'
       ORDER BY first_name, last_name, email`,
    );
    res.json({ staff: staff.map((user) => ({ ...accountView(user), status: user.status, createdAt: user.created_at })) });
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
    const [result] = await pool.execute(
      `INSERT INTO users
         (username, first_name, middle_name, last_name, email, password_hash, role,
          status, access_permissions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Church Administrator', 'active', ?, NOW(), NOW())`,
      [
        `account-${crypto.randomUUID()}`,
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
        role: 'Church Administrator',
        status: 'active',
        permissions: [...new Set(permissions)],
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
    const [result] = await pool.execute(
      `UPDATE users SET status = ?, updated_at = NOW()
       WHERE id = ? AND LOWER(role) = 'church administrator'`,
      [status, req.params.id],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff account not found' });
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
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
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
    for (const token of sessions.keys()) {
      if (Number(jwt.decode(token)?.id) === Number(account.id)) {
        sessions.delete(token);
        revokedTokens.set(token, Date.now() + 15 * 60_000);
      }
    }
    const token = issueToken(updatedUser);
    sessions.set(token, Date.now());
    res.json({ token, user: accountView(updatedUser) });
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
      process.env.EMAIL_PROVIDER || (isProduction ? 'resend' : 'smtp'),
    ).toLowerCase();
    const emailFrom = emailProvider === 'resend'
      ? process.env.EMAIL_FROM
      : process.env.SMTP_FROM;
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT);
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    if (emailProvider === 'resend') {
      if (!process.env.RESEND_API_KEY || !emailFrom) {
        return res.status(503).json({ error: 'Email verification is not configured. Set RESEND_API_KEY and EMAIL_FROM.' });
      }
    } else if (emailProvider === 'smtp') {
      if (!smtpHost || !Number.isInteger(smtpPort) || !emailFrom || Boolean(smtpUser) !== Boolean(smtpPassword)) {
        return res.status(503).json({ error: 'Email verification is not configured. Set valid SMTP environment variables.' });
      }
    } else {
      return res.status(503).json({ error: 'Email verification provider is invalid. Set EMAIL_PROVIDER to resend or smtp.' });
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
        from: emailFrom,
        to: email,
        subject: 'Verify your FMC Field Care email address',
        text: `Your email verification code is ${code}. It expires in 10 minutes.`,
      };
      if (emailProvider === 'resend') {
        await sendEmailWithResend({
          apiKey: process.env.RESEND_API_KEY,
          ...message,
        });
      } else {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
          ...(smtpUser ? { auth: { user: smtpUser, pass: smtpPassword } } : {}),
        });
        await transporter.sendMail(message);
      }
    } catch (error) {
      emailChallenges.delete(userId);
      console.error('Failed to send account email verification code:', {
        provider: emailProvider,
        code: error.code,
        statusCode: error.statusCode,
        message: error.message,
      });
      return res.status(502).json({
        error: emailProvider === 'resend'
          ? 'Could not send the verification email. Check the Resend API key and verified sender address.'
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

app.post('/api/participants', authenticate, checkPermission('participants:manage'), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await participantProfileColumnsReady;
    await connection.beginTransaction();
    const participantType = req.body.participantType || 'sponsored_child';
    if (participantType !== 'sponsored_child') {
      await connection.rollback();
      return res.status(400).json({ error: 'Participant registration is for sponsored children. Create Goer staff accounts under Manage Accounts.' });
    }
    const nameError = participantNameError(req.body);
    if (nameError) {
      await connection.rollback();
      return res.status(400).json({ error: nameError });
    }
    const gender = String(req.body.gender || '').trim();
    if (gender && !genderOptions.has(gender)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Select a valid gender option' });
    }
    const eligibilityError = sponsoredChildEligibilityError(req.body);
    if (eligibilityError) {
      await connection.rollback();
      return res.status(400).json({ error: eligibilityError });
    }
    const schoolAddress = String(req.body.schoolAddress || '').trim();
    const schoolName = String(req.body.schoolName || '').trim();
    if (schoolName.length > 200) {
      await connection.rollback();
      return res.status(400).json({ error: 'School name must be 200 characters or fewer' });
    }
    if (schoolAddress.length > 500) {
      await connection.rollback();
      return res.status(400).json({ error: 'School address must be 500 characters or fewer' });
    }
    const fullName = [req.body.firstName, req.body.middleName, req.body.lastName]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ');
    const passcode = createParticipantPasscode();
    const participantCode = `FMC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const [result] = await connection.execute(
      'INSERT INTO participants (participant_type, full_name_encrypted, first_name_encrypted, middle_name_encrypted, last_name_encrypted, date_of_birth_encrypted, gender, phone_encrypted, address_encrypted, passcode_hash, passcode_encrypted, medical_conditions_encrypted, weight_encrypted, height_encrypted, emergency_contact_name_encrypted, emergency_contact_phone_encrypted, sponsor_name_encrypted, sponsor_contact_encrypted, sponsorship_type, enrollment_date, program_affiliation_encrypted, education_level, grade_level, program_course_encrypted, school_name_encrypted, school_address_encrypted, status, participant_code, sponsorship_lifecycle, monthly_allowance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())',
      [participantType, encrypt(fullName), encrypt(String(req.body.firstName).trim()), encrypt(String(req.body.middleName || '').trim() || null), encrypt(String(req.body.lastName).trim()), encrypt(req.body.dateOfBirth), gender || null, encrypt(req.body.phone), encrypt(req.body.address), await bcrypt.hash(passcode, 12), encrypt(passcode), encrypt(req.body.medicalConditions), encrypt(req.body.weight), encrypt(req.body.height), encrypt(req.body.emergencyContactName), encrypt(req.body.emergencyContactPhone), encrypt(req.body.sponsorName), encrypt(req.body.sponsorContact), req.body.sponsorshipType || null, req.body.enrollmentDate || null, encrypt(req.body.programAffiliation), req.body.educationLevel, req.body.gradeLevel, encrypt(req.body.programCourse), encrypt(schoolName || null), encrypt(schoolAddress || null), 'active', participantCode, 'new'],
    );
    const uid = crypto.randomUUID();
    const qrPayload = encrypt(uid);
    const filename = `qr_${result.insertId}_${Date.now()}.png`;
    await QRCode.toFile(path.join(uploadsDir, filename), qrPayload);
    await connection.execute('INSERT INTO qr_codes (participant_id, qr_uid, qr_code_image, status, assigned_at, created_by, created_at) VALUES (?, ?, ?, ?, NOW(), ?, NOW())', [result.insertId, qrPayload, `uploads/qr_codes/${filename}`, 'active', req.user.id]);
    await connection.commit();
    await writeAuditLog(req.user, 'participant.created', 'participant', result.insertId);
    res.status(201).json({
      id: result.insertId,
      participantCode,
      qrPayload,
      qrCodeImage: `/uploads/qr_codes/${filename}`,
      ...(passcode ? { passcode } : {}),
    });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

app.put('/api/participants/:id', authenticate, checkPermission('participants:manage'), async (req, res, next) => {
  try {
    await participantProfileColumnsReady;
    const [existingRows] = await pool.execute(
      'SELECT gender, participant_type FROM participants WHERE id = ? LIMIT 1',
      [req.params.id],
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'Participant not found' });
    const participantType = existingRows[0].participant_type;
    if (!['sponsored_child', 'goer'].includes(participantType)) {
      return res.status(400).json({ error: 'Participant type cannot be edited' });
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
    if (
      Object.prototype.hasOwnProperty.call(req.body, 'passcode') &&
      req.body.passcode !== '' &&
      !isValidParticipantPasscode(req.body.passcode)
    ) {
      return res.status(400).json({ error: 'Participant passcode must be exactly 6 digits' });
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
      emergency_contact_name_encrypted: encrypt(req.body.emergencyContactName),
      emergency_contact_phone_encrypted: encrypt(req.body.emergencyContactPhone),
      sponsor_name_encrypted: encrypt(req.body.sponsorName),
      sponsor_contact_encrypted: encrypt(req.body.sponsorContact),
      sponsorship_type: req.body.sponsorshipType || null,
      enrollment_date: req.body.enrollmentDate || null,
      program_affiliation_encrypted: encrypt(req.body.programAffiliation),
      education_level: participantType === 'sponsored_child' ? req.body.educationLevel : null,
      grade_level: participantType === 'sponsored_child' ? req.body.gradeLevel : null,
      program_course_encrypted: participantType === 'sponsored_child' ? encrypt(req.body.programCourse) : null,
      school_name_encrypted: participantType === 'sponsored_child' ? encrypt(schoolName || null) : null,
      school_address_encrypted: participantType === 'sponsored_child' ? encrypt(schoolAddress || null) : null,
      status: req.body.status || 'active',
    };
    if (isValidParticipantPasscode(req.body.passcode)) {
      fields.passcode_hash = await bcrypt.hash(req.body.passcode, 12);
      fields.passcode_encrypted = encrypt(req.body.passcode);
    }

    const updates = Object.keys(fields).map((field) => `${field} = ?`).join(', ');
    const [result] = await pool.execute(`UPDATE participants SET ${updates}, updated_at = NOW() WHERE id = ?`, [...Object.values(fields), req.params.id]);
    await writeAuditLog(req.user, 'participant.updated', 'participant', req.params.id, {
      changedFields: Object.keys(req.body),
    });
    const [rows] = await pool.execute('SELECT * FROM participants WHERE id = ? LIMIT 1', [req.params.id]);
    res.json({ participant: participantView(rows[0]) });
  } catch (error) { next(error); }
});

app.delete('/api/participants/:id', authenticate, checkPermission('participants:manage'), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('UPDATE participants SET status = ?, updated_at = NOW() WHERE id = ?', ['deleted', req.params.id]);
    if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ error: 'Participant not found' }); }
    // Revoke any active QR codes for the participant
    await connection.execute("UPDATE qr_codes SET status = 'revoked', revoked_at = NOW() WHERE participant_id = ?", [req.params.id]);
    await connection.commit();
    await writeAuditLog(req.user, 'participant.deleted', 'participant', req.params.id);
    res.json({ deleted: true });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

app.post('/api/checkin', authenticate, checkPermission('checkin:record'), async (req, res, next) => {
  let connection;
  try {
    await participantProfileColumnsReady;
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
      return res.status(404).json({ error: 'Participant not found for this QR code' });
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

const sponsorshipLifecycleStatuses = new Set(['new', 'active', 'deceased', 'graduated']);
const sponsorshipLetterStatuses = new Set(['open', 'replied', 'closed']);
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
    `SELECT p.id, p.full_name_encrypted, p.participant_code, p.school_name_encrypted,
            p.school_address_encrypted,
            p.sponsorship_status, p.sponsorship_lifecycle, p.monthly_allowance,
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

async function getSponsorshipThreads(participantId) {
  await sponsorshipTablesReady;
  const [threads] = await pool.execute(
    `SELECT id, participant_id, subject, subject_encrypted, status, created_at, updated_at
     FROM sponsorship_letter_threads
     WHERE participant_id = ?
     ORDER BY updated_at DESC
     LIMIT 50`,
    [participantId],
  );
  if (!threads.length) return [];
  const ids = threads.map(({ id }) => id);
  const [messages] = await pool.query(
    `SELECT id, thread_id, sender_type, message, created_at
     FROM sponsorship_letter_messages
     WHERE thread_id IN (${ids.map(() => '?').join(',')})
     ORDER BY created_at ASC, id ASC`,
    ids,
  );
  return threads.map(({ subject_encrypted: encryptedSubject, ...thread }) => ({
    ...thread,
    subject: encryptedSubject ? decryptLetter(encryptedSubject) : thread.subject,
    messages: messages
      .filter((message) => Number(message.thread_id) === Number(thread.id))
      .map((message) => ({ ...message, message: decryptLetter(message.message) })),
  }));
}

async function getAccessibleSponsorshipChild(user, participantId) {
  const [[child]] = await pool.execute(
    `SELECT id, participant_type, education_level, status
     FROM participants
     WHERE id = ? AND participant_type = 'sponsored_child' AND status <> 'deleted'
     LIMIT 1`,
    [participantId],
  );
  if (!child || !canGoerAccessParticipant(user, child)) return null;
  return child;
}

app.get('/api/sponsorship/children', authenticate, checkSponsorshipView, async (req, res, next) => {
  try {
    await participantProfileColumnsReady;
    const isGoer = isGoerRole(req.user.role);
    const groupScope = isGoer
      ? 'AND education_level = ? AND status = \'active\''
      : '';
    const adminFields = isGoer
      ? ''
      : `, school_name_encrypted, school_address_encrypted,
         sponsorship_lifecycle, sponsorship_status`;
    const [rows] = await pool.execute(
      `SELECT id, full_name_encrypted, participant_code, monthly_allowance ${adminFields}
       FROM participants
       WHERE participant_type = 'sponsored_child' AND status <> 'deleted' ${groupScope}
       ORDER BY FIELD(sponsorship_lifecycle, 'new', 'active', 'deceased', 'graduated'), full_name_encrypted`,
      isGoer ? [req.user.goerEducationLevel] : [],
    );
    const children = rows.map((row) => ({
      id: row.id,
      name: decrypt(row.full_name_encrypted) || 'Unnamed child',
      participantCode: row.participant_code,
      monthlyAllowance: Number(row.monthly_allowance || 0),
      ...(!isGoer ? {
        schoolName: row.school_name_encrypted ? decrypt(row.school_name_encrypted) : '',
        schoolAddress: row.school_address_encrypted ? decrypt(row.school_address_encrypted) : '',
        lifecycle: row.sponsorship_lifecycle || 'active',
        sponsorStatus: row.sponsorship_status || 'unknown',
      } : {}),
    }));
    children.sort((left, right) => left.name.localeCompare(right.name));
    res.json(children);
  } catch (error) { next(error); }
});

app.get('/api/sponsorship/children/:id/updates', authenticate, checkPermission('sponsorship:view'), async (req, res, next) => {
  try {
    await sponsoredChildUpdatesReady;
    const [[child]] = await pool.execute(
      `SELECT id FROM participants
       WHERE id = ? AND participant_type = 'sponsored_child' AND status <> 'deleted'
       LIMIT 1`,
      [req.params.id],
    );
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

app.post('/api/sponsorship/children/:id/updates', authenticate, checkPermission('sponsorship:manage'), async (req, res, next) => {
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
    const [[child]] = await pool.execute(
      `SELECT id FROM participants
       WHERE id = ? AND participant_type = 'sponsored_child' AND status <> 'deleted'
       LIMIT 1`,
      [req.params.id],
    );
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
      updateType: type,
      recordedOn,
    });
    res.status(201).json({ id: result.insertId, type, recordedOn });
  } catch (error) { next(error); }
});

app.put('/api/sponsorship/children/:id', authenticate, checkPermission('sponsorship:manage'), async (req, res, next) => {
  try {
    await participantProfileColumnsReady;
    const lifecycle = String(req.body.lifecycle || '');
    const monthlyAllowance = Number(req.body.monthlyAllowance);
    const schoolNameProvided = Object.prototype.hasOwnProperty.call(req.body, 'schoolName');
    const schoolAddressProvided = Object.prototype.hasOwnProperty.call(req.body, 'schoolAddress');
    const schoolName = String(req.body.schoolName || '').trim();
    const schoolAddress = String(req.body.schoolAddress || '').trim();
    if (!sponsorshipLifecycleStatuses.has(lifecycle)) {
      return res.status(400).json({ error: 'Select a valid child lifecycle status' });
    }
    if (!Number.isFinite(monthlyAllowance) || monthlyAllowance < 0 || monthlyAllowance > 1000000) {
      return res.status(400).json({ error: 'Monthly allowance must be between 0 and 1,000,000' });
    }
    if (schoolName.length > 200) {
      return res.status(400).json({ error: 'School name must be 200 characters or fewer' });
    }
    if (schoolAddress.length > 500) {
      return res.status(400).json({ error: 'School address must be 500 characters or fewer' });
    }
    const [[child]] = await pool.execute(
      `SELECT id FROM participants
       WHERE id = ? AND participant_type = 'sponsored_child' AND status <> 'deleted'
       LIMIT 1`,
      [req.params.id],
    );
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    const updates = [
      'sponsorship_lifecycle = ?',
      'monthly_allowance = ?',
    ];
    const values = [lifecycle, monthlyAllowance.toFixed(2)];
    if (schoolNameProvided) {
      updates.push('school_name_encrypted = ?');
      values.push(encrypt(schoolName || null));
    }
    if (schoolAddressProvided) {
      updates.push('school_address_encrypted = ?');
      values.push(encrypt(schoolAddress || null));
    }
    values.push(req.params.id);
    await pool.execute(
      `UPDATE participants
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = ? AND participant_type = 'sponsored_child' AND status <> 'deleted'`,
      values,
    );
    await writeAuditLog(req.user, 'sponsorship.child.updated', 'participant', req.params.id, {
      lifecycle,
      monthlyAllowance: monthlyAllowance.toFixed(2),
      schoolNameUpdated: schoolNameProvided,
      schoolAddressUpdated: schoolAddressProvided,
    });
    res.json({
      lifecycle,
      monthlyAllowance: Number(monthlyAllowance.toFixed(2)),
      ...(schoolNameProvided ? { schoolName } : {}),
      ...(schoolAddressProvided ? { schoolAddress } : {}),
    });
  } catch (error) { next(error); }
});

app.get('/api/sponsorship/children/:id/disbursements', authenticate, checkSponsorshipView, async (req, res, next) => {
  try {
    await sponsorshipTablesReady;
    const child = await getAccessibleSponsorshipChild(req.user, req.params.id);
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    const isGoer = isGoerRole(req.user.role);
    const [disbursementRows, careRows] = isGoer
      ? [[], (await pool.execute(
        `SELECT id, amount, DATE_FORMAT(recorded_on, '%Y-%m-%d') AS recorded_on,
                care_type, description, receipt_mime, created_at
         FROM sponsored_child_care_records
         WHERE participant_id = ?
         ORDER BY recorded_on DESC, id DESC`,
        [child.id],
      ))[0]]
      : await Promise.all([
        pool.execute(
          `SELECT id, amount, DATE_FORMAT(disbursed_on, '%Y-%m-%d') AS recorded_on,
                  description, receipt_mime, created_at
           FROM sponsorship_disbursements
           WHERE participant_id = ?
           ORDER BY disbursed_on DESC, id DESC`,
          [child.id],
        ).then(([rows]) => rows),
        pool.execute(
          `SELECT id, amount, DATE_FORMAT(recorded_on, '%Y-%m-%d') AS recorded_on,
                  care_type, description, receipt_mime, created_at
           FROM sponsored_child_care_records
           WHERE participant_id = ?
           ORDER BY recorded_on DESC, id DESC`,
          [child.id],
        ).then(([rows]) => rows),
      ]);
    const records = [
      ...disbursementRows.map((row) => ({
        ...row,
        id: `disbursement-${row.id}`,
        recordType: 'disbursement',
        amount: Number(row.amount),
        hasReceipt: Boolean(row.receipt_mime),
      })),
      ...careRows.map((row) => ({
        ...row,
        id: `received-${row.id}`,
        recordType: 'received',
        amount: Number(row.amount),
        hasReceipt: Boolean(row.receipt_mime),
      })),
    ];
    records.sort((left, right) =>
      right.recorded_on.localeCompare(left.recorded_on) ||
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    );
    res.json(records);
  } catch (error) { next(error); }
});

app.post('/api/sponsorship/children/:id/disbursements', authenticate, checkPermission('sponsorship:manage'), async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    const disbursedOn = String(req.body.disbursedOn || '');
    const description = String(req.body.description || '').trim();
    const receipt = parseReceipt(req.body.receiptData);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ error: 'Enter an allowance or gift amount above 0 and no more than 1,000,000' });
    }
    if (!validDate(disbursedOn)) return res.status(400).json({ error: 'Enter a valid disbursement date' });
    if (description.length > 255) return res.status(400).json({ error: 'Description must be 255 characters or fewer' });
    if (receipt.error) return res.status(400).json({ error: receipt.error });
    if (!receipt.data) return res.status(400).json({ error: 'A receipt proof is required for each allowance or gift record' });
    await sponsorshipTablesReady;
    const child = await getAccessibleSponsorshipChild(req.user, req.params.id);
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    const [result] = await pool.execute(
      `INSERT INTO sponsorship_disbursements
         (participant_id, amount, disbursed_on, description, receipt_mime, receipt_data, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [child.id, amount.toFixed(2), disbursedOn, description || null, receipt.mime, encryptBytes(receipt.data), req.user.id],
    );
    await writeAuditLog(req.user, 'sponsorship.disbursement.created', 'participant', child.id, {
      amount: amount.toFixed(2),
      disbursedOn,
      hasReceipt: Boolean(receipt.data),
    });
    res.status(201).json({ id: result.insertId, amount: Number(amount.toFixed(2)), disbursedOn, hasReceipt: Boolean(receipt.data) });
  } catch (error) { next(error); }
});

app.post('/api/sponsorship/children/:id/care-records', authenticate, checkSponsorshipRecord, async (req, res, next) => {
  try {
    const careType = String(req.body.careType || '');
    const amount = Number(req.body.amount);
    const recordedOn = String(req.body.recordedOn || '');
    const description = String(req.body.description || '').trim();
    const receipt = parseReceipt(req.body.receiptData);
    if (!['gift', 'allowance'].includes(careType)) {
      return res.status(400).json({ error: 'Select whether the child received a gift or allowance' });
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ error: 'Enter an amount above 0 and no more than 1,000,000' });
    }
    if (!validDate(recordedOn)) return res.status(400).json({ error: 'Enter a valid record date' });
    if (description.length > 255) return res.status(400).json({ error: 'Description must be 255 characters or fewer' });
    if (receipt.error) return res.status(400).json({ error: receipt.error });
    if (!receipt.data) return res.status(400).json({ error: 'Receipt proof is required for each received gift or allowance record' });
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

app.post('/api/sponsorship/disbursements/:id/receipt', authenticate, checkSponsorshipView, async (req, res, next) => {
  try {
    await sponsorshipTablesReady;
    const routeId = String(req.params.id);
    const match = routeId.match(/^(received|disbursement)-(\d+)$/);
    const source = match ? match[1] : 'disbursement';
    const id = match ? match[2] : routeId;
    if (!/^\d+$/.test(id)) return res.status(404).json({ error: 'Receipt proof not found' });
    if (isGoerRole(req.user.role) && source !== 'received') {
      return res.status(404).json({ error: 'Receipt proof not found' });
    }
    const [rows] = source === 'received'
      ? await pool.execute(
        `SELECT receipt_mime, receipt_data, participant_id
         FROM sponsored_child_care_records WHERE id = ? LIMIT 1`,
        [id],
      )
      : await pool.execute(
        `SELECT receipt_mime, receipt_data, participant_id
         FROM sponsorship_disbursements WHERE id = ? LIMIT 1`,
        [id],
      );
    if (!rows[0] || !rows[0].receipt_data) return res.status(404).json({ error: 'Receipt proof not found' });
    const child = await getAccessibleSponsorshipChild(req.user, rows[0].participant_id);
    if (!child) return res.status(404).json({ error: 'Receipt proof not found' });
    res.json({ mimeType: rows[0].receipt_mime, data: decryptBytes(rows[0].receipt_data).toString('base64') });
  } catch (error) { next(error); }
});

app.get('/api/sponsorship/letters', authenticate, checkSponsorshipView, async (req, res, next) => {
  try {
    await sponsorshipTablesReady;
    const groupScope = isGoerRole(req.user.role)
      ? 'AND p.education_level = ? AND p.status = \'active\''
      : '';
    const [rows] = await pool.query(
      `SELECT t.id, t.participant_id, t.subject, t.subject_encrypted, t.status, t.created_at, t.updated_at,
              p.full_name_encrypted, p.participant_code
       FROM sponsorship_letter_threads t
       JOIN participants p ON p.id = t.participant_id
       WHERE p.status <> 'deleted' AND p.participant_type = 'sponsored_child' ${groupScope}
       ORDER BY t.updated_at DESC
       LIMIT 100`,
      isGoerRole(req.user.role) ? [req.user.goerEducationLevel] : [],
    );
    const ids = rows.map((thread) => thread.id);
    const messages = ids.length
      ? (await pool.query(
        `SELECT id, thread_id, sender_type, message, created_at
         FROM sponsorship_letter_messages
         WHERE thread_id IN (${ids.map(() => '?').join(',')})
         ORDER BY created_at ASC, id ASC`,
        ids,
      ))[0]
      : [];
    const threads = rows.map((thread) => ({
      id: thread.id,
      participantId: thread.participant_id,
      childName: decrypt(thread.full_name_encrypted) || 'Unnamed child',
      participantCode: thread.participant_code,
      subject: thread.subject_encrypted ? decryptLetter(thread.subject_encrypted) : thread.subject,
      status: thread.status,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
      messages: messages
        .filter((message) => Number(message.thread_id) === Number(thread.id))
        .map((message) => ({ ...message, message: decryptLetter(message.message) })),
    }));
    res.json(threads);
  } catch (error) { next(error); }
});

app.post('/api/sponsorship/letters/:id/reply', authenticate, checkSponsorshipRecord, async (req, res, next) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message || message.length > 5000) return res.status(400).json({ error: 'Reply must be between 1 and 5,000 characters' });
    await sponsorshipTablesReady;
    const [[thread]] = await pool.execute(
      `SELECT t.id, t.participant_id, t.status
       FROM sponsorship_letter_threads t
       WHERE t.id = ? LIMIT 1`,
      [req.params.id],
    );
    if (!thread) return res.status(404).json({ error: 'Letter thread not found' });
    if (!await getAccessibleSponsorshipChild(req.user, thread.participant_id)) {
      return res.status(404).json({ error: 'Letter thread not found' });
    }
    if (isGoerRole(req.user.role) && thread.status === 'closed') {
      return res.status(409).json({ error: 'This letter thread is closed. Start a new letter instead.' });
    }
    await pool.execute(
      `INSERT INTO sponsorship_letter_messages (thread_id, sender_type, sender_id, message)
       VALUES (?, 'staff', ?, ?)`,
      [thread.id, req.user.id, encryptLetter(message)],
    );
    await pool.execute(
      `UPDATE sponsorship_letter_threads SET status = 'replied', updated_at = NOW() WHERE id = ?`,
      [thread.id],
    );
    await writeAuditLog(req.user, 'sponsorship.letter.replied', 'letter_thread', thread.id);
    res.status(201).json({ sent: true });
  } catch (error) { next(error); }
});

app.post('/api/sponsorship/children/:id/letters', authenticate, checkSponsorshipRecord, async (req, res, next) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    if (!subject || subject.length > 160) {
      return res.status(400).json({ error: 'Letter subject must be between 1 and 160 characters' });
    }
    if (!message || message.length > 5000) {
      return res.status(400).json({ error: 'Letter message must be between 1 and 5,000 characters' });
    }
    await sponsorshipTablesReady;
    const child = await getAccessibleSponsorshipChild(req.user, req.params.id);
    if (!child) return res.status(404).json({ error: 'Sponsored child not found' });
    const [created] = await pool.execute(
      `INSERT INTO sponsorship_letter_threads
         (participant_id, subject, subject_encrypted, status)
       VALUES (?, 'Encrypted subject', ?, 'open')`,
      [child.id, encryptLetter(subject)],
    );
    await pool.execute(
      `INSERT INTO sponsorship_letter_messages (thread_id, sender_type, sender_id, message)
       VALUES (?, 'staff', ?, ?)`,
      [created.insertId, req.user.id, encryptLetter(message)],
    );
    await writeAuditLog(req.user, 'sponsorship.letter.created', 'letter_thread', created.insertId, {
      participantId: child.id,
    });
    res.status(201).json({ threadId: created.insertId });
  } catch (error) { next(error); }
});

app.put('/api/sponsorship/letters/:id/status', authenticate, checkPermission('sponsorship:manage'), async (req, res, next) => {
  try {
    const status = String(req.body.status || '');
    if (!sponsorshipLetterStatuses.has(status)) return res.status(400).json({ error: 'Select a valid letter status' });
    await sponsorshipTablesReady;
    const [result] = await pool.execute(
      `UPDATE sponsorship_letter_threads SET status = ?, updated_at = NOW() WHERE id = ?`,
      [status, req.params.id],
    );
    if (!result.affectedRows) {
      const [[thread]] = await pool.execute(
        'SELECT id FROM sponsorship_letter_threads WHERE id = ? LIMIT 1',
        [req.params.id],
      );
      if (!thread) return res.status(404).json({ error: 'Letter thread not found' });
    }
    await writeAuditLog(req.user, 'sponsorship.letter.status.updated', 'letter_thread', req.params.id, { status });
    res.json({ status });
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
    await sponsorshipTablesReady;
    const [disbursements] = await pool.execute(
      `SELECT id, amount, DATE_FORMAT(disbursed_on, '%Y-%m-%d') AS disbursed_on,
              description, receipt_mime
       FROM sponsorship_disbursements
       WHERE participant_id = ?
       ORDER BY disbursed_on DESC, id DESC
       LIMIT 100`,
      [child.id],
    );
    res.json({
      child: {
        id: child.id,
        name: decrypt(child.full_name_encrypted),
        participantCode: child.participant_code,
        schoolName: child.school_name_encrypted
          ? decrypt(child.school_name_encrypted)
          : '',
        schoolAddress: child.school_address_encrypted
          ? decrypt(child.school_address_encrypted)
          : '',
        sponsorStatus: child.sponsorship_status || 'unknown',
        lifecycle: child.sponsorship_lifecycle || 'active',
        monthlyAllowance: Number(child.monthly_allowance || 0),
        disbursements: disbursements.map((record) => ({
          id: record.id,
          amount: Number(record.amount),
          disbursedOn: record.disbursed_on,
          description: record.description,
          hasReceipt: Boolean(record.receipt_mime),
        })),
      },
    });
  } catch (error) { next(error); }
});

app.post('/api/public/sponsor-letters/list', async (req, res, next) => {
  try {
    const qrPayload = String(req.body.qrPayload || '');
    const passcode = String(req.body.passcode || '');
    if (!qrPayload || qrPayload.length > 4096 || !passcode) {
      return res.status(400).json({ error: 'Verify the child QR code and passcode first' });
    }
    const verification = await verifyPublicSponsoredChild(qrPayload, passcode);
    if (verification.error) return res.status(verification.status).json({ error: verification.error });
    res.json({ threads: await getSponsorshipThreads(verification.child.id) });
  } catch (error) { next(error); }
});

app.post('/api/public/sponsor-letters', async (req, res, next) => {
  try {
    const qrPayload = String(req.body.qrPayload || '');
    const passcode = String(req.body.passcode || '');
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    const threadId = req.body.threadId ? Number(req.body.threadId) : null;
    if (!qrPayload || qrPayload.length > 4096 || !passcode) {
      return res.status(400).json({ error: 'Verify the child QR code and passcode first' });
    }
    if (!message || message.length > 5000) return res.status(400).json({ error: 'Message must be between 1 and 5,000 characters' });
    if (!threadId && (!subject || subject.length > 160)) {
      return res.status(400).json({ error: 'A subject of up to 160 characters is required for a new letter' });
    }
    if (threadId && !Number.isSafeInteger(threadId)) return res.status(400).json({ error: 'Invalid letter thread' });
    const verification = await verifyPublicSponsoredChild(qrPayload, passcode);
    if (verification.error) return res.status(verification.status).json({ error: verification.error });
    await sponsorshipTablesReady;
    let resolvedThreadId = threadId;
    if (threadId) {
      const [[thread]] = await pool.execute(
        `SELECT id FROM sponsorship_letter_threads
         WHERE id = ? AND participant_id = ? AND status <> 'closed'
         LIMIT 1`,
        [threadId, verification.child.id],
      );
      if (!thread) return res.status(404).json({ error: 'Open letter thread not found' });
    } else {
      const [created] = await pool.execute(
        `INSERT INTO sponsorship_letter_threads
           (participant_id, subject, subject_encrypted, status)
         VALUES (?, 'Encrypted subject', ?, 'open')`,
        [verification.child.id, encryptLetter(subject)],
      );
      resolvedThreadId = created.insertId;
    }
    await pool.execute(
      `INSERT INTO sponsorship_letter_messages (thread_id, sender_type, message)
       VALUES (?, 'guardian', ?)`,
      [resolvedThreadId, encryptLetter(message)],
    );
    await pool.execute(
      `UPDATE sponsorship_letter_threads SET updated_at = NOW() WHERE id = ?`,
      [resolvedThreadId],
    );
    res.status(201).json({ threadId: resolvedThreadId });
  } catch (error) { next(error); }
});

app.post('/api/public/sponsor-receipt', async (req, res, next) => {
  try {
    const qrPayload = String(req.body.qrPayload || '');
    const passcode = String(req.body.passcode || '');
    const disbursementId = Number(req.body.disbursementId);
    if (!qrPayload || qrPayload.length > 4096 || !passcode || !Number.isSafeInteger(disbursementId)) {
      return res.status(400).json({ error: 'Verify the child and select a valid receipt' });
    }
    const verification = await verifyPublicSponsoredChild(qrPayload, passcode);
    if (verification.error) return res.status(verification.status).json({ error: verification.error });
    await sponsorshipTablesReady;
    const [rows] = await pool.execute(
      `SELECT receipt_mime, receipt_data FROM sponsorship_disbursements
       WHERE id = ? AND participant_id = ? LIMIT 1`,
      [disbursementId, verification.child.id],
    );
    if (!rows[0] || !rows[0].receipt_data) return res.status(404).json({ error: 'Receipt proof not found' });
    res.json({ mimeType: rows[0].receipt_mime, data: decryptBytes(rows[0].receipt_data).toString('base64') });
  } catch (error) { next(error); }
});

app.post('/api/public/goer-profile', async (req, res, next) => {
  try {
    const qrPayload = String(req.body.qrPayload || '');
    if (!qrPayload || qrPayload.length > 4096) {
      return res.status(400).json({ error: 'Scan or enter your Goer QR code' });
    }
    const [rows] = await pool.execute(
      `SELECT p.id, p.full_name_encrypted, p.participant_code
       FROM participants p
       JOIN qr_codes q ON q.participant_id = p.id
       WHERE q.qr_uid = ? AND q.status = 'active'
         AND p.participant_type = 'goer' AND p.status <> 'deleted'
       LIMIT 1`,
      [qrPayload],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Active Goer QR code not found' });

    const [attendance] = await pool.execute(
      `SELECT event_name, checked_in_at, location, status
       FROM check_in_logs
       WHERE participant_id = ?
       ORDER BY checked_in_at DESC
       LIMIT 20`,
      [rows[0].id],
    );
    res.json({
      goer: {
        name: decrypt(rows[0].full_name_encrypted),
        participantCode: rows[0].participant_code,
      },
      attendance,
    });
  } catch (error) { next(error); }
});

app.post('/api/participants/:id/profile', authenticate, checkPermission('portal:view'), async (req, res, next) => {
  try {
    const [qrRows] = await pool.execute('SELECT id FROM qr_codes WHERE participant_id = ? AND qr_uid = ? AND status = \'active\' LIMIT 1', [req.params.id, req.body.qrPayload]);
    const [rows] = await pool.execute('SELECT * FROM participants WHERE id = ? LIMIT 1', [req.params.id]);
    if (!qrRows[0] || !rows[0] || !rows[0].passcode_hash || !(await bcrypt.compare(req.body.passcode || '', rows[0].passcode_hash))) return res.status(403).json({ error: 'QR code and passcode verification failed' });
    res.json({ participant: participantView(rows[0]) });
  } catch (error) { next(error); }
});

async function reportRows(range) {
  const interval = range === 'monthly' ? '30 DAY' : '7 DAY';
  const [rows] = await pool.query(`SELECT event_name, status, location, checked_in_at, checked_out_at, participant_id FROM check_in_logs WHERE checked_in_at >= DATE_SUB(NOW(), INTERVAL ${interval}) ORDER BY checked_in_at DESC`);
  return rows;
}

app.get('/api/reports/attendance', authenticate, checkPermission('reports:view'), async (req, res, next) => {
  try {
    const rows = await reportRows(req.query.range === 'monthly' ? 'monthly' : 'weekly');
    if (req.query.format === 'csv') return res.type('text/csv').send(new Parser().parse(rows));
    if (req.query.format === 'pdf') { const doc = new PDFDocument(); res.type('application/pdf'); doc.pipe(res); doc.fontSize(18).text('Attendance Report'); rows.forEach((row) => doc.fontSize(10).text(`${row.checked_in_at || ''} | ${row.checked_out_at || 'Not checked out'} | participant ${row.participant_id} | ${row.event_name} | ${row.status}`)); return doc.end(); }
    res.json({ range: req.query.range === 'monthly' ? 'monthly' : 'weekly', records: rows });
  } catch (error) { next(error); }
});

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
        participantCode: child.participant_code,
        childName: decrypt(child.full_name_encrypted) || 'Unnamed child',
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
          fields: ['participantCode', 'childName', 'recordedOn', 'type', 'activity', 'heightCm', 'weightKg', 'note'],
        }).parse(rows));
    } catch (error) { next(error); }
  },
);

app.get('/api/risk-scores', authenticate, checkPermission('analytics:view'), async (req, res, next) => { try { const [rows] = await pool.query('SELECT * FROM predictive_risk_scores ORDER BY computed_at DESC'); res.json(rows); } catch (error) { next(error); } });

app.get('/api/risk-scores/validation', authenticate, checkPermission('analytics:view'), async (req, res, next) => {
  try {
    await attendanceModelValidationReady;
    const [rows] = await pool.query(
      `SELECT status, model_version, details_json
       FROM attendance_model_validation_runs
       ORDER BY id DESC
       LIMIT 1`,
    );
    if (!rows[0]) return res.json({ status: 'not_evaluated' });
    res.json(JSON.parse(rows[0].details_json));
  } catch (error) { next(error); }
});

app.post('/api/risk-scores/refresh', authenticate, checkPermission('analytics:view'), async (req, res, next) => {
  try {
    res.json(await refreshRiskScores());
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'Internal server error' }); });

async function refreshRiskScores() {
  await attendanceModelValidationReady;
  const [history] = await pool.query(`
    SELECT participant_id, UNIX_TIMESTAMP(checked_in_at) * 1000 AS checked_in_at_ms
    FROM check_in_logs
    WHERE status = 'checked_in' AND checked_in_at IS NOT NULL
    ORDER BY checked_in_at ASC
  `);
  const attendanceHistory = history.map((row) => ({
    participantId: row.participant_id,
    checkedInAt: Number(row.checked_in_at_ms),
  }));
  const evaluatedAt = Date.now();
  const validation = validateAttendanceModel(attendanceHistory, evaluatedAt);
  const { coefficients, ...validationReport } = validation;
  await pool.execute(
    `INSERT INTO attendance_model_validation_runs (status, model_version, details_json)
     VALUES (?, ?, ?)`,
    [validationReport.status, validationReport.modelVersion, JSON.stringify(validationReport)],
  );
  const [participants] = await pool.query(
    "SELECT id FROM participants WHERE status = 'active'",
  );
  const currentFeatures = getCurrentAttendanceFeatures(
    attendanceHistory,
    participants.map((participant) => participant.id),
    evaluatedAt,
  );
  for (const participant of participants) {
    const features = currentFeatures.get(String(participant.id));
    const trainedProbability = coefficients
      ? predictInactivityProbability(features, coefficients)
      : null;
    const score = trainedProbability === null
      ? scoreAttendanceBaseline(features[0] * 13, features[1] * 45)
      : Math.round(trainedProbability * 10000) / 100;
    await pool.execute(
      'INSERT INTO predictive_risk_scores (participant_id, risk_score, risk_level, model_version, computed_at, created_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [
        participant.id,
        score,
        score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
        trainedProbability === null ? BASELINE_VERSION : MODEL_VERSION,
      ],
    );
  }
  return { refreshed: participants.length, validation: validationReport };
}
cron.schedule('0 2 * * *', () => refreshRiskScores().catch(console.error));
cron.schedule('23 * * * *', () => {
  pool.execute(
    'DELETE FROM security_rate_limits WHERE window_started_at < DATE_SUB(NOW(), INTERVAL 1 DAY)',
  ).catch((error) => console.error('Failed to clean expired security rate-limit records:', error));
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