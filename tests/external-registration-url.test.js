import assert from 'node:assert/strict';
import test from 'node:test';
import { getExternalRegistrationUrl } from '../shared/registrationWindow.js';

// Go-live transition only. Delete this file alongside the field.

test('an http(s) address is taken as given', () => {
  assert.equal(
    getExternalRegistrationUrl({ externalRegistrationUrl: 'https://old.example.com/signup?id=7' }),
    'https://old.example.com/signup?id=7'
  );
  assert.equal(
    getExternalRegistrationUrl({ externalRegistrationUrl: '  http://old.example.com/x  ' }),
    'http://old.example.com/x'
  );
});

test('an event without the field is unaffected', () => {
  assert.equal(getExternalRegistrationUrl({}), '');
  assert.equal(getExternalRegistrationUrl(), '');
  assert.equal(getExternalRegistrationUrl({ externalRegistrationUrl: '' }), '');
});

test('a scheme that could run script is refused', () => {
  // The value is rendered as an href a member clicks, and it is typed into an
  // admin form - so this is the one input worth being strict about.
  ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'JavaScript:alert(1)']
    .forEach((value) => {
      assert.equal(getExternalRegistrationUrl({ externalRegistrationUrl: value }), '', value);
    });
});

test('a half-typed address is refused rather than linked', () => {
  ['old.example.com', 'www.old.example.com', 'https://', 'mailto:someone@example.com']
    .forEach((value) => {
      assert.equal(getExternalRegistrationUrl({ externalRegistrationUrl: value }), '', value);
    });
});

test('the registration window is left alone by the field', () => {
  // The field decides where Register points, not whether the window is open -
  // keeping them separate is what stops this touching normal events at all.
  const event = {
    eventType: 'Workshop',
    externalRegistrationUrl: 'https://old.example.com/signup',
    registrationMode: 'now'
  };

  assert.equal(getExternalRegistrationUrl(event), 'https://old.example.com/signup');
});
