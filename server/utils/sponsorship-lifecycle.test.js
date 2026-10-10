const assert = require('node:assert/strict');
const test = require('node:test');

const { sponsorshipLifecycleStatuses } = require('./sponsorship-lifecycle');

test('accepts the supported sponsorship statuses only', () => {
  assert.deepEqual(
    [...sponsorshipLifecycleStatuses].sort(),
    ['active', 'completed', 'deceased', 'on_hold', 'withdrawn'].sort(),
  );
  assert.equal(sponsorshipLifecycleStatuses.has('graduated'), false);
  assert.equal(sponsorshipLifecycleStatuses.has('new'), false);
});
