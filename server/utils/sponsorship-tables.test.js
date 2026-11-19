const assert = require('node:assert/strict');
const test = require('node:test');

const { initializeSponsorshipTables } = require('./sponsorship-tables');

test('creates sponsorship and care tables without retired features', async () => {
  const created = [];
  const definitions = [];
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (!match) {
        if (sql.includes('DELETE assignment')) {
          assert.ok(created.includes('sponsorship_assignments'));
        }
        return [{}];
      }
      const table = match[1];
      definitions.push(sql);
      created.push(table);
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'participant_status_history'")) return [[]];
      if (sql.includes("TABLE_NAME = 'sponsors'")) {
        return [[{ COLUMN_NAME: 'sponsor_type' }, { COLUMN_NAME: 'sex' }]];
      }
      if (sql.includes("TABLE_NAME = 'sponsored_child_care_records'")) {
        return [[
          { COLUMN_NAME: 'gift_from_encrypted', IS_NULLABLE: 'YES' },
          { COLUMN_NAME: 'receipt_mime', IS_NULLABLE: 'YES' },
          { COLUMN_NAME: 'receipt_data', IS_NULLABLE: 'YES' },
        ]];
      }
      return [[]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.deepEqual(created, [
    'sponsors',
    'sponsorship_assignments',
    'sponsorship_assignment_history',
    'participant_status_history',
    'sponsored_child_care_records',
  ]);
  assert.equal(created.includes('sponsorship_allowance_transactions'), false);
  assert.equal(created.includes('sponsorship_disbursements'), false);
  assert.equal(definitions.some((sql) => /letter|allowance/i.test(sql)), false);
  const assignmentTable = definitions.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS sponsorship_assignments'));
  assert.match(assignmentTable, /PRIMARY KEY \(participant_id\)/);
  assert.match(assignmentTable, /participant_id INT\(11\) UNSIGNED NOT NULL/);
  assert.match(assignmentTable, /UNIQUE KEY uq_sponsorship_assignment_sponsor \(sponsor_id\)/);
  assert.match(assignmentTable, /REFERENCES participants \(id\)/);
  assert.match(assignmentTable, /REFERENCES sponsors \(id\)/);
  assert.match(
    definitions.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS sponsorship_assignment_history')),
    /sponsor_name_encrypted TEXT DEFAULT NULL/,
  );
  assert.ok(queries.some((sql) => sql.includes('INSERT INTO sponsorship_assignment_history')));
  assert.ok(queries.some((sql) => sql.includes('ADD COLUMN status_type VARCHAR(24)')));
  assert.match(
    definitions.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS participant_status_history')),
    /previous_status VARCHAR\(30\) NOT NULL/,
  );
  assert.ok(queries.some((sql) => sql.includes("WHERE participant.status = 'deleted'")));
  assert.equal(definitions.every((sql) => !/participant_id INT UNSIGNED/.test(sql)), true);
});

test('preserves gift-care and participant history migrations', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'participant_status_history'")) return [[]];
      if (sql.includes("TABLE_NAME = 'sponsors'")) {
        return [[{ COLUMN_NAME: 'sponsor_type' }, { COLUMN_NAME: 'sex' }]];
      }
      if (sql.includes("TABLE_NAME = 'sponsored_child_care_records'")) return [[]];
      return [[]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.ok(queries.some((sql) => sql.includes("WHERE participant.status = 'deleted'")));
  assert.ok(queries.some((sql) => sql.includes('ADD COLUMN gift_from_encrypted TEXT DEFAULT NULL')));
  assert.ok(queries.some((sql) => sql.includes('MODIFY COLUMN receipt_mime VARCHAR(100) DEFAULT NULL')));
  assert.ok(queries.some((sql) => sql.includes('MODIFY COLUMN receipt_data LONGBLOB DEFAULT NULL')));
});

test('adds missing sponsor profile columns without replacing sponsor records', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'participant_status_history'")) {
        return [[{ COLUMN_NAME: 'status_type' }]];
      }
      if (sql.includes("TABLE_NAME = 'sponsors'")) return [[]];
      if (sql.includes("TABLE_NAME = 'sponsored_child_care_records'")) return [[]];
      return [[]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.ok(queries.some((sql) => sql.includes('ALTER TABLE sponsors ADD COLUMN sponsor_type')));
  assert.ok(queries.some((sql) => sql.includes('ALTER TABLE sponsors ADD COLUMN sex')));
  assert.equal(queries.some((sql) => sql.includes('DROP TABLE sponsors')), false);
});

test('surfaces sponsorship table migration failures other than concurrent duplicate columns', async () => {
  const failure = new Error('database unavailable');
  const pool = {
    async query(sql) {
      if (sql.includes('ADD COLUMN sponsor_type')) throw failure;
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'participant_status_history'")) return [[]];
      if (sql.includes("TABLE_NAME = 'sponsors'")) return [[]];
      if (sql.includes("TABLE_NAME = 'sponsored_child_care_records'")) return [[]];
      return [[]];
    },
  };

  await assert.rejects(initializeSponsorshipTables(pool), failure);
});
