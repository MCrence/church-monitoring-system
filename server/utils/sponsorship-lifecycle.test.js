const assert = require('node:assert/strict');
const test = require('node:test');

const { sponsorshipLifecycleStatuses } = require('./sponsorship-lifecycle');

test('accepts the supported sponsorship statuses without on-hold', () => {
  assert.deepEqual(
    [...sponsorshipLifecycleStatuses].sort(),
    ['active', 'completed', 'deceased', 'withdrawn'].sort(),
  );
  assert.equal(sponsorshipLifecycleStatuses.has('on_hold'), false);
  assert.equal(sponsorshipLifecycleStatuses.has('graduated'), false);
  assert.equal(sponsorshipLifecycleStatuses.has('new'), false);
});
