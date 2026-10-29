const XLSX = require('@e965/xlsx');

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_COLUMNS = 100;

function safeImportFileName(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, 255);
}

function importFileError(message) {
  const error = new Error(message);
  error.code = 'INVALID_IMPORT_FILE';
  return error;
}

function inspectImportFile(fileNameValue, fileDataValue) {
  const fileName = safeImportFileName(fileNameValue);
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const encoded = String(fileDataValue || '');
  if (!['.csv', '.xlsx', '.xls'].includes(extension)) {
    throw importFileError('Supported formats are .csv, .xlsx, and .xls');
  }
  if (!encoded || encoded.length > 7_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw importFileError('The file is missing, invalid, or exceeds the 5 MB limit');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (
    !buffer.length ||
    buffer.length > MAX_IMPORT_BYTES ||
    buffer.toString('base64') !== encoded
  ) {
    throw importFileError('The file must be a valid file no larger than 5 MB');
  }
  if (
    (extension === '.xlsx' && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) ||
    (extension === '.xls' && !buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
  ) {
    throw importFileError('The file contents do not match the selected Excel format');
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellFormula: true,
      cellStyles: false,
      cellNF: false,
      WTF: true,
    });
  } catch {
    throw importFileError('The uploaded file could not be read as a valid CSV or Excel workbook');
  }
  if (workbook.vbaraw) throw importFileError('Macro-enabled workbooks are not supported');
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw importFileError('The file has no worksheet data');
  const sheet = workbook.Sheets[sheetName];
  if (Object.values(sheet).some((cell) => cell && typeof cell === 'object' && cell.f)) {
    throw importFileError('Formula cells are not allowed in import files');
  }
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  if (grid.length < 2) {
    throw importFileError('The first worksheet must contain headers and at least one data row');
  }
  const headers = grid[0].map((value, index) => {
    const header = String(value || '').trim();
    return header || `Column ${index + 1}`;
  });
  const dataRows = grid.slice(1);
  if (headers.length > MAX_IMPORT_COLUMNS || dataRows.length > MAX_IMPORT_ROWS) {
    throw importFileError('Files may contain at most 100 columns and 5,000 data rows');
  }
  return {
    fileName,
    sheetName,
    headers,
    rows: dataRows.map((row) => headers.map((_, index) => String(row[index] ?? ''))),
  };
}

module.exports = {
  MAX_IMPORT_BYTES,
  inspectImportFile,
  safeImportFileName,
};
