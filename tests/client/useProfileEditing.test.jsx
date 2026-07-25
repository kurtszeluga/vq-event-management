import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProfileEditing } from '../../src/hooks/useProfileEditing.js';

const VALID_REGISTRANT = {
  billingPostalCode: '27514',
  billingState: 'NC',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '555-010-1000'
};

function setup(overrides = {}) {
  const props = {
    applyProfile: vi.fn(),
    matchedProfile: { firstName: 'Ada', lastName: 'Lovelace', userId: 'user-1' },
    registrant: VALID_REGISTRANT,
    setFieldErrors: vi.fn(),
    setFormError: vi.fn(),
    ...overrides
  };

  return { props, ...renderHook(() => useProfileEditing(props)) };
}

describe('starting and cancelling an edit', () => {
  it('starts closed and opens on request', () => {
    const { result } = setup();

    expect(result.current.needsProfileEdits).toBe(false);

    act(() => {
      result.current.handleStartProfileEdit();
    });

    expect(result.current.needsProfileEdits).toBe(true);
  });

  it('restores the matched profile and closes on cancel', () => {
    const { props, result } = setup();

    act(() => {
      result.current.handleStartProfileEdit();
      result.current.handleCancelProfileEdit();
    });

    expect(props.applyProfile).toHaveBeenCalledWith(props.matchedProfile);
    expect(result.current.needsProfileEdits).toBe(false);
  });

  it('does not call applyProfile on cancel when there is no matched profile', () => {
    // A non-member registrant with no profile match has nothing to restore.
    const { props, result } = setup({ matchedProfile: null });

    act(() => {
      result.current.handleCancelProfileEdit();
    });

    expect(props.applyProfile).not.toHaveBeenCalled();
    expect(result.current.needsProfileEdits).toBe(false);
  });

  // Cancelling has to undo the validation state as well as the values. The
  // form error renders far above the edit block, so leaving it set means the
  // editor closes while "Please fix the highlighted profile fields before
  // saving." stays on screen and the fields stay marked invalid - which reads
  // as the Cancel button having done nothing at all.
  it('clears the form error and field errors on cancel', () => {
    const { props, result } = setup({
      registrant: { ...VALID_REGISTRANT, firstName: '', phone: '' }
    });

    act(() => {
      result.current.handleStartProfileEdit();
      result.current.handleSaveProfileEdit();
    });

    // Save refused and populated both, as it should.
    expect(props.setFormError).toHaveBeenLastCalledWith(
      'Please fix the highlighted profile fields before saving.'
    );
    expect(props.setFieldErrors).toHaveBeenLastCalledWith(
      expect.objectContaining({ firstName: expect.any(String), phone: expect.any(String) })
    );
    expect(result.current.needsProfileEdits).toBe(true);

    act(() => {
      result.current.handleCancelProfileEdit();
    });

    expect(props.setFieldErrors).toHaveBeenLastCalledWith({});
    expect(props.setFormError).toHaveBeenLastCalledWith('');
    expect(result.current.needsProfileEdits).toBe(false);
  });
});

describe('saving an edit', () => {
  it('closes edit mode and clears the form error on valid fields', () => {
    const { props, result } = setup();

    act(() => {
      result.current.handleStartProfileEdit();
      result.current.handleSaveProfileEdit();
    });

    expect(props.setFieldErrors).toHaveBeenCalledWith({});
    expect(props.setFormError).toHaveBeenCalledWith('');
    expect(result.current.needsProfileEdits).toBe(false);
  });

  it('stays open and reports an error when a required field is missing', () => {
    const { props, result } = setup({
      registrant: { ...VALID_REGISTRANT, firstName: '' }
    });

    act(() => {
      result.current.handleStartProfileEdit();
      result.current.handleSaveProfileEdit();
    });

    expect(props.setFieldErrors).toHaveBeenCalledWith({ firstName: 'First name is required.' });
    expect(props.setFormError).toHaveBeenCalledWith('Please fix the highlighted profile fields before saving.');
    expect(result.current.needsProfileEdits).toBe(true);
  });

  it('rejects a state code that is not two letters', () => {
    const { props, result } = setup({
      registrant: { ...VALID_REGISTRANT, billingState: 'North Carolina' }
    });

    act(() => {
      result.current.handleSaveProfileEdit();
    });

    expect(props.setFieldErrors).toHaveBeenCalledWith({
      billingState: 'Use the two-letter state code.'
    });
  });

  it('rejects a postal code shorter than five characters', () => {
    const { props, result } = setup({
      registrant: { ...VALID_REGISTRANT, billingPostalCode: '123' }
    });

    act(() => {
      result.current.handleSaveProfileEdit();
    });

    expect(props.setFieldErrors).toHaveBeenCalledWith({
      billingPostalCode: 'ZIP code should be at least 5 characters.'
    });
  });

  it('accepts an empty state or postal code rather than requiring them', () => {
    // Billing address fields are optional for events that do not require
    // one; only their format is validated when present.
    const { props, result } = setup({
      registrant: { ...VALID_REGISTRANT, billingPostalCode: '', billingState: '' }
    });

    act(() => {
      result.current.handleSaveProfileEdit();
    });

    expect(props.setFieldErrors).toHaveBeenCalledWith({});
  });

  it('rejects a phone number with fewer than ten digits', () => {
    const { props, result } = setup({
      registrant: { ...VALID_REGISTRANT, phone: '555-1234' }
    });

    act(() => {
      result.current.handleSaveProfileEdit();
    });

    expect(props.setFieldErrors).toHaveBeenCalledWith({
      phone: 'Phone number is required.'
    });
  });
});

describe('setNeedsProfileEdits', () => {
  it('is exposed directly so changing the registration email can exit edit mode', () => {
    // RegisterPage's email field calls this alongside handleEmailChange
    // rather than handleCancelProfileEdit, since a new email invalidates the
    // matched profile entirely - there is nothing to restore.
    const { props, result } = setup();

    act(() => {
      result.current.handleStartProfileEdit();
      result.current.setNeedsProfileEdits(false);
    });

    expect(props.applyProfile).not.toHaveBeenCalled();
    expect(result.current.needsProfileEdits).toBe(false);
  });
});
