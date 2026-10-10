async function initializeSponsorshipTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsorship_allowance_transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      participant_id INT UNSIGNED NOT NULL,
      transaction_type VARCHAR(16) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      previous_balance DECIMAL(10,2) NOT NULL,
      updated_balance DECIMAL(10,2) NOT NULL,
      disbursement_id BIGINT UNSIGNED DEFAULT NULL,
      related_transaction_id BIGINT UNSIGNED DEFAULT NULL,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_allowance_disbursement (disbursement_id),
      UNIQUE KEY uq_allowance_related_transaction (related_transaction_id),
      INDEX idx_allowance_transactions_participant (participant_id, created_at, id),
      CONSTRAINT fk_allowance_transaction_participant
        FOREIGN KEY (participant_id) REFERENCES participants (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsors (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name_encrypted TEXT DEFAULT NULL,
      phone_encrypted TEXT DEFAULT NULL,
      email_encrypted TEXT DEFAULT NULL,
      sponsor_type VARCHAR(20) DEFAULT NULL,
      sex VARCHAR(10) DEFAULT NULL,
      created_at DATETIME DEFAULT NULL,
      updated_at DATETIME DEFAULT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [sponsorColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sponsors'
       AND COLUMN_NAME IN ('sponsor_type', 'sex')`,
  );
  const existingSponsorColumns = new Set(sponsorColumns.map(({ COLUMN_NAME }) => COLUMN_NAME));
  for (const [column, definition] of [
    ['sponsor_type', 'VARCHAR(20) DEFAULT NULL'],
    ['sex', 'VARCHAR(10) DEFAULT NULL'],
  ]) {
    if (existingSponsorColumns.has(column)) continue;
    try {
      await pool.query(`ALTER TABLE sponsors ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsorship_disbursements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      participant_id INT UNSIGNED NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      disbursed_on DATE NOT NULL,
      description VARCHAR(255) DEFAULT NULL,
      receipt_mime VARCHAR(100) DEFAULT NULL,
      receipt_data LONGBLOB DEFAULT NULL,
      idempotency_key CHAR(36) DEFAULT NULL,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sponsorship_disbursement_idempotency (idempotency_key),
      INDEX idx_sponsorship_disbursements_participant (participant_id, disbursed_on),
      CONSTRAINT fk_sponsorship_disbursements_participant
        FOREIGN KEY (participant_id) REFERENCES participants (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [sponsorshipColumns] = await pool.execute(
    `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND ((TABLE_NAME = 'sponsorship_allowance_transactions' AND COLUMN_NAME = 'disbursement_id')
         OR (TABLE_NAME = 'sponsorship_disbursements' AND COLUMN_NAME = 'idempotency_key'))`,
  );
  const existingSponsorshipColumns = new Set(
    sponsorshipColumns.map(({ TABLE_NAME, COLUMN_NAME }) => `${TABLE_NAME}.${COLUMN_NAME}`),
  );
  for (const [table, column, definition] of [
    ['sponsorship_allowance_transactions', 'disbursement_id', 'BIGINT UNSIGNED DEFAULT NULL'],
    ['sponsorship_disbursements', 'idempotency_key', 'CHAR(36) DEFAULT NULL'],
  ]) {
    if (existingSponsorshipColumns.has(`${table}.${column}`)) continue;
    try {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  const [sponsorshipIndexes] = await pool.execute(
    `SELECT TABLE_NAME, INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND ((TABLE_NAME = 'sponsorship_allowance_transactions' AND INDEX_NAME = 'uq_allowance_disbursement')
         OR (TABLE_NAME = 'sponsorship_disbursements' AND INDEX_NAME = 'uq_sponsorship_disbursement_idempotency'))`,
  );
  const existingSponsorshipIndexes = new Set(
    sponsorshipIndexes.map(({ TABLE_NAME, INDEX_NAME }) => `${TABLE_NAME}.${INDEX_NAME}`),
  );
  for (const [table, index, column] of [
    ['sponsorship_allowance_transactions', 'uq_allowance_disbursement', 'disbursement_id'],
    ['sponsorship_disbursements', 'uq_sponsorship_disbursement_idempotency', 'idempotency_key'],
  ]) {
    if (existingSponsorshipIndexes.has(`${table}.${index}`)) continue;
    try {
      await pool.query(`ALTER TABLE ${table} ADD UNIQUE KEY ${index} (${column})`);
    } catch (error) {
      if (error.code !== 'ER_DUP_KEYNAME') throw error;
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsored_child_care_records (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      participant_id INT UNSIGNED NOT NULL,
      care_type VARCHAR(20) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      recorded_on DATE NOT NULL,
      description VARCHAR(255) DEFAULT NULL,
      receipt_mime VARCHAR(100) NOT NULL,
      receipt_data LONGBLOB NOT NULL,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_sponsored_child_care_records_child_date (participant_id, recorded_on),
      CONSTRAINT fk_sponsored_child_care_records_participant
        FOREIGN KEY (participant_id) REFERENCES participants (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsorship_letter_threads (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      participant_id INT UNSIGNED NOT NULL,
      subject VARCHAR(160) NOT NULL,
      subject_encrypted TEXT DEFAULT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_sponsorship_letter_threads_child (participant_id, updated_at),
      CONSTRAINT fk_sponsorship_letter_threads_participant
        FOREIGN KEY (participant_id) REFERENCES participants (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsorship_letter_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      thread_id BIGINT UNSIGNED NOT NULL,
      sender_type VARCHAR(16) NOT NULL,
      sender_id INT UNSIGNED DEFAULT NULL,
      message TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_sponsorship_letter_messages_thread (thread_id, created_at),
      CONSTRAINT fk_sponsorship_letter_messages_thread
        FOREIGN KEY (thread_id) REFERENCES sponsorship_letter_threads (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sponsorship_letter_threads'
       AND COLUMN_NAME = 'subject_encrypted'`,
  );
  if (!columns.length) {
    try {
      await pool.query('ALTER TABLE sponsorship_letter_threads ADD COLUMN subject_encrypted TEXT DEFAULT NULL');
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
}

module.exports = { initializeSponsorshipTables };
