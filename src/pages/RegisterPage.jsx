import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { US_STATES } from '../data/usStates.js';
import { getEvent } from '../services/eventService.js';
import {
  createRegistration,
  lookupRegistrationEmail
} from '../services/registrationService.js';
import {
  formatCurrency,
  formatEventDate,
  formatTimeRange,
  isEventVisible
} from '../utils/eventFormat.js';
import {
  buildBillingAddress,
  buildDisplayName,
  formatPhoneNumber,
  getProfileFirstName,
  getProfileLastName,
  toTitleCase
} from '../utils/profileFormat.js';

function RegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const eventId = searchParams.get('eventId') || '';
  const [billingCity, setBillingCity] = useState('');
  const [billingCountry, setBillingCountry] = useState('United States');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingStreet, setBillingStreet] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [email, setEmail] = useState('');
  const [event, setEvent] = useState(null);
  const [eventError, setEventError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [firstName, setFirstName] = useState('');
  const [formError, setFormError] = useState('');
  const [lastName, setLastName] = useState('');
  const [loadingEvent, setLoadingEvent] = useState(Boolean(eventId));
  const [lookup, setLookup] = useState(null);
  const [lookupComplete, setLookupComplete] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [needsProfileEdits, setNeedsProfileEdits] = useState(false);
  const [phone, setPhone] = useState('');
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [reactivateProfile, setReactivateProfile] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setLoadingEvent(false);
      setEvent(null);
      return undefined;
    }

    let active = true;

    async function loadEvent() {
      setLoadingEvent(true);
      try {
        const eventRecord = await getEvent(eventId);

        if (active) {
          setEvent(eventRecord);
          setEventError('');
        }
      } catch (error) {
        if (active) {
          setEventError(error.message);
        }
      } finally {
        if (active) {
          setLoadingEvent(false);
        }
      }
    }

    loadEvent();

    return () => {
      active = false;
    };
  }, [eventId]);

  const registrationUnavailable = useMemo(() => {
    if (!event) {
      return '';
    }

    if (!isEventVisible(event)) {
      return 'This event is not currently available.';
    }

    if (!event.registrationOpen) {
      return 'Registration is not currently open for this event.';
    }

    if (['Business Listing', 'For Sale'].includes(event.eventType)) {
      return 'This listing does not accept registrations.';
    }

    return '';
  }, [event]);

  const membershipBlocked = lookupComplete
    && ['profile-membership-blocked', 'membership-blocked', 'membership-not-found'].includes(lookup?.status);
  const matchedProfile = lookup?.profile || null;
  const requiresBillingAddress = Boolean(event?.isPaid) && Number(event?.cost || 0) > 0;
  const needsProfileConfirmation = matchedProfile
    && matchedProfile.status === 'Active'
    && !profileConfirmed;
  const needsProfileReactivation = matchedProfile
    && matchedProfile.status !== 'Active'
    && !reactivateProfile;
  const canShowRegistrantFields = lookupComplete
    && !membershipBlocked
    && !needsProfileConfirmation
    && !needsProfileReactivation;

  async function handleEmailLookup() {
    const normalizedEmail = email.trim().toLowerCase();

    setFieldErrors({});
    setFormError('');
    setConfirmation(null);
    setLookup(null);
    setLookupComplete(false);
    setProfileConfirmed(false);
    setReactivateProfile(false);

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setFieldErrors({ email: 'Valid email is required.' });
      setFormError('Enter a valid email address first.');
      return;
    }

    setLookupLoading(true);

    try {
      const result = await lookupRegistrationEmail(normalizedEmail);
      setEmail(normalizedEmail);
      setLookup(result);
      setLookupComplete(true);

      if (result.profile) {
        applyProfileToForm(result.profile);
      } else {
        resetRegistrantFields();
      }
    } catch (error) {
      setFormError(error.message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSubmit(formEvent) {
    formEvent.preventDefault();
    const errors = validateForm({ email, firstName, lastName, phone });
    const displayName = buildDisplayName(firstName, lastName);

    setFieldErrors(errors);
    setFormError('');
    setConfirmation(null);

    if (!lookupComplete) {
      setFormError('Please look up the email address first.');
      return;
    }

    if (needsProfileConfirmation || needsProfileReactivation) {
      setFormError('Please confirm the matched profile before registering.');
      return;
    }

    if (Object.keys(errors).length) {
      setFormError('Please fix the highlighted fields.');
      return;
    }

    if (registrationUnavailable) {
      setFormError(registrationUnavailable);
      return;
    }

    setSubmitting(true);

    try {
      const profileUpdates = {
        firstName: toTitleCase(firstName),
        lastName: toTitleCase(lastName),
        phone: formatPhoneNumber(phone)
      };

      if (requiresBillingAddress) {
        profileUpdates.billingAddress = buildBillingAddress({
          city: billingCity,
          country: billingCountry,
          postalCode: billingPostalCode,
          state: billingState,
          street: billingStreet
        });
      }

      const result = await createRegistration({
        email,
        eventId,
        name: displayName,
        phone,
        profileUserId: matchedProfile?.userId || '',
        profileUpdates,
        reactivateProfile
      });
      setConfirmation(result);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (window.opener) {
      window.close();
      return;
    }

    navigate(`/events/${eventId}`);
  }

  function handleStartProfileEdit() {
    setNeedsProfileEdits(true);
  }

  function handleCancelProfileEdit() {
    if (matchedProfile) {
      applyProfileToForm(matchedProfile);
    }
    setNeedsProfileEdits(false);
  }

  function handleSaveProfileEdit() {
    const errors = validateProfileFields({
      billingCity,
      billingCountry,
      billingPostalCode,
      billingState,
      billingStreet,
      firstName,
      lastName,
      phone
    });

    setFieldErrors(errors);

    if (Object.keys(errors).length) {
      setFormError('Please fix the highlighted profile fields before saving.');
      return;
    }

    setFormError('');
    setNeedsProfileEdits(false);
  }

  function applyProfileToForm(profile) {
    setFirstName(getProfileFirstName(profile));
    setLastName(getProfileLastName(profile));
    setPhone(profile.phone || '');
    setBillingCity(profile.billingAddress?.city || '');
    setBillingCountry(profile.billingAddress?.country || 'United States');
    setBillingPostalCode(profile.billingAddress?.postalCode || '');
    setBillingState(profile.billingAddress?.state || '');
    setBillingStreet(profile.billingAddress?.street || '');
  }

  function resetRegistrantFields() {
    setFirstName('');
    setLastName('');
    setPhone('');
    setBillingCity('');
    setBillingCountry('United States');
    setBillingPostalCode('');
    setBillingState('');
    setBillingStreet('');
  }

  if (!eventId) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Select an Event"
          description="Choose an event before starting registration."
        />
        <Link className="button-link" to="/events">
          View Events
        </Link>
      </section>
    );
  }

  if (loadingEvent) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Loading Registration"
          description="Preparing the event registration form."
        />
      </section>
    );
  }

  if (eventError || !event) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Event Unavailable"
          description={eventError || 'This event could not be found.'}
        />
        <Link className="button-link" to="/events">
          Back To Events
        </Link>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="Registration"
        title={`Register For ${event.title}`}
        description="Start with your email address so we can check your profile and membership."
      />
      <div className="registration-layout">
        <EventSummary event={event} />
        <form className="form-panel registration-form" onSubmit={handleSubmit}>
          {registrationUnavailable ? (
            <p className="form-error">{registrationUnavailable}</p>
          ) : null}
          {formError ? <p className="form-error">{formError}</p> : null}
          {confirmation ? (
            <RegistrationConfirmation confirmation={confirmation} event={event} />
          ) : null}
          <label>
            <span>Email *</span>
            <input
              className={fieldErrors.email ? 'field-invalid' : ''}
              disabled={submitting || Boolean(confirmation)}
              onChange={(inputEvent) => {
                setEmail(inputEvent.target.value);
                setLookupComplete(false);
                setLookup(null);
                setProfileConfirmed(false);
                setReactivateProfile(false);
                setNeedsProfileEdits(false);
                resetRegistrantFields();
              }}
              type="email"
              value={email}
            />
          </label>
          <button
            className="button-link button-reset"
            disabled={lookupLoading || submitting || Boolean(confirmation)}
            type="button"
            onClick={handleEmailLookup}
          >
            {lookupLoading ? 'Checking...' : 'Check Email'}
          </button>
          {lookupComplete ? (
            <LookupResult
              billingAddress={{
                city: billingCity,
                country: billingCountry,
                postalCode: billingPostalCode,
                state: billingState,
                street: billingStreet
              }}
              lookup={lookup}
              needsProfileEdits={needsProfileEdits}
              onConfirmProfile={() => setProfileConfirmed(true)}
              onEditProfile={handleStartProfileEdit}
              onReactivate={() => setReactivateProfile(true)}
              profileConfirmed={profileConfirmed}
              reactivateProfile={reactivateProfile}
            />
          ) : null}
          {canShowRegistrantFields ? (
            <>
              {(!matchedProfile || needsProfileEdits) ? (
                <div className="registration-profile-edit-grid">
                  <label>
                    <span>Email</span>
                    <input
                      disabled
                      readOnly
                      value={email}
                    />
                  </label>
                  <label>
                    <span>First Name *</span>
                    <input
                      className={fieldErrors.firstName ? 'field-invalid' : ''}
                      disabled={submitting || Boolean(confirmation)}
                      onBlur={(inputEvent) => setFirstName(toTitleCase(inputEvent.target.value))}
                      onChange={(inputEvent) => setFirstName(inputEvent.target.value)}
                      value={firstName}
                    />
                  </label>
                  <label>
                    <span>Last Name *</span>
                    <input
                      className={fieldErrors.lastName ? 'field-invalid' : ''}
                      disabled={submitting || Boolean(confirmation)}
                      onBlur={(inputEvent) => setLastName(toTitleCase(inputEvent.target.value))}
                      onChange={(inputEvent) => setLastName(inputEvent.target.value)}
                      value={lastName}
                    />
                  </label>
                  <label>
                    <span>Phone *</span>
                    <input
                      className={fieldErrors.phone ? 'field-invalid' : ''}
                      disabled={submitting || Boolean(confirmation)}
                      onChange={(inputEvent) => setPhone(formatPhoneNumber(inputEvent.target.value))}
                      type="tel"
                      value={phone}
                    />
                  </label>
                  {requiresBillingAddress ? (
                    <>
                      <label>
                        <span>Street Address</span>
                        <input
                          disabled={submitting || Boolean(confirmation)}
                          onBlur={(inputEvent) => setBillingStreet(toTitleCase(inputEvent.target.value))}
                          onChange={(inputEvent) => setBillingStreet(inputEvent.target.value)}
                          value={billingStreet}
                        />
                      </label>
                      <label>
                        <span>City</span>
                        <input
                          disabled={submitting || Boolean(confirmation)}
                          onBlur={(inputEvent) => setBillingCity(toTitleCase(inputEvent.target.value))}
                          onChange={(inputEvent) => setBillingCity(inputEvent.target.value)}
                          value={billingCity}
                        />
                      </label>
                      <label>
                        <span>State</span>
                        <select
                          className={fieldErrors.billingState ? 'field-invalid' : ''}
                          disabled={submitting || Boolean(confirmation)}
                          onChange={(inputEvent) => setBillingState(inputEvent.target.value)}
                          value={billingState}
                        >
                          <option value="">Select State</option>
                          {US_STATES.map((state) => (
                            <option key={state.value} value={state.value}>
                              {state.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>ZIP Code</span>
                        <input
                          className={fieldErrors.billingPostalCode ? 'field-invalid' : ''}
                          disabled={submitting || Boolean(confirmation)}
                          onChange={(inputEvent) => setBillingPostalCode(inputEvent.target.value)}
                          value={billingPostalCode}
                        />
                      </label>
                      <label>
                        <span>Country</span>
                        <input
                          disabled={submitting || Boolean(confirmation)}
                          onBlur={(inputEvent) => setBillingCountry(toTitleCase(inputEvent.target.value))}
                          onChange={(inputEvent) => setBillingCountry(inputEvent.target.value)}
                          value={billingCountry}
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="registration-lookup-card">
                  <strong>Registration Details</strong>
                  <dl>
                    <div>
                      <dt>Email</dt>
                      <dd>{email || 'Not listed'}</dd>
                    </div>
                    <div>
                      <dt>First Name</dt>
                      <dd>{firstName || 'Not listed'}</dd>
                    </div>
                    <div>
                      <dt>Last Name</dt>
                      <dd>{lastName || 'Not listed'}</dd>
                    </div>
                    <div>
                      <dt>Phone</dt>
                      <dd>{phone || 'Not listed'}</dd>
                    </div>
                    {requiresBillingAddress ? (
                      <div>
                        <dt>Address</dt>
                        <dd>{formatAddress({
                          city: billingCity,
                          country: billingCountry,
                          postalCode: billingPostalCode,
                          state: billingState,
                          street: billingStreet
                        })}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              )}
              {matchedProfile && (profileConfirmed || reactivateProfile) ? (
                <>
                  <div className="registration-edit-prompt">
                    <strong>
                      {needsProfileEdits
                        ? 'Update your profile details before registering.'
                        : 'Need to update your profile details first?'}
                    </strong>
                    {!needsProfileEdits ? (
                      <button
                        className="button-link secondary-action"
                        type="button"
                        onClick={handleStartProfileEdit}
                      >
                        Yes, Update My Information
                      </button>
                    ) : null}
                  </div>
                  {needsProfileEdits ? (
                    <div className="detail-actions">
                      <button
                        className="button-link button-reset"
                        type="button"
                        onClick={handleSaveProfileEdit}
                      >
                        Save Changes
                      </button>
                      <button
                        className="button-link secondary-action"
                        type="button"
                        onClick={handleCancelProfileEdit}
                      >
                        Cancel Changes
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
              {!needsProfileEdits ? (
                <button
                  className="button-link button-reset"
                  disabled={submitting || Boolean(confirmation) || Boolean(registrationUnavailable)}
                  type="submit"
                >
                  {submitting ? 'Submitting...' : 'Submit Registration'}
                </button>
              ) : null}
            </>
          ) : null}
          <button className="button-link secondary-action" type="button" onClick={handleClose}>
            Close
          </button>
        </form>
      </div>
    </section>
  );
}

function LookupResult({
  billingAddress,
  lookup,
  needsProfileEdits,
  onConfirmProfile,
  onEditProfile,
  onReactivate,
  profileConfirmed,
  reactivateProfile
}) {
  const profile = lookup?.profile;

  if (!lookup) {
    return null;
  }

  if (lookup.status === 'membership-not-found') {
    return (
      <div className="form-error">
        We could not find a membership record for this email address. Please contact an administrator for assistance.
      </div>
    );
  }

  if (['profile-membership-blocked', 'membership-blocked'].includes(lookup.status)) {
    return (
      <div className="form-error">
        Your membership status is not currently active. Please contact an administrator for assistance.
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="registration-lookup-card">
        <strong>No Profile Found</strong>
        <span>Membership confirmed. Continue entering your information.</span>
      </div>
    );
  }

  return (
    <div className="registration-lookup-card">
      <strong>Profile Found</strong>
      <dl>
        <div>
          <dt>Name</dt>
          <dd>{profile.name || 'Not listed'}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{profile.email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{profile.phone || 'Not listed'}</dd>
        </div>
        <div>
          <dt>Profile Status</dt>
          <dd>{profile.status}</dd>
        </div>
        <div>
          <dt>Membership</dt>
          <dd>{profile.membershipStatus}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{formatAddress(billingAddress)}</dd>
        </div>
      </dl>
      {profile.status === 'Active' ? (
        <div className="detail-actions">
          <button
            className="button-link button-reset"
            disabled={profileConfirmed}
            type="button"
            onClick={onConfirmProfile}
          >
            {profileConfirmed ? 'Profile Confirmed' : 'Yes, This Is Me'}
          </button>
          {profileConfirmed && !needsProfileEdits ? (
            <button
              className="button-link secondary-action"
              type="button"
              onClick={onEditProfile}
            >
              I Need To Edit Something
            </button>
          ) : null}
        </div>
      ) : (
        <div className="detail-actions">
          <button
            className="button-link button-reset"
            disabled={reactivateProfile}
            type="button"
            onClick={onReactivate}
          >
            {reactivateProfile ? 'Profile Will Be Reactivated' : 'Reactivate And Continue'}
          </button>
          {reactivateProfile && !needsProfileEdits ? (
            <button
              className="button-link secondary-action"
              type="button"
              onClick={onEditProfile}
            >
              I Need To Edit Something
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function EventSummary({ event }) {
  const cost = event.isPaid ? formatCurrency(event.cost) : 'Free';

  return (
    <aside className="registration-summary">
      <h2>{event.title}</h2>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{event.eventType}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatEventDate(event.date)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{event.location || 'To be announced'}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{cost}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{event.capacityUnlimited ? 'Unlimited' : event.capacity || 'To be announced'}</dd>
        </div>
      </dl>
    </aside>
  );
}

function RegistrationConfirmation({ confirmation, event }) {
  return (
    <div className="form-success">
      <strong>
        {confirmation.status === 'Waitlisted'
          ? 'You have been added to the waitlist.'
          : 'Registration confirmed.'}
      </strong>
      <span>
        {confirmation.profileReactivated ? ' Your profile was reactivated.' : ''}
        {confirmation.paymentRequired
          ? ' Payment is pending and will be handled when the payment module is enabled.'
          : ` You are registered for ${event.title}.`}
      </span>
    </div>
  );
}

function formatAddress(address = {}) {
  return [
    address.street,
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(' '),
    address.country
  ].filter(Boolean).join(', ') || 'Not listed';
}

function validateForm({ email, firstName, lastName, phone }) {
  const errors = {};

  if (!firstName.trim()) {
    errors.firstName = 'First name is required.';
  }

  if (!lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }

  if (!email.trim() || !email.includes('@')) {
    errors.email = 'Valid email is required.';
  }

  if (phone.replace(/\D/g, '').length < 10) {
    errors.phone = 'Phone number is required.';
  }

  return errors;
}

function validateProfileFields({
  billingCity,
  billingCountry,
  billingPostalCode,
  billingState,
  billingStreet,
  firstName,
  lastName,
  phone
}) {
  const errors = {};

  if (!firstName.trim()) {
    errors.firstName = 'First name is required.';
  }

  if (!lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }

  if (phone.replace(/\D/g, '').length < 10) {
    errors.phone = 'Phone number is required.';
  }

  if (billingState && billingState.length !== 2) {
    errors.billingState = 'Use the two-letter state code.';
  }

  if (billingPostalCode && billingPostalCode.trim().length < 5) {
    errors.billingPostalCode = 'ZIP code should be at least 5 characters.';
  }

  return errors;
}

export default RegisterPage;
