async function initializeSponsorshipTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsorship_disbursements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      participant_id INT UNSIGNED NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      disbursed_on DATE NOT NULL,
      description VARCHAR(255) DEFAULT NULL,
      receipt_mime VARCHAR(100) DEFAULT NULL,
      receipt_data LONGBLOB DEFAULT NULL,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_sponsorship_disbursements_participant (participant_id, disbursed_on),
      CONSTRAINT fk_sponsorship_disbursements_participant
        FOREIGN KEY (participant_id) REFERENCES participants (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
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
