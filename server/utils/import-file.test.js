const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('@e965/xlsx');
const { inspectImportFile, safeImportFileName } = require('./import-file');

function makeWorkbook(type, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Participants');
  return XLSX.write(workbook, { type: 'buffer', bookType: type });
}

test('inspects CSV content and sanitizes Windows paths from filenames', () => {
  const result = inspectImportFile(
    'C:\\private\\participants.csv',
    Buffer.from('First Name,Last Name\nAda,Lovelace').toString('base64'),
  );
  assert.equal(result.fileName, 'participants.csv');
  assert.deepEqual(result.headers, ['First Name', 'Last Name']);
  assert.deepEqual(result.rows, [['Ada', 'Lovelace']]);
  assert.equal(safeImportFileName('../participants.csv'), 'participants.csv');
});

test('accepts both supported Excel workbook formats', () => {
  for (const type of ['xlsx', 'xls']) {
    const bytes = makeWorkbook(type, [['Participant ID'], ['FMC-001']]);
    const result = inspectImportFile(`participants.${type}`, bytes.toString('base64'));
    assert.deepEqual(result.rows, [['FMC-001']]);
  }
});

test('rejects unsupported, mismatched, oversized, and formula-bearing files', () => {
  assert.throws(() => inspectImportFile('data.xlsm', 'AA=='), /Supported formats/);
  assert.throws(() => inspectImportFile('data.xlsx', Buffer.from('not xlsx').toString('base64')), /do not match/);
  assert.throws(() => inspectImportFile('data.csv', Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')), /5 MB/);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Value'], [1]]);
  sheet.A2 = { t: 'n', f: '1+1', v: 2 };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  const formulaFile = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  assert.throws(() => inspectImportFile('formula.xlsx', formulaFile.toString('base64')), /Formula cells/);
});
