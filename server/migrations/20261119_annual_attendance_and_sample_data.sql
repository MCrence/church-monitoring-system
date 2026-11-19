-- Apply manually after taking and verifying a complete database backup.
-- Sample schedules are explicitly marked and excluded from actual attendance metrics.

SET @migration_sql = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'events'
      AND COLUMN_NAME = 'is_sample'
  ),
  'SELECT 1',
  'ALTER TABLE `events` ADD COLUMN `is_sample` BOOLEAN NOT NULL DEFAULT FALSE'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

UPDATE events
SET is_sample = TRUE
WHERE description LIKE 'Synthetic %';

SET @migration_sql = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sponsored_child_participation_history'
      AND COLUMN_NAME = 'evaluation_year'
  ),
  'SELECT 1',
  'ALTER TABLE `sponsored_child_participation_history` ADD COLUMN `evaluation_year` SMALLINT UNSIGNED DEFAULT NULL AFTER `action_type`'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

UPDATE sponsored_child_participation_history
SET evaluation_year = YEAR(created_at)
WHERE evaluation_year IS NULL;

SET @migration_sql = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sponsored_child_participation_history'
      AND INDEX_NAME = 'uq_child_participation_action'
  ),
  'ALTER TABLE `sponsored_child_participation_history` DROP INDEX `uq_child_participation_action`',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sponsored_child_participation_history'
      AND INDEX_NAME = 'uq_child_participation_action_year'
  ),
  'SELECT 1',
  'ALTER TABLE `sponsored_child_participation_history` ADD UNIQUE KEY `uq_child_participation_action_year` (`participant_id`, `action_type`, `evaluation_year`)'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
