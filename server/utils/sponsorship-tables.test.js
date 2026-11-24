const assert = require('node:assert/strict');
const test = require('node:test');

const { initializeSponsorshipTables } = require('./sponsorship-tables');

test('creates participant history and care tables without sponsor, letter, or allowance tables', async () => {
  const created = [];
  const definitions = [];
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (!match) return [{}];
      const table = match[1];
      definitions.push(sql);
      created.push(table);
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'participant_status_history'")) return [[]];
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
    'participant_status_history',
    'sponsored_child_care_records',
  ]);
  assert.equal(queries.some((sql) => /CREATE TABLE IF NOT EXISTS (sponsors|sponsorship_assignments|sponsorship_assignment_history)/.test(sql)), false);
  assert.equal(created.includes('sponsorship_allowance_transactions'), false);
  assert.equal(created.includes('sponsorship_disbursements'), false);
  assert.equal(definitions.some((sql) => /letter|allowance/i.test(sql)), false);
  assert.ok(queries.some((sql) => sql.includes('ADD COLUMN status_type VARCHAR(24)')));
  assert.match(
    definitions.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS participant_status_history')),
    /previous_status VARCHAR\(30\) NOT NULL/,
  );
  assert.equal(definitions.some((sql) => /letter|allowance/i.test(sql)), false);
  assert.equal(definitions.some((sql) => /`sponsor_(id|name|contact|email|address)/i.test(sql)), false);
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
      if (sql.includes("TABLE_NAME = 'sponsored_child_care_records'")) return [[]];
      return [[]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.ok(queries.some((sql) => sql.includes('ADD COLUMN gift_from_encrypted TEXT DEFAULT NULL')));
  assert.ok(queries.some((sql) => sql.includes('MODIFY COLUMN receipt_mime VARCHAR(100) DEFAULT NULL')));
  assert.ok(queries.some((sql) => sql.includes('MODIFY COLUMN receipt_data LONGBLOB DEFAULT NULL')));
});

test('does not recreate retired sponsor tables', async () => {
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
      if (sql.includes("TABLE_NAME = 'sponsored_child_care_records'")) return [[]];
      return [[]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.equal(queries.some((sql) => /CREATE TABLE IF NOT EXISTS (sponsors|sponsorship_assignments|sponsorship_assignment_history)/.test(sql)), false);
});

test('surfaces sponsorship table migration failures other than concurrent duplicate columns', async () => {
  const failure = new Error('database unavailable');
  const pool = {
    async query(sql) {
      if (sql.includes('ADD COLUMN status_type')) throw failure;
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'participant_status_history'")) return [[]];
      if (sql.includes("TABLE_NAME = 'sponsored_child_care_records'")) return [[]];
      return [[]];
    },
  };

  await assert.rejects(initializeSponsorshipTables(pool), failure);
});
