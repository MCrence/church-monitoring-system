require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const crypto = require('crypto');
const path = require('path');
const mysql = require('mysql2/promise');
const XLSX = require('@e965/xlsx');
const { buildAttendanceRiskAssessment, DEFAULT_ATTENDANCE_RISK_SETTINGS } = require('../utils/attendance-risk');

const attendanceFile = path.resolve(__dirname, '..', '..', 'Data', 'Sponsored_Child_Attendance_Records.csv');
const reconciliationId = crypto.createHash('sha256')
  .update(require('fs').readFileSync(attendanceFile))
  .digest('hex');
const auditAction = 'attendance.csv.reconciled';
const auditEntity = 'attendance_import';
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid attendance or activity date: ${value}`);
  return new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

function parseAttendanceCsv() {
  const workbook = XLSX.readFile(attendanceFile, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  if (!rows.length) throw new Error('The official attendance CSV is empty.');
  return rows;
}

async function buildReconciliation(connection) {
  const sourceRows = parseAttendanceCsv();
  const [[participants], [events], [logs]] = await Promise.all([
    connection.query(
      `SELECT id FROM participants
       WHERE participant_type = 'sponsored_child' AND status <> 'deleted'`,
    ),
    connection.query('SELECT id, name, starts_at, status, is_sample FROM events'),
    connection.query(
      `SELECT id, participant_id, event_id, event_name, status, attendance_status
       FROM check_in_logs`,
    ),
  ]);
  const participantIds = new Set(participants.map((row) => Number(row.id)));
  const eventsById = new Map(events.map((event) => [Number(event.id), event]));
  const eventsByNameDate = new Map();
  for (const event of events) {
    const key = `${normalizeText(event.name)}|${dateKey(event.starts_at)}`;
    const matches = eventsByNameDate.get(key) || [];
    matches.push(event);
    eventsByNameDate.set(key, matches);
  }
  const logsById = new Map(logs.map((row) => [Number(row.id), row]));
  const absentLogsByChildAndName = new Map();
  for (const log of logs) {
    if (log.status !== 'absent') continue;
    const key = `${Number(log.participant_id)}|${normalizeText(log.event_name)}`;
    const matches = absentLogsByChildAndName.get(key) || [];
    matches.push(log);
    absentLogsByChildAndName.set(key, matches);
  }

  const updates = [];
  const eventIds = new Set();
  const matchedLogIds = new Set();
  const unmatchedRows = [];
  const sourceEvents = new Set();
  for (const row of sourceRows) {
    const participantId = Number(row['Sponsored Child ID']);
    if (!participantIds.has(participantId)) {
      throw new Error(`Attendance CSV references unknown sponsored child ID ${row['Sponsored Child ID']}.`);
    }

    const activityName = String(row['Activity Name'] || '').trim();
    const activityId = Number(row['Activity/Event ID']);
    const event = activityId
      ? eventsById.get(activityId)
      : eventsByNameDate.get(`${normalizeText(activityName)}|${dateKey(row['Event Date'])}`)?.[0];
    if (
      event
      && (
        normalizeText(event.name) !== normalizeText(activityName)
        || dateKey(event.starts_at) !== dateKey(row['Event Date'])
        || event.status === 'cancelled'
      )
    ) {
      throw new Error(`Attendance CSV activity does not match the existing event for child ID ${participantId}.`);
    }

    const status = normalizeText(row['Attendance Status']);
    if (!['present', 'absent'].includes(status)) {
      throw new Error(`Unsupported attendance status for child ID ${participantId}: ${row['Attendance Status']}`);
    }

    let log;
    if (status === 'present' && row['Attendance Record ID']) {
      log = logsById.get(Number(row['Attendance Record ID']));
      if (
        !log
        || Number(log.participant_id) !== participantId
        || normalizeText(log.event_name) !== normalizeText(activityName)
        || log.status !== 'checked_in'
      ) {
        throw new Error(`Attendance record ID ${row['Attendance Record ID']} does not match the CSV row.`);
      }
    } else {
      const candidates = absentLogsByChildAndName.get(
        `${participantId}|${normalizeText(activityName)}`,
      ) || [];
      if (candidates.length === 1) [log] = candidates;
      else if (candidates.length > 1) {
        throw new Error(`Attendance CSV row for child ID ${participantId} has ambiguous existing attendance records.`);
      }
    }
    if (!log) {
      unmatchedRows.push({
        participantId,
        activityName,
        eventDate: dateKey(row['Event Date']),
        status,
      });
      continue;
    }
    if (matchedLogIds.has(Number(log.id))) {
      throw new Error(`Attendance record ${log.id} is referenced more than once in the CSV.`);
    }
    matchedLogIds.add(Number(log.id));
    if (event) {
      eventIds.add(Number(event.id));
      sourceEvents.add(Number(event.id));
      updates.push({ logId: Number(log.id), eventId: Number(event.id), status });
    } else {
      unmatchedRows.push({
        participantId,
        activityName,
        eventDate: dateKey(row['Event Date']),
        status,
      });
    }
  }

  if (unmatchedRows.length > 1) {
    throw new Error(`${unmatchedRows.length} attendance CSV rows cannot be matched to an existing event.`);
  }
  if (updates.length !== sourceRows.length - unmatchedRows.length) {
    throw new Error('The attendance reconciliation did not map every resolvable CSV record.');
  }

  return {
    sourceRows,
    updates,
    eventIds: [...eventIds],
    unmatchedRows,
    participants: participants.length,
    sourceEvents: sourceEvents.size,
  };
}

async function updateAttendance(connection, reconciliation) {
  const { eventIds, updates } = reconciliation;
  for (let index = 0; index < eventIds.length; index += 500) {
    const ids = eventIds.slice(index, index + 500);
    const placeholders = ids.map(() => '?').join(', ');
    await connection.execute(
      `UPDATE events
       SET is_sample = FALSE,
           status = IF(starts_at < NOW(), 'completed', status)
       WHERE id IN (${placeholders})`,
      ids,
    );
  }

  for (let index = 0; index < updates.length; index += 250) {
    const batch = updates.slice(index, index + 250);
    const idCases = batch.map(() => 'WHEN ? THEN ?').join(' ');
    const statusCases = batch.map(() => 'WHEN ? THEN ?').join(' ');
    const ids = batch.map((row) => row.logId);
    const eventParams = batch.flatMap((row) => [row.logId, row.eventId]);
    const statusParams = batch.flatMap((row) => [row.logId, row.status]);
    await connection.execute(
      `UPDATE check_in_logs
       SET event_id = CASE id ${idCases} ELSE event_id END,
           attendance_status = CASE id ${statusCases} ELSE attendance_status END
       WHERE id IN (${ids.map(() => '?').join(', ')})`,
      [...eventParams, ...statusParams, ...ids],
    );
  }
}

async function writeAuditRecord(connection, reconciliation) {
  const [[existing]] = await connection.execute(
    `SELECT id FROM audit_logs
     WHERE action = ? AND entity_type = ? AND entity_id = ?
     LIMIT 1`,
    [auditAction, auditEntity, reconciliationId],
  );
  if (existing) return;
  await connection.execute(
    `INSERT INTO audit_logs
       (user_id, username, role, action, entity_type, entity_id, details)
     VALUES (NULL, ?, 'System', ?, ?, ?, ?)`,
    [
      'Official Attendance CSV Reconciliation',
      auditAction,
      auditEntity,
      reconciliationId,
      JSON.stringify({
        sourceRecords: reconciliation.sourceRows.length,
        linkedAttendanceRecords: reconciliation.updates.length,
        officialActivities: reconciliation.eventIds.length,
        unmatchedRows: reconciliation.unmatchedRows.length,
      }),
    ],
  );
}

async function getRiskSummary(connection) {
  const [[settingsRow]] = await connection.query(
    `SELECT frequency_weight, regularity_weight, recency_weight,
            medium_threshold, high_threshold
     FROM attendance_risk_settings WHERE setting_id = 1`,
  );
  const settings = settingsRow
    ? {
      frequencyWeight: Number(settingsRow.frequency_weight),
      regularityWeight: Number(settingsRow.regularity_weight),
      recencyWeight: Number(settingsRow.recency_weight),
      mediumThreshold: Number(settingsRow.medium_threshold),
      highThreshold: Number(settingsRow.high_threshold),
    }
    : DEFAULT_ATTENDANCE_RISK_SETTINGS;
  const [rows] = await connection.query(`
    SELECT p.id AS participant_id, e.id AS event_id, e.name AS event_name,
           e.starts_at, MAX(LOWER(c.attendance_status)) AS attendance_status
    FROM participants p
    LEFT JOIN events e
      ON e.is_sample = FALSE AND e.status = 'completed' AND e.starts_at < NOW()
     AND e.starts_at >= COALESCE(p.sponsorship_registered_at, p.sponsorship_start_date, p.created_at)
    LEFT JOIN check_in_logs c
      ON c.participant_id = p.id AND c.event_id = e.id
    WHERE p.participant_type = 'sponsored_child' AND p.status <> 'deleted'
    GROUP BY p.id, e.id
    ORDER BY p.id, e.starts_at, e.id
  `);
  const children = new Map();
  for (const row of rows) {
    const participantId = Number(row.participant_id);
    if (!children.has(participantId)) children.set(participantId, []);
    if (row.event_id !== null) {
      children.get(participantId).push({
        eventId: row.event_id,
        eventName: row.event_name,
        startsAt: row.starts_at,
        attendanceStatus: row.attendance_status,
      });
    }
  }
  const summary = { evaluated: 0, high: 0, medium: 0, low: 0, insufficient: 0 };
  for (const events of children.values()) {
    const result = buildAttendanceRiskAssessment(events, settings);
    summary.evaluated += 1;
    if (result.riskLevel === 'insufficient_data') summary.insufficient += 1;
    else summary[result.riskLevel] += 1;
  }
  return summary;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    const reconciliation = await buildReconciliation(connection);
    await connection.beginTransaction();
    try {
      await updateAttendance(connection, reconciliation);
      await writeAuditRecord(connection, reconciliation);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    const riskSummary = await getRiskSummary(connection);
    console.log(JSON.stringify({
      sourceRecords: reconciliation.sourceRows.length,
      linkedAttendanceRecords: reconciliation.updates.length,
      officialActivities: reconciliation.eventIds.length,
      unmatchedRows: reconciliation.unmatchedRows,
      riskSummary,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Official attendance reconciliation failed:', error.message);
  process.exitCode = 1;
});
