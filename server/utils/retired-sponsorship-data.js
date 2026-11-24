const RETIRED_SPONSOR_TABLES = [
  'sponsorship_letter_messages',
  'sponsorship_letter_threads',
  'sponsorship_letters',
  'sponsor_letter_messages',
  'sponsor_letter_threads',
  'sponsor_letters',
  'sponsorship_allowance_transactions',
  'sponsorship_disbursements',
  'sponsorship_assignment_history',
  'sponsorship_assignments',
  'sponsors',
];

const RETIRED_PARTICIPANT_COLUMNS = [
  'sponsor_id',
  'sponsor_name_encrypted',
  'sponsor_contact_encrypted',
  'sponsor_family_name_encrypted',
  'sponsor_email_encrypted',
  'sponsor_address_encrypted',
  'sponsorship_type',
  'sponsorship_status',
  'sponsorship_lifecycle',
  'communication_history_encrypted',
  'donation_history_encrypted',
  'sponsorship_payments_encrypted',
  'letters_sent_encrypted',
  'letters_received_encrypted',
  'last_letter_date',
  'monthly_allowance',
  'available_allowance_balance',
  'allowance_balance',
  'program_affiliation_encrypted',
];

const PARTICIPATION_STATUS_ENUM =
  "ENUM('ACTIVE','WARNING','GROUNDS_FOR_DEPARTURE','INACTIVE') NOT NULL DEFAULT 'ACTIVE'";

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replaceAll('`', '``')}\``;
}

function normalizedStatusSql(column) {
  return `REPLACE(REPLACE(UPPER(TRIM(COALESCE(${column}, ''))), ' ', '_'), '-', '_')`;
}

function statusCaseSql(column) {
  const status = normalizedStatusSql(column);
  return `CASE
    WHEN ${status} IN ('INACTIVE', 'REMOVED_FROM_SPONSORSHIP') THEN 'INACTIVE'
    WHEN ${status} = 'WARNING' THEN 'WARNING'
    WHEN ${status} IN ('GROUND_FOR_DEPARTURE', 'GROUNDS_FOR_DEPARTURE') THEN 'GROUNDS_FOR_DEPARTURE'
    ELSE 'ACTIVE'
  END`;
}

async function normalizeParticipantStatuses(pool) {
  const [participantColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'participants'`,
  );
  const columns = new Set(participantColumns.map(({ COLUMN_NAME }) => COLUMN_NAME));
  if (!columns.has('participation_status')) {
    await pool.query(`ALTER TABLE participants ADD COLUMN participation_status ${PARTICIPATION_STATUS_ENUM}`);
    columns.add('participation_status');
  }

  const inactiveConditions = [
    "LOWER(TRIM(COALESCE(status, ''))) = 'inactive'",
    `${normalizedStatusSql('participation_status')} IN ('INACTIVE', 'REMOVED_FROM_SPONSORSHIP')`,
  ];
  if (columns.has('sponsorship_status')) {
    inactiveConditions.push("LOWER(TRIM(COALESCE(sponsorship_status, ''))) = 'inactive'");
  }
  await pool.query(
    `UPDATE participants SET participation_status = CASE
       WHEN ${inactiveConditions.join(' OR ')} THEN 'INACTIVE'
       WHEN ${normalizedStatusSql('participation_status')} = 'WARNING' THEN 'WARNING'
       WHEN ${normalizedStatusSql('participation_status')} IN ('GROUND_FOR_DEPARTURE', 'GROUNDS_FOR_DEPARTURE')
         THEN 'GROUNDS_FOR_DEPARTURE'
       ELSE 'ACTIVE'
     END`,
  );
  await pool.query(
    `ALTER TABLE participants MODIFY COLUMN participation_status ${PARTICIPATION_STATUS_ENUM}`,
  );

  const [historyColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sponsored_child_participation_history'`,
  );
  const history = new Set(historyColumns.map(({ COLUMN_NAME }) => COLUMN_NAME));
  const statusFields = ['previous_status', 'current_status'].filter((field) => history.has(field));
  if (!statusFields.length) return;

  const updates = statusFields.map((field) =>
    `${quoteIdentifier(field)} = ${statusCaseSql(quoteIdentifier(field))}`,
  );
  await pool.query(
    `UPDATE sponsored_child_participation_history SET ${updates.join(', ')}`,
  );
  for (const field of statusFields) {
    await pool.query(
      `ALTER TABLE sponsored_child_participation_history
       MODIFY COLUMN ${quoteIdentifier(field)} ${PARTICIPATION_STATUS_ENUM}`,
    );
  }
}

async function removeRetiredSponsorshipData(pool) {
  const tablePlaceholders = RETIRED_SPONSOR_TABLES.map(() => '?').join(', ');
  const [legacyTables] = await pool.execute(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND (
         TABLE_NAME IN (${tablePlaceholders})
         OR (TABLE_NAME LIKE '%sponsor%' AND
             (TABLE_NAME LIKE '%letter%' OR TABLE_NAME LIKE '%allowance%'))
       )`,
    RETIRED_SPONSOR_TABLES,
  );
  const tableNames = [...new Set([
    ...RETIRED_SPONSOR_TABLES,
    ...legacyTables.map(({ TABLE_NAME }) => TABLE_NAME),
  ])];
  const columnPlaceholders = RETIRED_PARTICIPANT_COLUMNS.map(() => '?').join(', ');
  const [foreignKeys] = await pool.execute(
    `SELECT TABLE_NAME, CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
       AND (
         REFERENCED_TABLE_NAME IN (${tableNames.map(() => '?').join(', ')})
         OR (TABLE_NAME = 'participants' AND COLUMN_NAME IN (${columnPlaceholders}))
       )`,
    [...tableNames, ...RETIRED_PARTICIPANT_COLUMNS],
  );
  const droppedKeys = new Set();
  for (const { TABLE_NAME, CONSTRAINT_NAME } of foreignKeys) {
    const key = `${TABLE_NAME}.${CONSTRAINT_NAME}`;
    if (droppedKeys.has(key)) continue;
    droppedKeys.add(key);
    await pool.query(
      `ALTER TABLE ${quoteIdentifier(TABLE_NAME)} DROP FOREIGN KEY ${quoteIdentifier(CONSTRAINT_NAME)}`,
    );
  }

  const [participantColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'participants'
       AND COLUMN_NAME IN (${columnPlaceholders})`,
    RETIRED_PARTICIPANT_COLUMNS,
  );
  if (participantColumns.length) {
    const columns = participantColumns.map(({ COLUMN_NAME }) => quoteIdentifier(COLUMN_NAME));
    await pool.query(
      `ALTER TABLE participants ${columns.map((column) => `DROP COLUMN ${column}`).join(', ')}`,
    );
  }

  for (const tableName of tableNames) {
    await pool.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
  }

  const [auditTables] = await pool.execute(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs'`,
  );
  if (auditTables.length) {
    await pool.query(
      `UPDATE audit_logs SET details = NULL
       WHERE entity_type = 'sponsor'
          OR action LIKE 'sponsor.%'
          OR action LIKE 'sponsorship.child.sponsor.%'`,
    );
  }
}

module.exports = {
  normalizeParticipantStatuses,
  removeRetiredSponsorshipData,
};
