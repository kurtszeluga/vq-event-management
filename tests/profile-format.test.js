import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDisplayName,
  getProfileFirstName,
  getProfileLastName,
  splitDisplayName,
  toTitleCase
} from '../src/utils/profileFormat.js';

// A null profile is a real state, not a defensive hypothetical: `userProfile`
// starts as null in AuthContext and stays null until Firestore answers. These
// helpers used to declare `profile = {}`, which only fills in for `undefined`,
// so an explicit null skipped the default and threw on property access -
// taking down ProfilePage before its own auth guard could redirect.
test('name helpers tolerate a null or undefined profile', () => {
  for (const profile of [null, undefined]) {
    assert.equal(getProfileFirstName(profile), '');
    assert.equal(getProfileLastName(profile), '');
  }
});

test('name helpers tolerate a profile with no name fields at all', () => {
  assert.equal(getProfileFirstName({}), '');
  assert.equal(getProfileLastName({}), '');
});

test('name helpers tolerate an explicitly null name', () => {
  assert.equal(getProfileFirstName({ name: null }), '');
  assert.equal(getProfileLastName({ name: null }), '');
});

test('explicit first and last names win over the display name', () => {
  const profile = { firstName: 'Ada', lastName: 'Lovelace', name: 'Grace Hopper' };

  assert.equal(getProfileFirstName(profile), 'Ada');
  assert.equal(getProfileLastName(profile), 'Lovelace');
});

test('a display name is split when the explicit fields are missing', () => {
  assert.equal(getProfileFirstName({ name: 'ada lovelace' }), 'Ada');
  assert.equal(getProfileLastName({ name: 'ada lovelace' }), 'Lovelace');
});

test('a multi-word first name keeps everything but the last word', () => {
  assert.equal(getProfileFirstName({ name: 'mary jane watson' }), 'Mary Jane');
  assert.equal(getProfileLastName({ name: 'mary jane watson' }), 'Watson');
});

test('a single-word display name becomes the first name only', () => {
  assert.equal(splitDisplayName('cher').firstName, 'Cher');
  assert.equal(splitDisplayName('cher').lastName, '');
});

test('splitDisplayName tolerates null, undefined, and empty input', () => {
  for (const value of [null, undefined, '', '   ']) {
    assert.deepEqual(splitDisplayName(value), { firstName: '', lastName: '' });
  }
});

test('toTitleCase tolerates null and undefined instead of throwing on .trim()', () => {
  assert.equal(toTitleCase(null), '');
  assert.equal(toTitleCase(undefined), '');
});

test('toTitleCase still title-cases and collapses whitespace', () => {
  assert.equal(toTitleCase('  ada   lovelace '), 'Ada Lovelace');
});

test('buildDisplayName skips missing halves rather than leaving a stray space', () => {
  assert.equal(buildDisplayName('ada', 'lovelace'), 'Ada Lovelace');
  assert.equal(buildDisplayName('ada', ''), 'Ada');
  assert.equal(buildDisplayName('', 'lovelace'), 'Lovelace');
  assert.equal(buildDisplayName('', ''), '');
});
