function parsePage(query, pageKey, pageSizeKey, defaultPageSize = 20, maxPageSize = 100) {
  const parsePositiveInteger = (value, fallback, label) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      throw new Error(`${label} must be a positive integer`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`${label} must be a positive integer`);
    }
    return parsed;
  };
  const page = parsePositiveInteger(query[pageKey], 1, 'Page');
  const requestedPageSize = parsePositiveInteger(query[pageSizeKey], defaultPageSize, 'Page size');
  return {
    page,
    pageSize: Math.min(maxPageSize, requestedPageSize),
  };
}

module.exports = { parsePage };
