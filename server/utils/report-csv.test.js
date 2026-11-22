const test = require('node:test');
const assert = require('node:assert/strict');
const { csvCell, csvRecord } = require('./report-csv');

test('CSV fields escape quotes, commas, and line breaks', () => {
  assert.equal(csvCell('A "quoted", value\r\ncontinued'), '"A ""quoted"", value\r\ncontinued"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvRecord(['name', 'value, with comma']), '"name","value, with comma"');
});
