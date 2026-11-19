-- REQUIRED: take and verify a fresh, complete database backup before running.
-- Apply manually; this migration is intentionally not invoked by application startup.

DROP TABLE IF EXISTS sponsorship_letter_messages;
DROP TABLE IF EXISTS sponsorship_letter_threads;
DROP TABLE IF EXISTS sponsorship_allowance_transactions;
DROP TABLE IF EXISTS sponsorship_disbursements;

SET @migration_sql = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'participants'
      AND COLUMN_NAME = 'letters_sent_encrypted'
  ),
  'ALTER TABLE `participants` DROP COLUMN `letters_sent_encrypted`',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'participants'
      AND COLUMN_NAME = 'letters_received_encrypted'
  ),
  'ALTER TABLE `participants` DROP COLUMN `letters_received_encrypted`',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'participants'
      AND COLUMN_NAME = 'last_letter_date'
  ),
  'ALTER TABLE `participants` DROP COLUMN `last_letter_date`',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'participants'
      AND COLUMN_NAME = 'monthly_allowance'
  ),
  'ALTER TABLE `participants` DROP COLUMN `monthly_allowance`',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'participants'
      AND COLUMN_NAME = 'available_allowance_balance'
  ),
  'ALTER TABLE `participants` DROP COLUMN `available_allowance_balance`',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
