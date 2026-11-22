function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRecord(values) {
  return values.map(csvCell).join(',');
}

module.exports = { csvCell, csvRecord };
