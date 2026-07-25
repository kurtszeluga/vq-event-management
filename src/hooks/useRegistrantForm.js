import { useCallback, useState } from 'react';
import { getProfileFirstName, getProfileLastName } from '../utils/profileFormat.js';

// Owns the registrant's contact and billing fields plus their validation
// errors. Identity verification and submission stay in RegisterPage and
// drive this state through applyProfile/reset and the raw setters, since
// they own when a profile match, a reset, or a validation pass happens.
export function useRegistrantForm() {
  const [billingCity, setBillingCity] = useState('');
  const [billingCountry, setBillingCountry] = useState('United States');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingStreet, setBillingStreet] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  const applyProfile = useCallback((profile) => {
    setFirstName(getProfileFirstName(profile));
    setLastName(getProfileLastName(profile));
    setPhone(profile.phone || '');
    setBillingCity(profile.billingAddress?.city || '');
    setBillingCountry(profile.billingAddress?.country || 'United States');
    setBillingPostalCode(profile.billingAddress?.postalCode || '');
    setBillingState(profile.billingAddress?.state || '');
    setBillingStreet(profile.billingAddress?.street || '');
  }, []);

  const reset = useCallback(() => {
    setFirstName('');
    setLastName('');
    setPhone('');
    setBillingCity('');
    setBillingCountry('United States');
    setBillingPostalCode('');
    setBillingState('');
    setBillingStreet('');
  }, []);

  return {
    applyProfile,
    billingCity,
    billingCountry,
    billingPostalCode,
    billingState,
    billingStreet,
    fieldErrors,
    firstName,
    lastName,
    phone,
    reset,
    setBillingCity,
    setBillingCountry,
    setBillingPostalCode,
    setBillingState,
    setBillingStreet,
    setFieldErrors,
    setFirstName,
    setLastName,
    setPhone
  };
}
