const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeParticipantStatuses,
  removeRetiredSponsorshipData,
} = require('./retired-sponsorship-data');

test('normalizes participant and history values to the four supported statuses', async () => {
  const queries = [];
  const pool = {
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'participants'")) {
        return [[
          { COLUMN_NAME: 'status' },
          { COLUMN_NAME: 'participation_status' },
          { COLUMN_NAME: 'sponsorship_status' },
        ]];
      }
      if (sql.includes("TABLE_NAME = 'sponsored_child_participation_history'")) {
        return [[
          { COLUMN_NAME: 'previous_status' },
          { COLUMN_NAME: 'current_status' },
        ]];
      }
      return [[]];
    },
    async query(sql) {
      queries.push(sql);
      return [{}];
    },
  };

  await normalizeParticipantStatuses(pool);

  assert.ok(queries.some((sql) => sql.includes("THEN 'INACTIVE'")));
  assert.ok(queries.some((sql) => sql.includes("'REMOVED_FROM_SPONSORSHIP'")));
  assert.ok(queries.some((sql) => sql.includes("THEN 'GROUNDS_FOR_DEPARTURE'")));
  assert.ok(queries.some((sql) => sql.includes('MODIFY COLUMN participation_status ENUM(')));
  assert.ok(queries.some((sql) => sql.includes('MODIFY COLUMN `previous_status` ENUM(')));
  assert.ok(queries.some((sql) => sql.includes('MODIFY COLUMN `current_status` ENUM(')));
});

test('removes legacy sponsor data and redacts sponsor audit details without touching guardian lookup security', async () => {
  const queries = [];
  const pool = {
    async execute(sql) {
      if (sql.includes('INFORMATION_SCHEMA.TABLES') && sql.includes("TABLE_NAME = 'audit_logs'")) {
        return [[{ TABLE_NAME: 'audit_logs' }]];
      }
      if (sql.includes('INFORMATION_SCHEMA.TABLES')) {
        return [[
          { TABLE_NAME: 'sponsors' },
          { TABLE_NAME: 'sponsorship_assignments' },
          { TABLE_NAME: 'sponsorship_assignment_history' },
          { TABLE_NAME: 'sponsorship_letters' },
          { TABLE_NAME: 'sponsorship_allowance_transactions' },
        ]];
      }
      if (sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE')) {
        return [[
          { TABLE_NAME: 'participants', CONSTRAINT_NAME: 'fk_participant_sponsor' },
          { TABLE_NAME: 'sponsorship_assignments', CONSTRAINT_NAME: 'fk_assignment_sponsor' },
        ]];
      }
      if (sql.includes("TABLE_NAME = 'participants'")) {
        return [[
          { COLUMN_NAME: 'sponsor_id' },
          { COLUMN_NAME: 'program_affiliation_encrypted' },
        ]];
      }
      return [[]];
    },
    async query(sql) {
      queries.push(sql);
      return [{}];
    },
  };

  await removeRetiredSponsorshipData(pool);

  assert.ok(queries.some((sql) => sql.includes('DROP FOREIGN KEY `fk_participant_sponsor`')));
  assert.ok(queries.some((sql) => sql.includes('DROP COLUMN `sponsor_id`, DROP COLUMN `program_affiliation_encrypted`')));
  assert.ok(queries.some((sql) => sql.includes('DROP TABLE IF EXISTS `sponsors`')));
  assert.ok(queries.some((sql) => sql.includes('DROP TABLE IF EXISTS `sponsorship_assignment_history`')));
  assert.ok(queries.some((sql) => sql.includes('DROP TABLE IF EXISTS `sponsorship_letters`')));
  assert.ok(queries.some((sql) => sql.includes('DROP TABLE IF EXISTS `sponsorship_allowance_transactions`')));
  assert.ok(queries.some((sql) => sql.includes("UPDATE audit_logs SET details = NULL")));
  assert.equal(queries.some((sql) => sql.includes('DROP TABLE IF EXISTS `public_sponsor_lookup_attempts`')), false);
});
