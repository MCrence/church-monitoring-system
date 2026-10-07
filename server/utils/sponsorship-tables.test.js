const assert = require('node:assert/strict');
const test = require('node:test');

const { initializeSponsorshipTables } = require('./sponsorship-tables');

test('creates sponsorship tables before dependent message table', async () => {
  const created = [];
  const pool = {
    async query(sql) {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (!match) throw new Error(`Unexpected query: ${sql}`);
      const table = match[1];
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
      assert.match(sql, /subject_encrypted/);
      return [[{ COLUMN_NAME: 'subject_encrypted' }]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.deepEqual(created, [
    'sponsorship_disbursements',
    'sponsored_child_care_records',
    'sponsorship_letter_threads',
    'sponsorship_letter_messages',
  ]);
});

test('adds the encrypted subject column to legacy thread tables', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return [{}];
    },
    async execute() {
      return [[]];
    },
  };

  await initializeSponsorshipTables(pool);

  assert.ok(queries.some((sql) => sql.includes('ADD COLUMN subject_encrypted')));
});

test('surfaces migration failures other than a concurrent duplicate column', async () => {
  const failure = new Error('database unavailable');
  const pool = {
    async query(sql) {
      if (sql.includes('ADD COLUMN subject_encrypted')) throw failure;
      return [{}];
    },
    async execute() {
      return [[]];
    },
  };

  await assert.rejects(initializeSponsorshipTables(pool), failure);
});
