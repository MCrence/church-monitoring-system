async function initializeSponsorshipTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS participant_status_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      participant_id INT(11) UNSIGNED NOT NULL,
      status_type VARCHAR(24) NOT NULL DEFAULT 'participant',
      previous_status VARCHAR(30) NOT NULL,
      current_status VARCHAR(30) NOT NULL,
      changed_by INT UNSIGNED DEFAULT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_participant_status_history (participant_id, changed_at, id),
      CONSTRAINT fk_participant_status_history_participant
        FOREIGN KEY (participant_id) REFERENCES participants (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [statusHistoryColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'participant_status_history'
       AND COLUMN_NAME = 'status_type'`,
  );
  if (!statusHistoryColumns.length) {
    try {
      await pool.query(
        "ALTER TABLE participant_status_history ADD COLUMN status_type VARCHAR(24) NOT NULL DEFAULT 'participant' AFTER participant_id",
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsored_child_care_records (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      participant_id INT(11) UNSIGNED NOT NULL,
      care_type VARCHAR(20) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      recorded_on DATE NOT NULL,
      description VARCHAR(255) DEFAULT NULL,
      gift_from_encrypted TEXT DEFAULT NULL,
      receipt_mime VARCHAR(100) DEFAULT NULL,
      receipt_data LONGBLOB DEFAULT NULL,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_sponsored_child_care_records_child_date (participant_id, recorded_on),
      CONSTRAINT fk_sponsored_child_care_records_participant
        FOREIGN KEY (participant_id) REFERENCES participants (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [careRecordColumns] = await pool.execute(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sponsored_child_care_records'
       AND COLUMN_NAME IN ('gift_from_encrypted', 'receipt_mime', 'receipt_data')`,
  );
  const existingCareRecordColumns = new Map(
    careRecordColumns.map(({ COLUMN_NAME, IS_NULLABLE }) => [COLUMN_NAME, IS_NULLABLE]),
  );
  if (!existingCareRecordColumns.has('gift_from_encrypted')) {
    try {
      await pool.query('ALTER TABLE sponsored_child_care_records ADD COLUMN gift_from_encrypted TEXT DEFAULT NULL');
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  for (const [column, definition] of [
    ['receipt_mime', 'VARCHAR(100) DEFAULT NULL'],
    ['receipt_data', 'LONGBLOB DEFAULT NULL'],
  ]) {
    if (existingCareRecordColumns.get(column) === 'YES') continue;
    try {
      await pool.query(`ALTER TABLE sponsored_child_care_records MODIFY COLUMN ${column} ${definition}`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
}

module.exports = { initializeSponsorshipTables };
