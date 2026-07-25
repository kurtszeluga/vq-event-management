import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRegistrantForm } from '../../src/hooks/useRegistrantForm.js';

describe('useRegistrantForm', () => {
  it('starts empty with the default billing country', () => {
    const { result } = renderHook(() => useRegistrantForm());

    expect(result.current.firstName).toBe('');
    expect(result.current.lastName).toBe('');
    expect(result.current.phone).toBe('');
    expect(result.current.billingCountry).toBe('United States');
    expect(result.current.fieldErrors).toEqual({});
  });

  it('setters update their own field only', () => {
    const { result } = renderHook(() => useRegistrantForm());

    act(() => {
      result.current.setFirstName('Ada');
    });

    expect(result.current.firstName).toBe('Ada');
    expect(result.current.lastName).toBe('');
  });

  it('applyProfile fills every field from a matched profile', () => {
    const { result } = renderHook(() => useRegistrantForm());

    act(() => {
      result.current.applyProfile({
        billingAddress: {
          city: 'Chapel Hill',
          country: 'United States',
          postalCode: '27514',
          state: 'NC',
          street: '123 Main St'
        },
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '555-010-1000'
      });
    });

    expect(result.current.firstName).toBe('Ada');
    expect(result.current.lastName).toBe('Lovelace');
    expect(result.current.phone).toBe('555-010-1000');
    expect(result.current.billingCity).toBe('Chapel Hill');
    expect(result.current.billingState).toBe('NC');
    expect(result.current.billingPostalCode).toBe('27514');
    expect(result.current.billingStreet).toBe('123 Main St');
  });

  it('applyProfile falls back to splitting a display name when firstName/lastName are absent', () => {
    // Profiles from CSV import or admin creation may only carry a display name.
    const { result } = renderHook(() => useRegistrantForm());

    act(() => {
      result.current.applyProfile({ name: 'Grace Hopper' });
    });

    expect(result.current.firstName).toBe('Grace');
    expect(result.current.lastName).toBe('Hopper');
  });

  it('applyProfile defaults billing country when the profile has no address', () => {
    const { result } = renderHook(() => useRegistrantForm());

    act(() => {
      result.current.applyProfile({ firstName: 'Ada', lastName: 'Lovelace' });
    });

    expect(result.current.billingCity).toBe('');
    expect(result.current.billingCountry).toBe('United States');
  });

  it('reset clears every field back to the empty defaults', () => {
    // This is the path a fresh email lookup or a switched-email registrant
    // relies on to make sure a previous match's data cannot leak forward.
    const { result } = renderHook(() => useRegistrantForm());

    act(() => {
      result.current.applyProfile({
        billingAddress: { city: 'Chapel Hill', state: 'NC' },
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '555-010-1000'
      });
    });

    expect(result.current.firstName).toBe('Ada');

    act(() => {
      result.current.reset();
    });

    expect(result.current.firstName).toBe('');
    expect(result.current.lastName).toBe('');
    expect(result.current.phone).toBe('');
    expect(result.current.billingCity).toBe('');
    expect(result.current.billingState).toBe('');
    expect(result.current.billingCountry).toBe('United States');
  });

  it('reset does not touch field errors, matching current RegisterPage behavior', () => {
    // RegisterPage clears fieldErrors itself (via setFieldErrors) at the start
    // of each lookup; reset() was never responsible for that. A future change
    // that makes reset() clear errors too would be a silent behavior change.
    const { result } = renderHook(() => useRegistrantForm());

    act(() => {
      result.current.setFieldErrors({ firstName: 'First name is required.' });
      result.current.reset();
    });

    expect(result.current.fieldErrors).toEqual({ firstName: 'First name is required.' });
  });

  it('applyProfile and reset are referentially stable across renders', () => {
    // RegisterPage passes these into a useCallback dependency array
    // (runEmailLookup); if they were not stable, that callback would be
    // rebuilt every render and any effect depending on it would re-fire.
    const { rerender, result } = renderHook(() => useRegistrantForm());
    const firstApplyProfile = result.current.applyProfile;
    const firstReset = result.current.reset;

    rerender();

    expect(result.current.applyProfile).toBe(firstApplyProfile);
    expect(result.current.reset).toBe(firstReset);
  });
});
