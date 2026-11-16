import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));

const { describeSubmitError } = await import('../../src/pages/RegisterPage.jsx');

describe('describeSubmitError', () => {
  // The reported failure: "an unexpected error..." and nothing else. An error
  // with no usable message set formError to undefined, which renders as an
  // empty paragraph - the submit failed and the page explained it in no words
  // at all.
  it('never returns nothing, whatever it is handed', () => {
    for (const thrown of [undefined, null, {}, new Error(''), { message: '   ' }]) {
      const described = describeSubmitError(thrown);

      expect(described).toBeTruthy();
      expect(described.length).toBeGreaterThan(20);
    }
  });

  it('says nothing was charged, since that is the first worry', () => {
    expect(describeSubmitError(new Error(''))).toMatch(/nothing has been charged/i);
  });

  it('keeps a real message as it is', () => {
    expect(describeSubmitError(new Error('An active registration already exists.')))
      .toBe('An active registration already exists.');
  });

  it("surfaces Square's detail, which its own message leaves out", () => {
    // Square raises a generic line and puts the specifics on the object. Only
    // reading .message is how "An unexpected error occurred" reaches someone
    // with no indication of what to do about it.
    const squareError = Object.assign(new Error('An unexpected error occurred'), {
      errors: [{ detail: 'Card declined by issuer.' }]
    });

    expect(describeSubmitError(squareError))
      .toBe('An unexpected error occurred (Card declined by issuer.)');
  });

  it('falls back to the detail when there is no message at all', () => {
    expect(describeSubmitError({ errors: [{ detail: 'Invalid postal code.' }] }))
      .toBe('Invalid postal code.');
  });

  it('does not repeat the detail when the message already carries it', () => {
    const squareError = Object.assign(new Error('Card declined by issuer.'), {
      errors: [{ detail: 'Card declined by issuer.' }]
    });

    expect(describeSubmitError(squareError)).toBe('Card declined by issuer.');
  });
});
