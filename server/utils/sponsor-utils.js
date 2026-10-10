const SPONSOR_TYPES = new Set(['Individual', 'Family', 'Couple']);
const SPONSOR_SEXES = new Set(['Male', 'Female']);

function validateSponsor(body) {
  const familyName = String(body.familyName || '').trim();
  const sex = String(body.sex || '').trim();
  const sponsorType = String(body.sponsorType || '').trim();
  const errors = {};

  if (!familyName) errors.familyName = 'Family name is required.';
  else if (familyName.length > 100) errors.familyName = 'Family name must be 100 characters or fewer.';
  if (!SPONSOR_SEXES.has(sex)) errors.sex = 'Select Male or Female.';
  if (!SPONSOR_TYPES.has(sponsorType)) {
    errors.sponsorType = 'Select Individual, Family, or Couple.';
  }

  return { familyName, sex, sponsorType, errors };
}

module.exports = { validateSponsor };
