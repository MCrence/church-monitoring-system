const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canGoerAccessParticipant,
  canGoerManageCare,
  canGoerUsePermission,
} = require('./goer-access');

const goer = {
  role: 'Goer',
  goerEducationLevel: 'Elementary',
  permissions: ['checkin:record', 'goer-care:view', 'goer-care:record'],
};
const elementaryChild = {
  participant_type: 'sponsored_child',
  education_level: 'Elementary',
  status: 'active',
};

test('Goer accounts receive only attendance and scoped care permissions', () => {
  assert.equal(canGoerUsePermission('Goer', 'checkin:record'), true);
  assert.equal(canGoerUsePermission('Goer', 'goer-care:view'), true);
  assert.equal(canGoerUsePermission('Goer', 'goer-care:record'), true);
  assert.equal(canGoerUsePermission('Goer', 'sponsorship:manage'), false);
  assert.equal(canGoerUsePermission('Goer', 'participants:view'), false);
  assert.equal(canGoerUsePermission('Church Administrator', 'sponsorship:manage'), true);
  assert.equal(canGoerManageCare(goer), true);
  assert.equal(canGoerManageCare({
    ...goer,
    permissions: ['checkin:record', 'goer-care:view'],
  }), false);
  assert.equal(canGoerManageCare({
    ...goer,
    goerEducationLevel: null,
  }), false);
});

test('Goer check-in is limited to active sponsored children in the assigned group', () => {
  assert.equal(canGoerAccessParticipant(goer, elementaryChild), true);
  assert.equal(canGoerAccessParticipant(goer, {
    ...elementaryChild,
    education_level: 'College',
  }), false);
  assert.equal(canGoerAccessParticipant(goer, {
    ...elementaryChild,
    participant_type: 'Goer',
  }), false);
  assert.equal(canGoerAccessParticipant(goer, {
    ...elementaryChild,
    status: 'inactive',
  }), false);
  assert.equal(canGoerAccessParticipant({
    ...goer,
    goerEducationLevel: null,
  }, elementaryChild), false);
});
