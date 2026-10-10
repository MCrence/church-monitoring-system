const assert = require('node:assert/strict');
const test = require('node:test');

const { initializeSponsorshipTables } = require('./sponsorship-tables');

test('creates sponsorship tables before dependent message table', async () => {
  const created = [];
  const definitions = [];
  const pool = {
    async query(sql) {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (!match) throw new Error(`Unexpected query: ${sql}`);
      const table = match[1];
      definitions.push(sql);
      if (
        table === 'sponsorship_letter_messages' &&
        !created.includes('sponsorship_letter_threads')
      ) {
        throw new Error('Message table was created before its parent table');
      }
      created.push(table);
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'sponsors'")) {
        return [[{ COLUMN_NAME: 'sponsor_type' }, { COLUMN_NAME: 'sex' }]];
      }
      if (sql.includes("TABLE_NAME = 'sponsorship_letter_threads'")) {
        return [[{ COLUMN_NAME: 'subject_encrypted' }]];
      }
      if (sql.includes("INDEX_NAME = 'uq_allowance_disbursement'")) {
        return [
          [
            { TABLE_NAME: 'sponsorship_allowance_transactions', INDEX_NAME: 'uq_allowance_disbursement' },
            { TABLE_NAME: 'sponsorship_disbursements', INDEX_NAME: 'uq_sponsorship_disbursement_idempotency' },
          ],
        ];
      }
      if (sql.includes("TABLE_NAME = 'sponsorship_allowance_transactions'")) {
        return [[
          { TABLE_NAME: 'sponsorship_allowance_transactions', COLUMN_NAME: 'disbursement_id' },
          { TABLE_NAME: 'sponsorship_disbursements', COLUMN_NAME: 'idempotency_key' },
        ]];
      }
      assert.match(sql, /subject_encrypted/);
      return [[]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.deepEqual(created, [
    'sponsorship_allowance_transactions',
    'sponsors',
    'sponsorship_disbursements',
    'sponsored_child_care_records',
    'sponsorship_letter_threads',
    'sponsorship_letter_messages',
  ]);
  assert.match(definitions[0], /previous_balance DECIMAL\(10,2\) NOT NULL/);
  assert.match(definitions[0], /UNIQUE KEY uq_allowance_disbursement \(disbursement_id\)/);
  assert.match(definitions[0], /UNIQUE KEY uq_allowance_related_transaction/);
  assert.match(
    definitions.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS sponsorship_disbursements')),
    /UNIQUE KEY uq_sponsorship_disbursement_idempotency \(idempotency_key\)/,
  );
});

test('adds disbursement linkage and idempotency columns and indexes to existing tables', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'sponsors'")) {
        return [[{ COLUMN_NAME: 'sponsor_type' }, { COLUMN_NAME: 'sex' }]];
      }
      if (sql.includes("TABLE_NAME = 'sponsorship_letter_threads'")) {
        return [[{ COLUMN_NAME: 'subject_encrypted' }]];
      }
      return [[]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.ok(queries.some((sql) => sql.includes('ADD COLUMN disbursement_id BIGINT UNSIGNED')));
  assert.ok(queries.some((sql) => sql.includes('ADD COLUMN idempotency_key CHAR(36)')));
  assert.ok(queries.some((sql) => sql.includes('ADD UNIQUE KEY uq_allowance_disbursement')));
  assert.ok(queries.some((sql) => sql.includes('ADD UNIQUE KEY uq_sponsorship_disbursement_idempotency')));
});

test('adds the encrypted subject column to legacy thread tables', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'sponsors'")) {
        return [[{ COLUMN_NAME: 'sponsor_type' }, { COLUMN_NAME: 'sex' }]];
      }
      if (sql.includes("TABLE_NAME = 'sponsorship_letter_threads'")) {
        return [[]];
      }
      return [[]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.ok(queries.some((sql) => sql.includes('ADD COLUMN subject_encrypted')));
});

test('adds missing sponsor profile columns without replacing sponsor records', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'sponsors'")) return [[]];
      return [[{ COLUMN_NAME: 'subject_encrypted' }]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.ok(queries.some((sql) => sql.includes('ALTER TABLE sponsors ADD COLUMN sponsor_type')));
  assert.ok(queries.some((sql) => sql.includes('ALTER TABLE sponsors ADD COLUMN sex')));
  assert.equal(queries.some((sql) => sql.includes('DROP TABLE sponsors')), false);
});

test('surfaces migration failures other than a concurrent duplicate column', async () => {
  const failure = new Error('database unavailable');
  const pool = {
    async query(sql) {
      if (sql.includes('ADD COLUMN subject_encrypted')) throw failure;
      return [{}];
    },
    async execute(sql) {
      if (sql.includes("TABLE_NAME = 'sponsors'")) {
        return [[{ COLUMN_NAME: 'sponsor_type' }, { COLUMN_NAME: 'sex' }]];
      }
      if (sql.includes("TABLE_NAME = 'sponsorship_letter_threads'")) {
        return [[]];
      }
      return [[]];
    },
  };

  await assert.rejects(initializeSponsorshipTables(pool), failure);
});
