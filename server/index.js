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
const QRCode = require('qrcode');
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');
const mysql = require('mysql2/promise');
const { encrypt, decrypt } = require('./utils/encryption');

const required = ['JWT_SECRET', 'AES_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const app = express();
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
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
const sessions = new Map();
const uploadsDir = path.join(__dirname, 'uploads', 'qr_codes');
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
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

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const now = Date.now();
    const lastActivity = sessions.get(token) || now;
    if (now - lastActivity > 15 * 60 * 1000) {
      sessions.delete(token);
      return res.status(401).json({ error: 'Session expired' });
    }
    sessions.set(token, now);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
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

function participantView(row) {
  const result = { ...row };
  const safeDecrypt = (value) => {
    if (!value) return null;
    try {
      return decrypt(value);
    } catch {
      return null;
    }
  };
  for (const [field, encryptedField] of Object.entries({ fullName: 'full_name_encrypted', dateOfBirth: 'date_of_birth_encrypted', phone: 'phone_encrypted', address: 'address_encrypted', medicalNotes: 'medical_notes_encrypted', weight: 'weight_encrypted', height: 'height_encrypted', medicalConditions: 'medical_conditions_encrypted', emergencyContactName: 'emergency_contact_name_encrypted', emergencyContactPhone: 'emergency_contact_phone_encrypted', sponsorName: 'sponsor_name_encrypted', sponsorContact: 'sponsor_contact_encrypted', programAffiliation: 'program_affiliation_encrypted' })) {
    result[field] = safeDecrypt(result[encryptedField]);
    delete result[encryptedField];
  }
  result.participantType = result.participant_type;
  result.sponsorshipType = result.sponsorship_type;
  result.enrollmentDate = result.enrollment_date instanceof Date
    ? new Date(result.enrollment_date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : result.enrollment_date;
  return result;
}

app.get('/api/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: process.env.DB_NAME, tls: process.env.HTTPS_MIN_VERSION || 'TLSv1.3' });
});

app.get('/api/dashboard', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator', 'System Administrator']), async (req, res, next) => {
  try {
    const [[counts]] = await pool.query("SELECT COUNT(*) AS participants, SUM(status = 'active') AS activeParticipants FROM participants");
    const [[checkins]] = await pool.query(
      "SELECT COUNT(*) AS totalCheckins, COALESCE(SUM(p.participant_type = 'goer'),0) AS goerCheckins, COALESCE(SUM(p.participant_type = 'sponsored_child'),0) AS sponsoredCheckins FROM check_in_logs c JOIN participants p ON p.id = c.participant_id WHERE c.checked_in_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND c.status = 'checked_in'"
    );
    const [recentCheckins] = await pool.query("SELECT c.participant_id, p.participant_type, c.event_name, c.location, c.checked_in_at, c.status FROM check_in_logs c JOIN participants p ON p.id = c.participant_id ORDER BY c.checked_in_at DESC LIMIT 8");
    const [atRisk] = await pool.query("SELECT p.id, p.participant_code, r.risk_score, r.risk_level, r.computed_at FROM predictive_risk_scores r JOIN participants p ON p.id = r.participant_id JOIN (SELECT participant_id, MAX(computed_at) AS latest FROM predictive_risk_scores GROUP BY participant_id) latest ON latest.participant_id = r.participant_id AND latest.latest = r.computed_at WHERE r.risk_level IN ('high', 'medium') ORDER BY r.risk_score DESC LIMIT 8");
    res.json({ counts: { ...counts, totalCheckins: checkins.totalCheckins, goerCheckins: checkins.goerCheckins, sponsoredCheckins: checkins.sponsoredCheckins }, recentCheckins, atRisk });
  } catch (error) { next(error); }
});

app.get('/api/participants', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator', 'System Administrator']), async (req, res, next) => {
  try { const [rows] = await pool.query("SELECT p.id, p.participant_code, p.participant_type, p.gender, p.status, p.created_at, (SELECT q.qr_code_image FROM qr_codes q WHERE q.participant_id = p.id AND q.status = 'active' ORDER BY q.id DESC LIMIT 1) AS qr_code_image FROM participants p ORDER BY p.id DESC"); res.json(rows); } catch (error) { next(error); }
});

app.get('/api/events', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator', 'System Administrator', 'Check-in Volunteer']), async (req, res, next) => {
  try {
    await eventsTableReady;
    const [rows] = await pool.query('SELECT id, name, description, starts_at, ends_at, location, status, created_at FROM events ORDER BY starts_at DESC');
    res.json(rows);
  } catch (error) { next(error); }
});

app.post('/api/events', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator']), async (req, res, next) => {
  try {
    await eventsTableReady;
    const name = String(req.body.name || '').trim();
    const startsAt = String(req.body.startsAt || '').trim();
    const endsAt = req.body.endsAt ? String(req.body.endsAt).trim() : null;
    const location = req.body.location ? String(req.body.location).trim() : null;
    const description = req.body.description ? String(req.body.description).trim() : null;
    if (!name || !startsAt) return res.status(400).json({ error: 'Event name and start time are required' });
    const startsDate = new Date(startsAt);
    const endsDate = endsAt ? new Date(endsAt) : null;
    if (Number.isNaN(startsDate.getTime()) || (endsDate && Number.isNaN(endsDate.getTime()))) return res.status(400).json({ error: 'Event times must be valid dates' });
    if (endsDate && endsDate < startsDate) return res.status(400).json({ error: 'End time must be after the start time' });
    const [result] = await pool.execute(
      'INSERT INTO events (name, description, starts_at, ends_at, location, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description, startsAt.replace('T', ' '), endsAt ? endsAt.replace('T', ' ') : null, location, req.user.id],
    );
    const [rows] = await pool.execute('SELECT id, name, description, starts_at, ends_at, location, status, created_at FROM events WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An event with the same name and start time already exists' });
    next(error);
  }
});

app.get('/api/events/:id/attendance', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator', 'System Administrator', 'Check-in Volunteer']), async (req, res, next) => {
  try {
    await eventsTableReady;
    const [[event]] = await pool.execute('SELECT id, name, description, starts_at, ends_at, location, status FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const [attendance] = await pool.execute(
      `SELECT c.id, c.participant_id, p.participant_code, p.participant_type, c.event_name, c.location, c.checked_in_at, c.checked_out_at, c.status
       FROM check_in_logs c JOIN participants p ON p.id = c.participant_id
       WHERE c.event_name = ? AND c.status = 'checked_in'
       ORDER BY c.checked_in_at ASC`,
      [event.name],
    );
    res.json({ event, attendance });
  } catch (error) { next(error); }
});

app.get('/api/participants/:id', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator', 'System Administrator']), async (req, res, next) => {
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

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1', [req.body.username, req.body.username]);
    const user = rows[0];
    if (!user || user.status !== 'active' || !(await bcrypt.compare(req.body.password || '', user.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m', algorithm: 'HS256' });
    sessions.set(token, Date.now());
    await pool.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) { next(error); }
});

app.post('/api/participants', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator']), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const participantCode = `FMC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const [result] = await connection.execute(
      'INSERT INTO participants (participant_type, full_name_encrypted, date_of_birth_encrypted, gender, phone_encrypted, address_encrypted, passcode_hash, medical_conditions_encrypted, weight_encrypted, height_encrypted, emergency_contact_name_encrypted, emergency_contact_phone_encrypted, sponsor_name_encrypted, sponsor_contact_encrypted, sponsorship_type, enrollment_date, program_affiliation_encrypted, status, participant_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [req.body.participantType || 'goer', encrypt(req.body.fullName), encrypt(req.body.dateOfBirth), req.body.gender || null, encrypt(req.body.phone), encrypt(req.body.address), req.body.passcode ? await bcrypt.hash(req.body.passcode, 12) : null, encrypt(req.body.medicalConditions), encrypt(req.body.weight), encrypt(req.body.height), encrypt(req.body.emergencyContactName), encrypt(req.body.emergencyContactPhone), encrypt(req.body.sponsorName), encrypt(req.body.sponsorContact), req.body.sponsorshipType || null, req.body.enrollmentDate || null, encrypt(req.body.programAffiliation), 'active', participantCode],
    );
    const uid = crypto.randomUUID();
    const qrPayload = encrypt(uid);
    const filename = `qr_${result.insertId}_${Date.now()}.png`;
    await QRCode.toFile(path.join(uploadsDir, filename), qrPayload);
    await connection.execute('INSERT INTO qr_codes (participant_id, qr_uid, qr_code_image, status, assigned_at, created_by, created_at) VALUES (?, ?, ?, ?, NOW(), ?, NOW())', [result.insertId, qrPayload, `uploads/qr_codes/${filename}`, 'active', req.user.id]);
    await connection.commit();
    res.status(201).json({ id: result.insertId, participantCode, qrPayload, qrCodeImage: `/uploads/qr_codes/${filename}` });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

app.put('/api/participants/:id', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator']), async (req, res, next) => {
  try {
    const fields = {
      participant_type: req.body.participantType || 'goer',
      full_name_encrypted: encrypt(req.body.fullName),
      date_of_birth_encrypted: encrypt(req.body.dateOfBirth),
      gender: req.body.gender || null,
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
      status: req.body.status || 'active',
    };
    // If the client provided a passcode key, update the stored hash (allow clearing with empty string)
    if (Object.prototype.hasOwnProperty.call(req.body, 'passcode')) {
      fields.passcode_hash = req.body.passcode ? await bcrypt.hash(req.body.passcode, 12) : null;
    }

    const updates = Object.keys(fields).map((field) => `${field} = ?`).join(', ');
    const [result] = await pool.execute(`UPDATE participants SET ${updates}, updated_at = NOW() WHERE id = ?`, [...Object.values(fields), req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Participant not found' });
    const [rows] = await pool.execute('SELECT * FROM participants WHERE id = ? LIMIT 1', [req.params.id]);
    res.json({ participant: participantView(rows[0]) });
  } catch (error) { next(error); }
});

app.delete('/api/participants/:id', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator']), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('UPDATE participants SET status = ?, updated_at = NOW() WHERE id = ?', ['deleted', req.params.id]);
    if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ error: 'Participant not found' }); }
    // Revoke any active QR codes for the participant
    await connection.execute("UPDATE qr_codes SET status = 'revoked', revoked_at = NOW() WHERE participant_id = ?", [req.params.id]);
    await connection.commit();
    res.json({ deleted: true });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

app.post('/api/checkin', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator', 'Check-in Volunteer']), async (req, res, next) => {
  try {
    const payload = String(req.body.qrPayload || '');
    // verify payload decrypts (will throw if invalid) — handle gracefully and return 400
    try {
      decrypt(payload);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid QR payload' });
    }
    const [rows] = await pool.execute('SELECT * FROM qr_codes WHERE qr_uid = ? AND status = \'active\' LIMIT 1', [payload]);
    if (!rows[0]) return res.status(404).json({ error: 'Invalid or revoked QR code' });
    const qr = rows[0];

    // Deduplication: ignore check-ins for the same participant and event on the same date
    const eventName = req.body.eventName || 'General event';
    const location = req.body.location || null;

    const [[recent]] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM check_in_logs WHERE participant_id = ? AND event_name = ? AND DATE(checked_in_at) = CURDATE() AND status = ?',
      [qr.participant_id, eventName, 'checked_in'],
    );

    if (Number(recent.cnt) > 0) {
      // Update qr_code scan metadata but do not insert duplicate attendance
      await pool.execute('UPDATE qr_codes SET last_scanned_at = NOW(), scan_count = scan_count + 1 WHERE id = ?', [qr.id]);
      return res.json({ status: 'duplicate', ignored: true, participantId: qr.participant_id, timestamp: new Date().toISOString() });
    }

    await pool.execute('INSERT INTO check_in_logs (participant_id, qr_code_id, event_name, checked_in_at, location, status, created_at) VALUES (?, ?, ?, NOW(), ?, ?, NOW())', [qr.participant_id, qr.id, eventName, location, 'checked_in']);
    await pool.execute('UPDATE qr_codes SET last_scanned_at = NOW(), scan_count = scan_count + 1 WHERE id = ?', [qr.id]);
    res.json({ status: 'checked_in', participantId: qr.participant_id, timestamp: new Date().toISOString() });
  } catch (error) { next(error); }
});

app.post('/api/portal/profile', authenticate, async (req, res, next) => {
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

app.post('/api/participants/:id/profile', authenticate, async (req, res, next) => {
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

app.get('/api/reports/attendance', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator']), async (req, res, next) => {
  try {
    const rows = await reportRows(req.query.range === 'monthly' ? 'monthly' : 'weekly');
    if (req.query.format === 'csv') return res.type('text/csv').send(new Parser().parse(rows));
    if (req.query.format === 'pdf') { const doc = new PDFDocument(); res.type('application/pdf'); doc.pipe(res); doc.fontSize(18).text('Attendance Report'); rows.forEach((row) => doc.fontSize(10).text(`${row.checked_in_at || ''} | participant ${row.participant_id} | ${row.event_name} | ${row.status}`)); return doc.end(); }
    res.json({ range: req.query.range === 'monthly' ? 'monthly' : 'weekly', records: rows });
  } catch (error) { next(error); }
});

app.get('/api/risk-scores', authenticate, async (req, res, next) => { try { const [rows] = await pool.query('SELECT * FROM predictive_risk_scores ORDER BY computed_at DESC'); res.json(rows); } catch (error) { next(error); } });

app.post('/api/risk-scores/refresh', authenticate, checkRole(['Admin', 'Church Administrator', 'Program Coordinator', 'System Administrator']), async (req, res, next) => {
  try {
    const [participants] = await pool.query('SELECT id FROM participants WHERE status = \'active\'');
    const serviceUrl = process.env.ANALYTICS_SERVICE_URL || 'http://127.0.0.1:8000';
    for (const participant of participants) {
      const [[stats]] = await pool.execute(
        'SELECT COUNT(*) AS total, MAX(checked_in_at) AS latest FROM check_in_logs WHERE participant_id = ? AND status = \'checked_in\'',
        [participant.id],
      );
      const frequency = Number(stats.total);
      const recencyDays = stats.latest ? Math.max(0, (Date.now() - new Date(stats.latest).getTime()) / 86400000) : 30;
      const predictionResponse = await fetch(`${serviceUrl}/predict`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ frequency, regularity: Math.min(1, frequency / 10), recency_days: recencyDays }),
      });
      if (!predictionResponse.ok) throw new Error(`Analytics service returned ${predictionResponse.status}`);
      const prediction = await predictionResponse.json();
      const score = Number(prediction.risk_score);
      await pool.execute(
        'INSERT INTO predictive_risk_scores (participant_id, risk_score, risk_level, model_version, computed_at, created_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
        [participant.id, score, score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low', prediction.model_version || 'unknown'],
      );
    }
    res.json({ refreshed: participants.length });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'Internal server error' }); });

async function refreshRiskScores() {
  const [participants] = await pool.query('SELECT id FROM participants WHERE status = \'active\'');
  for (const participant of participants) {
    const [[stats]] = await pool.execute('SELECT COUNT(*) AS total, MAX(checked_in_at) AS latest FROM check_in_logs WHERE participant_id = ? AND status = \'checked_in\'', [participant.id]);
    const score = Math.max(0, Math.min(100, 100 - Number(stats.total) * 10));
    await pool.execute('INSERT INTO predictive_risk_scores (participant_id, risk_score, risk_level, model_version, computed_at, created_at) VALUES (?, ?, ?, ?, NOW(), NOW())', [participant.id, score, score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low', 'baseline-v1']);
  }
}
cron.schedule('0 2 * * *', () => refreshRiskScores().catch(console.error));

const port = Number(process.env.PORT || 3000);
const certPath = process.env.HTTPS_CERT_PATH;
const keyPath = process.env.HTTPS_KEY_PATH;
if (process.env.NODE_ENV === 'production' && (!certPath || !keyPath)) throw new Error('HTTPS_CERT_PATH and HTTPS_KEY_PATH are required in production');
const server = certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath), minVersion: process.env.HTTPS_MIN_VERSION || 'TLSv1.3' }, app)
  : http.createServer(app);
server.listen(port, () => console.log(`${server instanceof https.Server ? 'HTTPS' : 'HTTP'} server listening on port ${port}`));

module.exports = { app, pool, checkRole };